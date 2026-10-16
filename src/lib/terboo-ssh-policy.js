// ═══════════════════════════════════════════════
// 🧱 Terboo SSH Command Policy — سياسة أوامر SSH (§17 §29 §30)
// ───────────────────────────────────────────────
// الأوامر تُمرَّر كمصفوفة argv فقط (لا نص shell): كل وسيط يُقتبس منفرداً عند الإرسال ⇒ لا أنابيب ولا
// إعادة توجيه ولا ربط أوامر يمكن حقنها. فوق ذلك تصنيف صريح لكل أمر:
//   read   · قراءة/تشخيص (يُنفّذ مباشرة للمالك)
//   write  · يغيّر حالة (تثبيت/بناء/تشغيل/نسخ/حذف داخل مساحة العمل) ⇒ تأكيد مركزي (ssh.write)
//   denied · مدمّر للنظام أو يكشف أسراراً أو يفتح shell/تنفيذاً متداخلاً ⇒ مرفوض دائماً بسبب صريح
// المسارات في أوامر الكتابة يجب أن تكون داخل مساحة العمل (workspace) — لا كتابة على النظام عبر الذكاء.
// بلا حظر مفرط: أوامر التشخيص الشائعة كلها مسموحة.
// ═══════════════════════════════════════════════

import path from "node:path";

const LEVEL = Object.freeze({ READ: "read", WRITE: "write", DENIED: "denied" });

