// ═══════════════════════════════════════════════
// 🤖 TERBOO ARCADE — خصم الكمبيوتر (حتمي، بلا نموذج لغوي)
// ───────────────────────────────────────────────
// الحركة تُختار بخوارزمية على حالة الخادم فقط:
//   minimax + alpha-beta · MCTS (UCT) · heuristic · custom
// المستويات: EASY · NORMAL · HARD · EXPERT (عمق/تكرارات/ضوضاء).
// الحتمية: بذرة = sessionId + version ⇒ نفس الحالة تعطي نفس الحركة (قابلة لإعادة الإنتاج).
// النموذج اللغوي (إن استُعمل) للتلميحات/التعليق فقط — لا يختار حركة أبداً.
// ═══════════════════════════════════════════════

import { seeded } from "./rng.js";

const PRESETS = Object.freeze({
  EASY: { depth: 1, iterations: 60, noise: 0.45 },
  NORMAL: { depth: 2, iterations: 200, noise: 0.15 },
  HARD: { depth: 4, iterations: 600, noise: 0.03 },
  EXPERT: { depth: 6, iterations: 1200, noise: 0 },
});
const WIN = 1e6;

const clone = (state) => structuredClone(state);
const sameAction = (a, b) => a.id === b.id && JSON.stringify(a.payload ?? null) === JSON.stringify(b.payload ?? null);

function presetFor(contract, difficulty) {
  const level = PRESETS[difficulty] ? difficulty : "NORMAL";
  const base = PRESETS[level];
  const own = contract.ai || {};
  return {
    level,
    depth: own.depth?.[level] ?? base.depth,
    iterations: own.iterations?.[level] ?? base.iterations,
    noise: own.noise?.[level] ?? base.noise,
  };
}

function step(contract, state, action, actor, rng) {
  const next = clone(state);
  const res = contract.controller.apply(next, action, { actor, rng, simulated: true });
  return res?.ok === false ? null : res?.state || next;
}

/** قيمة نهائية من منظور me (أو null إن لم تنتهِ) */
function terminalValue(contract, state, me, ply) {
  const st = contract.controller.status(state);
  if (!st?.over) return null;
  if (st.draw || !st.winners?.length) return 0;
  return st.winners.includes(me) ? WIN - ply : -WIN + ply;
}

function minimax(contract, state, depth, alpha, beta, me, ply, rng) {
  const term = terminalValue(contract, state, me, ply);
  if (term !== null) return { score: term };
  if (depth === 0) return { score: contract.ai.evaluate(state, me) };
  const actor = contract.controller.currentActor(state);
  let actions = contract.controller.legalActions(state, actor);
  if (!actions.length) return { score: contract.ai.evaluate(state, me) };
  if (contract.ai.order) actions = contract.ai.order(state, actions, actor);
  const maximizing = actor === me;
  let best = { score: maximizing ? -Infinity : Infinity, action: actions[0] };
  for (const action of actions) {
    const next = step(contract, state, action, actor, rng);
    if (!next) continue;
    const { score } = minimax(contract, next, depth - 1, alpha, beta, me, ply + 1, rng);
    if (maximizing ? score > best.score : score < best.score) best = { score, action };
    if (maximizing) alpha = Math.max(alpha, score);
    else beta = Math.min(beta, score);
    if (beta <= alpha) break;
  }
  return best;
}

/** MCTS (UCT) بمحاكاة عشوائية محدودة الطول — للألعاب ذات التفرع الكبير */
function mcts(contract, state, me, iterations, rng) {
  const root = { state, parent: null, action: null, actor: null, children: null, visits: 0, wins: 0 };
  const expand = (node) => {
    if (!node.state) {
      node.children = [];
      return;
    }
    const st = contract.controller.status(node.state);
    if (st?.over) {
      node.children = [];
      return;
    }
    const actor = contract.controller.currentActor(node.state);
    node.children = contract.controller.legalActions(node.state, actor).map((action) => ({ state: null, parent: node, action, actor, children: null, visits: 0, wins: 0 }));
  };
  const rollout = (start) => {
    let s = clone(start);
    for (let i = 0; i < 80; i += 1) {
      const st = contract.controller.status(s);
      if (st?.over) return st.draw || !st.winners?.length ? 0.5 : st.winners.includes(me) ? 1 : 0;
      const actor = contract.controller.currentActor(s);
      const acts = contract.controller.legalActions(s, actor);
      if (!acts.length) break;
      const next = step(contract, s, rng.pick(acts), actor, rng);
      if (!next) break;
      s = next;
    }
    const v = contract.ai.evaluate ? contract.ai.evaluate(s, me) : 0;
    return v > 0 ? 0.75 : v < 0 ? 0.25 : 0.5;
  };
  for (let i = 0; i < iterations; i += 1) {
    let node = root;
    if (!node.children) expand(node);
    while (node.children?.length && node.children.every((c) => c.visits > 0)) {
      const logN = Math.log(node.visits + 1);
      node = node.children.reduce((best, c) => {
        const own = c.actor === me ? c.wins / c.visits : 1 - c.wins / c.visits;
        const ucb = own + 1.41 * Math.sqrt(logN / c.visits);
        return ucb > best.ucb ? { c, ucb } : best;
      }, { c: node.children[0], ucb: -Infinity }).c;
      if (!node.children) {
        node.state ||= step(contract, node.parent.state, node.action, node.actor, rng);
        expand(node);
      }
    }
    if (node.children?.length) {
      const fresh = node.children.filter((c) => c.visits === 0);
      node = rng.pick(fresh);
      node.state = step(contract, node.parent.state, node.action, node.actor, rng);
      if (!node.state) {
        node.visits = 1;
        continue;
      }
    }
    const result = rollout(node.state || root.state);
    for (let n = node; n; n = n.parent) {
      n.visits += 1;
      n.wins += result;
    }
  }
  const ranked = (root.children || []).filter((c) => c.visits > 0).sort((a, b) => b.visits - a.visits);
  return ranked[0]?.action || null;
}

/**
 * يختار حركة الذكاء.
 * @returns {{id:string, payload:any}|null} واحدة من legalActions دائماً (أو null إن لم توجد)
 */
function chooseMove(contract, state, { actor, difficulty = "NORMAL", seed = "terboo" } = {}) {
  if (!contract.ai) return null;
  const legal = contract.controller.legalActions(state, actor);
  const free = contract.freeActions?.length && contract.controller.validateFree;
  if (!legal.length && !free) return null;
  const preset = presetFor(contract, difficulty);
  const rng = seeded(`${seed}:${difficulty}`);
  if (preset.noise && legal.length && rng.float() < preset.noise) return rng.pick(legal);
  let choice = null;
  const kind = contract.ai.kind || "heuristic";
  if (kind === "minimax") choice = minimax(contract, state, preset.depth, -Infinity, Infinity, actor, 0, rng).action;
  else if (kind === "mcts") choice = mcts(contract, state, actor, preset.iterations, rng);
  else if (kind === "custom" || kind === "heuristic") choice = contract.ai.choose(state, actor, { rng, legal, preset, difficulty: preset.level });
  // أمان: الذكاء لا يتجاوز الحركات القانونية أبداً (أو فحص الإجراء الحر على حالة الخادم)
  const valid = choice && legal.find((a) => sameAction(a, choice));
  if (valid) return valid;
  if (choice && free && contract.freeActions.includes(choice.id)) {
    const checked = contract.controller.validateFree(state, choice, actor);
    if (checked?.ok) return checked.action || choice;
  }
  return legal.length ? rng.pick(legal) : null;
}

export { PRESETS, chooseMove, mcts, minimax, presetFor, sameAction };
