// ═══════════════════════════════════════════════
// 🎲 عارضات لوحات الأركيد — رسوم CSS بدل JSON خام
// ───────────────────────────────────────────────
// المحرّك على الخادم يبني View Model موحّداً لكل لعبة:
//   grid  → {cols, cells:[{t,k,n,a,hl,pop,c}]}
//   lines → {lines:[string]}
//   track → {size, cols, ladders, snakes, tokens}
// هذا الملف يرسمها فقط. القواعد والدور والشرعية والنتيجة كلها في المحرّك.
//
// الأمان الذي يفرضه هذا الملف:
//   • الربط allowlist بمعرّف اللعبة: لعبة غير معروفة ⇒ عارض نصّي آمن.
//     ولا يُشتق أي عارض من بيانات اللعبة نفسها.
//   • لا HTML ولا JSX من بيانات اللعبة أبداً: كل نص يُعرض كعقدة نصّية.
//   • صنف الخلية يُنقّى إلى [a-z0-9_-]، واللون يُقبل فقط كـhex صالح.
//   • الخلية قابلة للنقر فقط إذا صرّح المحرّك بقيمة حركة لها (a).
// ═══════════════════════════════════════════════

import { useApp } from "../lib/store";
import type { GameBoard as Board, GameView, GridBoard, GridCell, LinesBoard, TrackBoard } from "../lib/types";

type Renderer = "grid" | "lines" | "track";

/**
 * allowlist: معرّف اللعبة ⇒ العارض المسموح لها.
 * المصدر هو عقود الألعاب الحقيقية في src/lib/terboo-arcade/games/.
 */
const RENDERER: Record<string, Renderer> = {
  // لوحات شبكية
  xo: "grid",
  connect4: "grid",
  gomoku: "grid",
  reversi: "grid",
  checkers: "grid",
  battleship: "grid",
  dotsboxes: "grid",
  g2048: "grid",
  memory: "grid",
  minesweeper: "grid",
  simon: "grid",
  snake: "grid",
  sudoku: "grid",
  breakout: "grid",
  // wordle يعطي board نصّية وvisualBoard شبكية — نفضّل الشبكية
  wordle_ar: "grid",
  // لوحات سطرية (كلمات · أسئلة · سجلّ محاولات)
  hangman: "lines",
  letter_rush: "lines",
  rps: "lines",
  bulls_cows: "lines",
  trivia_arena: "lines",
  math_duel: "lines",
  geo_battle: "lines",
  // مسار السلّم والثعبان
  snakes: "track",
};

/** حد أعلى للخلايا المرسومة: يحمي الواجهة من لوحة ضخمة غير متوقعة */
const MAX_CELLS = 1024;

const isGrid = (board: unknown): board is GridBoard =>
  Boolean(board) && (board as GridBoard).kind === "grid" && Array.isArray((board as GridBoard).cells);

const isLines = (board: unknown): board is LinesBoard =>
  Boolean(board) && (board as LinesBoard).kind === "lines" && Array.isArray((board as LinesBoard).lines);

const isTrack = (board: unknown): board is TrackBoard =>
  Boolean(board) && (board as TrackBoard).kind === "track" && Array.isArray((board as TrackBoard).tokens);

/** صنف من المحرّك ⇒ صنف CSS آمن */
function cellClass(kind: string | undefined): string {
  const safe = String(kind || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
  return safe ? ` cell--${safe}` : "";
}

/** لون من المحرّك: hex صالح فقط، وإلا يُهمَل */
function safeColor(value: string | undefined): string {
  const text = String(value || "").trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text) ? text : "";
}

/** يختار اللوحة التي يرسمها العارض المسموح */
function pickBoard(view: GameView, want: Renderer): unknown {
  if (want === "grid" && isGrid(view.visualBoard)) return view.visualBoard;
  return view.board;
}

/**
 * زخرفة واتساب الخفيفة (*عريض* و~مشطوب~) ⇒ عناصر React.
 * لا HTML: كل قطعة نصّ داخل <strong>/<s>/نصّ عادي.
 */
function decorate(line: string, keyPrefix: string) {
  const parts: Array<string | { tag: "b" | "s"; text: string }> = [];
  const pattern = /\*([^*\n]+)\*|~([^~\n]+)~/g;
  let cursor = 0;
  let match = pattern.exec(line);
  while (match) {
    if (match.index > cursor) parts.push(line.slice(cursor, match.index));
    if (match[1] !== undefined) parts.push({ tag: "b", text: match[1] });
    else if (match[2] !== undefined) parts.push({ tag: "s", text: match[2] });
    cursor = match.index + match[0].length;
    match = pattern.exec(line);
  }
  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (typeof part === "string") return <span key={key}>{part}</span>;
    if (part.tag === "b") return <strong key={key}>{part.text}</strong>;
    return <s key={key}>{part.text}</s>;
  });
}