/** أسرار لا تُقرأ أبداً (ولا تظهر للذكاء أو المستخدم) */
const SECRET_PATH = /(?:^|\/)(?:\.env(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|authorized_keys|known_hosts|\.ssh(?:\/|$)|shadow|gshadow|sudoers|\.git-credentials|\.npmrc|\.pgpass|\.netrc|credentials(?:\.json)?|master\.key|.*\.pem|.*\.key)$/i;
/** برامج shell/تنفيذ متداخل/مدمّرة/تكشف بيئة — مرفوضة كأمر أول */
const DENIED_BINARIES = new Set([
  "sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh", "su", "sudo", "doas", "ssh", "scp", "sftp", "telnet", "nc", "ncat", "netcat", "socat",
  "eval", "exec", "source", ".", "xargs", "env", "printenv", "export", "set", "history",
  "mkfs", "mke2fs", "fdisk", "parted", "dd", "shred", "wipefs", "swapoff", "mount", "umount",
  "shutdown", "reboot", "halt", "poweroff", "init", "telinit",
  "useradd", "userdel", "usermod", "passwd", "chpasswd", "groupadd", "groupdel", "visudo", "chown", "crontab", "iptables", "ip6tables", "nft", "ufw",
  "perl", "ruby", "php", "lua", "awk", "gawk", "sed",
]);
/** wget غير موجود هنا عمداً: يكتب ملفاً افتراضياً (ليس قراءة) */
const READ_BINARIES = new Set(["echo", "printf", "true", "ls", "cat", "head", "tail", "df", "du", "free", "uptime", "uname", "whoami", "id", "hostname", "ps", "pwd", "stat", "wc", "grep", "nproc", "which", "date", "lsblk", "lscpu", "file", "md5sum", "sha256sum", "ss", "netstat", "ping", "dig", "nslookup", "curl", "top", "vmstat", "iostat", "find", "tree", "realpath", "readlink"]);

/** أوامر لها أوامر فرعية: قراءة/كتابة/مرفوض حسب الفرعي */
const SUBCOMMANDS = {
  systemctl: { read: ["status", "is-active", "is-enabled", "list-units", "list-unit-files", "show"], write: ["start", "stop", "restart", "reload"] },
  journalctl: { read: ["*"] },
  docker: { read: ["ps", "logs", "images", "inspect", "stats", "version", "info"], write: ["start", "stop", "restart", "pull", "compose", "build", "run", "rm"] },
  git: { read: ["status", "log", "diff", "branch", "rev-parse", "remote", "show", "fetch"], write: ["pull", "clone", "checkout", "reset", "stash", "init", "add", "commit"] },
  pm2: { read: ["ls", "list", "status", "describe", "show", "logs", "jlist", "prettylist"], write: ["start", "restart", "stop", "delete", "save", "reload"] },
  npm: { read: ["-v", "--version", "ls", "list", "outdated", "view", "config"], write: ["ci", "install", "i", "run", "test", "start", "build", "rebuild", "uninstall", "update"] },
  yarn: { read: ["--version", "list", "info"], write: ["install", "build", "run", "add", "remove"] },
  pnpm: { read: ["--version", "list"], write: ["install", "i", "run", "build", "add"] },
  pip: { read: ["--version", "list", "show", "freeze"], write: ["install", "uninstall"] },
  pip3: { read: ["--version", "list", "show", "freeze"], write: ["install", "uninstall"] },
  node: { read: ["-v", "--version", "--check", "-c"], write: ["*"] },
  python3: { read: ["--version", "-V", "-m py_compile"], write: ["*"] },
  python: { read: ["--version", "-V"], write: ["*"] },
  apt: { read: ["list", "show", "search", "policy"], write: ["install", "update", "upgrade"] },
  "apt-get": { read: [], write: ["install", "update", "upgrade"] },
};
/** أوامر كتابة على الملفات: كل مسار يجب أن يكون داخل مساحة العمل */
const FILE_WRITERS = new Set(["mkdir", "rm", "rmdir", "cp", "mv", "touch", "unzip", "tar", "chmod", "ln", "tee", "truncate"]);
const PROCESS_WRITERS = new Set(["kill", "pkill"]);

const result = (level, reason) => ({ level, allowed: level !== LEVEL.DENIED, reason });

/** مسار داخل الجذر؟ (بعد التطبيع؛ نسبي ⇒ نسبة لمجلد العمل الحالي داخل الجذر) */
function inside(root, target, cwd = root) {
  if (!root) return false;
  const base = path.posix.normalize(root.replace(/\/+$/, ""));
  const full = path.posix.normalize(target.startsWith("/") ? target : path.posix.join(cwd || base, target));
  return full === base || full.startsWith(`${base}/`);
}

const pathArgs = (args) => args.filter((arg) => !arg.startsWith("-"));

/**
 * يصنّف أمراً.
 * @param {string[]} argv
 * @param {{workspace?:string, cwd?:string}} [context]
 * @returns {{level:"read"|"write"|"denied", allowed:boolean, reason:string}}
 */
function classify(argv, { workspace = "", cwd = "" } = {}) {
  if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== "string")) return result(LEVEL.DENIED, "invalid-argv");
  if (argv.some((a) => a.includes("\0") || a.length > 4096)) return result(LEVEL.DENIED, "invalid-argv");
  // «ls | grep» كنص: الاقتباس يمنع أثره، لكن الرفض الصريح أوضح من أمر يفعل شيئاً غير المقصود
  if (hasShellSyntax(argv)) return result(LEVEL.DENIED, "shell-syntax");
  const [rawBin, ...args] = argv;
  const bin = path.posix.basename(rawBin);
  if (bin !== rawBin && !/^\/(?:usr\/)?(?:s?bin|local\/bin)\//.test(rawBin)) return result(LEVEL.DENIED, "binary-path");
  if (/^mkfs/.test(bin) || DENIED_BINARIES.has(bin)) return result(LEVEL.DENIED, ["denied-binary", bin].join(":"));
  // لا قراءة لملفات الأسرار ولا تسريبها للمخرجات (المالك نفسه يقرأها خارج البوت إن أراد)
  if (args.some((a) => SECRET_PATH.test(a.replace(/^.*=/, "")))) return result(LEVEL.DENIED, "secret-path");
  if (["curl", "wget"].includes(bin) && args.some((a) => /^-(?:o|O|T|d|F|X)$|^--(?:output|upload-file|data|form|request)/.test(a))) return result(LEVEL.DENIED, "network-write");
  if (bin === "find" && args.some((a) => /^-(?:delete|exec|execdir|ok|okdir|fprint)/.test(a))) return result(LEVEL.DENIED, "find-action");
  if (READ_BINARIES.has(bin)) return result(LEVEL.READ, "read");

  const sub = SUBCOMMANDS[bin];
  if (sub) {
    const first = args.find((a) => !/^--?[a-z]/i.test(a) || ["-v", "--version", "-V", "--check", "-c"].includes(a)) || args[0] || "";
    const joined = args.slice(0, 2).join(" ");
    if (sub.read?.includes("*") || sub.read?.includes(first) || sub.read?.includes(joined)) {
      if (bin === "git" && first === "fetch") return result(LEVEL.WRITE, "git-fetch");
      return result(LEVEL.READ, ["read", bin, first].join(":"));
    }
    if (sub.write?.includes("*") || sub.write?.includes(first)) {
      // تشغيل سكربت/ملف داخل مساحة العمل فقط
      if (["node", "python", "python3"].includes(bin)) {
        const file = args.find((a) => !a.startsWith("-"));
        if (args.some((a) => ["-e", "--eval", "-p", "--print", "-c"].includes(a))) return result(LEVEL.DENIED, "inline-code");
        if (!file || (workspace && !inside(workspace, file, cwd))) return result(LEVEL.DENIED, "outside-workspace");
      }
      // pm2 start لملف: داخل مساحة العمل فقط (بالاسم = عملية مسجّلة أصلاً)
      if (bin === "pm2" && first === "start") {
        const target = args.slice(args.indexOf("start") + 1).find((a) => !a.startsWith("-"));
        if (target && /[/.]/.test(target) && (!workspace || !inside(workspace, target, cwd))) return result(LEVEL.DENIED, "outside-workspace");
      }
      if (bin === "docker" && first === "run" && args.some((a) => /^--privileged|^-v=?\/(?:$|:)|^--volume=?\/(?:$|:)|^--pid=host|^--net(?:work)?=host/.test(a))) return result(LEVEL.DENIED, "docker-privileged");
      if (bin === "git" && first === "reset" && args.includes("--hard") && !workspace) return result(LEVEL.DENIED, "outside-workspace");
      return result(LEVEL.WRITE, ["write", bin, first].join(":"));
    }
    return result(LEVEL.DENIED, ["unknown-subcommand", bin, first].join(":"));
  }

  if (FILE_WRITERS.has(bin)) {
    if (!workspace) return result(LEVEL.DENIED, "no-workspace");
    const targets = bin === "tar" ? args.filter((a, i) => !a.startsWith("-") || args[i - 1] === "-C") : pathArgs(args);
    if (bin === "chmod" && targets.length) targets.shift();
    if (bin === "unzip") {
      const dest = args[args.indexOf("-d") + 1];
      if (args.includes("-d") && dest && !inside(workspace, dest, cwd)) return result(LEVEL.DENIED, "outside-workspace");
    }
    if (bin === "rm" && targets.some((t) => path.posix.normalize(t.startsWith("/") ? t : path.posix.join(cwd || workspace, t)) === path.posix.normalize(workspace))) return result(LEVEL.DENIED, "rm-workspace-root");
    if (targets.some((t) => !inside(workspace, t, cwd))) return result(LEVEL.DENIED, "outside-workspace");
    return result(LEVEL.WRITE, ["write", bin].join(":"));
  }
  if (PROCESS_WRITERS.has(bin)) {
    if (args.some((a) => /^-?1$|^-1$/.test(a) || a === "0")) return result(LEVEL.DENIED, "kill-all");
    return result(LEVEL.WRITE, ["write", bin].join(":"));
  }
  return result(LEVEL.DENIED, ["not-allowed", bin].join(":"));
}

/** اقتباس shell آمن لوسيط واحد (POSIX): كل شيء حرفي داخل '…' */
function quoteArg(arg) {
  return `'${String(arg).replace(/'/g, "'\\''")}'`;
}

/** argv ⇒ سطر أمر لقناة exec (كل وسيط مقتبس؛ cd اختياري مقتبس أيضاً) */
function commandLine(argv, { cwd = "" } = {}) {
  const line = argv.map(quoteArg).join(" ");
  return cwd ? `cd ${quoteArg(cwd)} && ${line}` : line;
}

/**
 * تقسيم أمر كتبه المالك بنفسه (لا الذكاء) إلى argv: مسافات + علامات اقتباس، بلا أي تفسير shell
 * (أنابيب/توجيه/ربط تبقى نصاً حرفياً ⇒ وسيطاً عادياً، والسياسة ترفض ما لا تعرفه).
 * @returns {string[]|null}
 */
function splitArgs(text) {
  const out = [];
  let current = "";
  let quote = "";
  let has = false;
  for (const ch of String(text || "")) {
    if (quote) {
      if (ch === quote) quote = "";
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === "\"") { quote = ch; has = true; continue; }
    if (/\s/.test(ch)) {
      if (current || has) out.push(current);
      current = "";
      has = false;
      continue;
    }
    current += ch;
  }
  if (quote) return null;
  if (current || has) out.push(current);
  return out;
}

/**
 * عامل shell قائم بذاته («ls | sh» · «a && b») — كان المستخدم يقصد ربط أوامر؛ يُرفض بوضوح.
 * أما `…` أو $(…) داخل وسيط فحرفي تماماً بالاقتباس (echo يطبعه كما هو) ⇒ لا حظر مفرط.
 */
function hasShellSyntax(argv) {
  return argv.some((a) => /^(?:\||\|\||&&|;|>|>>|<|&|2>&1|2>)$/.test(a));
}

export { LEVEL, SECRET_PATH, classify, commandLine, hasShellSyntax, inside, quoteArg, splitArgs };
export default { classify, commandLine, quoteArg, splitArgs, inside, LEVEL };