function GridView({ board, onCell, disabled, label }: {
  board: GridBoard; onCell: (value: number | string) => void; disabled: boolean; label: string;
}) {
  const cols = Math.max(1, Math.min(32, Number(board.cols) || 1));
  const cells = board.cells.slice(0, MAX_CELLS);
  return (
    <div
      className="gboard gboard--grid"
      style={{ ["--gcols" as string]: String(cols) }}
      role="group"
      aria-label={label}
    >
      {cells.map((cell: GridCell, index: number) => {
        const playable = cell.a !== undefined && cell.a !== null && !disabled;
        const color = safeColor(cell.c);
        const classes = [
          "gcell",
          cellClass(cell.k),
          cell.hl ? " is-hl" : "",
          cell.pop ? " is-pop" : "",
          playable ? " is-playable" : "",
        ].join("");
        const style = color ? { ["--cell-color" as string]: color } : undefined;
        // النص والرقم من المحرّك — عقدة نصّية فقط
        const face = <span className="gcell__face">{cell.t ?? (cell.n !== undefined ? String(cell.n) : "")}</span>;
        if (!playable) {
          return (
            <div key={index} className={classes} style={style} aria-hidden={cell.t ? undefined : true}>
              {face}
            </div>
          );
        }
        return (
          <button
            key={index}
            type="button"
            className={classes}
            style={style}
            onClick={() => onCell(cell.a as number | string)}
            aria-label={cell.n !== undefined ? String(cell.n) : String(cell.t || index + 1)}
          >
            {face}
          </button>
        );
      })}
    </div>
  );
}

function LinesView({ board, label }: { board: LinesBoard; label: string }) {
  const lines = board.lines.slice(0, 200);
  return (
    <div className="gboard gboard--lines" role="group" aria-label={label}>
      {lines.length === 0 ? <span className="gline gline--empty" /> : null}
      {lines.map((line, index) => (
        <p key={index} className="gline">{decorate(String(line ?? ""), `l${index}`)}</p>
      ))}
    </div>
  );
}

function TrackView({ board, label }: { board: TrackBoard; label: string }) {
  const cols = Math.max(1, Math.min(20, Number(board.cols) || 10));
  const size = Math.max(1, Math.min(MAX_CELLS, Number(board.size) || 100));
  const up = new Map<number, number>();
  const down = new Map<number, number>();
  for (const [from, to] of board.ladders || []) up.set(Number(from), Number(to));
  for (const [from, to] of board.snakes || []) down.set(Number(from), Number(to));
  const tokensAt = new Map<number, string[]>();
  for (const token of board.tokens || []) {
    const position = Number(token.pos) || 0;
    if (!tokensAt.has(position)) tokensAt.set(position, []);
    tokensAt.get(position)?.push(String(token.mark || "●"));
  }

  // ترتيب لوحة السلّم والثعبان: الصفوف تتبادل الاتجاه، والرقم 1 أسفل اليسار
  const rows: number[][] = [];
  for (let start = 0; start < size; start += cols) {
    const row = Array.from({ length: Math.min(cols, size - start) }, (_, i) => start + i + 1);
    rows.push(Math.floor(start / cols) % 2 === 1 ? row.reverse() : row);
  }
  rows.reverse();

  return (
    <div className="gboard gboard--track" style={{ ["--gcols" as string]: String(cols) }} role="group" aria-label={label}>
      {rows.flat().map((number) => {
        const marks = tokensAt.get(number) || [];
        const hasLadder = up.has(number);
        const hasSnake = down.has(number);
        return (
          <div
            key={number}
            className={`gcell gcell--track${hasLadder ? " is-ladder" : ""}${hasSnake ? " is-snake" : ""}${marks.length ? " is-occupied" : ""}`}
          >
            <span className="gcell__num">{number}</span>
            {hasLadder ? <span className="gcell__jump" aria-label="ladder">↑</span> : null}
            {hasSnake ? <span className="gcell__jump" aria-label="snake">↓</span> : null}
            {marks.length ? <span className="gcell__tokens">{marks.join("")}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/** احتياط آمن: نصّ فقط، بلا JSON خام وبلا HTML */
function TextView({ view, label }: { view: GameView; label: string }) {
  const board = view.board;
  const text = typeof board === "string"
    ? board
    : isLines(board)
      ? board.lines.join("\n")
      : "";
  return (
    <div className="gboard gboard--lines" role="group" aria-label={label}>
      {text
        ? text.split("\n").slice(0, 200).map((line, index) => (
          <p key={index} className="gline">{decorate(line, `t${index}`)}</p>
        ))
        : <p className="gline gline--empty">{view.status || ""}</p>}
    </div>
  );
}

/** هل هذه اللعبة لها عارض رسومي مسموح؟ */
export function hasGraphicalBoard(view: GameView): boolean {
  const want = RENDERER[view.gameId];
  if (!want) return false;
  const board = pickBoard(view, want);
  if (want === "grid") return isGrid(board);
  if (want === "lines") return isLines(board);
  return isTrack(board);
}

export function GameBoardView({ view, onCell, disabled = false }: {
  view: GameView; onCell: (value: number | string) => void; disabled?: boolean;
}) {
  const { t } = useApp();
  const label = t("games.board");
  const want = RENDERER[view.gameId];
  const board: Board | string | null | undefined = pickBoard(view, want || "lines") as never;

  if (want === "grid" && isGrid(board)) return <GridView board={board} onCell={onCell} disabled={disabled} label={label} />;
  if (want === "lines" && isLines(board)) return <LinesView board={board} label={label} />;
  if (want === "track" && isTrack(board)) return <TrackView board={board} label={label} />;
  // لعبة غير مُدرَجة أو لوحة بشكل غير متوقع ⇒ نصّ آمن
  return <TextView view={view} label={label} />;
}

export { RENDERER as GAME_RENDERERS, safeColor, cellClass, decorate };
