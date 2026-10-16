// أشكال الردود كما يعيدها الخادم فعلاً
export type Lang = "ar" | "en";

export type Profile = {
  accountRef: string;
  phoneMasked: string;
  name: string | null;
  registered: boolean;
  role: "owner" | "partner" | "premium" | "user";
  isOwner: boolean;
  isPremium: boolean;
  isPartner: boolean;
  language: Lang;
  economy: {
    level: number | null; exp: number | null; energi: number | null;
    koin: number | null; saldo: number | null; unlimited: boolean;
  } | null;
  createdAt: string | null;
  lastSeen: string | null;
  existsInBotDatabase: boolean;
};

export type PublicCapabilities = {
  site: { state: string; secure: boolean };
  whatsapp: { connected: boolean };
  ai: { available: boolean; providerCount: number; vision: boolean };
  features: Record<string, boolean>;
  queue: { depth: number | null };
};

export type ToolRow = {
  id: string; category: string; source: string; kind: string;
  purpose: string; output: string; permission: string;
  timeoutMs: number; maxBytes: number;
  input: { required?: string[]; properties?: Record<string, { type?: string; description?: string }> } | null;
  platforms: string[];
  webRunnable: boolean; unavailableReason: string;
};

export type CommandRow = {
  command: string; alias: string[]; category: string;
  description: string; usage: string; example: string;
  requires: Record<string, boolean>;
  cost: { cooldown: number; energi: number };
  enabled: boolean; channel: string;
  webRunnable: boolean; unavailableReason: string;
};

export type CategoryRow = { category: string; commandCount: number; image: string | null };

export type Conversation = {
  id: string; title: string; lang: string; archived: boolean;
  messageCount: number; createdAt: number; updatedAt: number;
};

export type ChatMessage = {
  id: string; role: "user" | "assistant"; text: string; at: number;
  provider?: string; toolId?: string; artifacts?: string[];
};

export type AnswerResult = {
  text: string; intent: string; provider: string; route: string;
  latencyMs?: number; fallbackUsed?: boolean; executed: boolean; reason?: string;
};

export type TaskRow = {
  id: string; type: string; title: string; status: string; note: string;
  createdAt: number; startedAt: number | null; finishedAt: number | null;
  progress: number | null; stage: string;
  controls: { cancel: boolean; resume: boolean; retry: boolean };
  error: string; result: unknown;
};

export type ArtifactRow = {
  id: string; kind: string; mime: string; bytes: number; name: string;
  sha256: string; createdAt: number; expiresAt: number; source: string;
  downloadPath: string;
};

export type ResultItem = {
  type: string; url: string; external: boolean; title: string;
  /** مقتطف/مدّة/فنان كما صرّح به السجل */
  note: string;
  thumbnail: boolean;
  mimetype: string; sizeBytes: number | null; durationSeconds: number | null;
  /** بايتات بلا رابط: تُحفَظ أثراً مملوكاً ويُنزَّل من مسار محمي */
  bytesOnly: boolean; artifactId: string; downloadPath: string;
};

export type ToolResult = {
  ok: boolean; id: string; category: string; source: string; kind: string;
  title: string;
  text: string;
  items: ResultItem[];
  error: string; latencyMs: number;
  attempts: Array<{ id: string; via: string; ok: boolean; latencyMs: number; skipped: string }>;
};

// ── التنزيلات ──────────────────────────────────
export type DownloadPlatform = {
  platform: string; scrapers: string[]; outputs: string[]; available: boolean;
};

export type DownloadTarget = {
  url: string; host: string; platform: string; supported: boolean;
  scrapers: string[]; outputs: string[]; available: boolean; reason: string;
};

export type DownloadJob = {
  taskId: string; status: string; platform: string; poll: string;
};

/** نتيجة مهمة تنزيل كما يعيدها الطابور في task.result */
export type DownloadOutcome = {
  platform: string; host: string; ok: boolean;
  result: ToolResult | null;
  tried: Array<{ id: string; ok: boolean; error: string; latencyMs: number }>;
};

// ── البحث ──────────────────────────────────────
export type SearchSource = {
  id: string; purpose: string; platforms: string[]; permission: string;
  available: boolean; unavailableReason: string;
};

export type SearchHit = {
  title: string; url: string; domain: string; snippet: string;
  thumbnail: boolean; external: boolean;
};

export type SearchResponse = {
  query: string; source: string; ok: boolean; reason: string;
  results: SearchHit[]; text: string; latencyMs: number;
};

export type GameRow = {
  id: string; title: string; icon: string; category: string; mode: string;
  uiMode: string; players: { min: number; max: number };
  supportsAI: boolean; supportsPrivate: boolean;
  webRunnable: boolean; unavailableReason: string;
};

/**
 * لوحات محرّك الأركيد كما يبنيها renderer.view لكل لعبة.
 * الأنواع الثلاثة هي كل ما يُنتجه المحرّك فعلاً: grid · lines · track.
 */
export type GridCell = {
  /** النص المعروض (رمز/حرف/رقم) — يُعرض نصاً لا HTML */
  t?: string;
  /** صنف الخلية من المحرّك (empty · x · o · color …) */
  k?: string;
  /** رقم الخلية المعروض */
  n?: number;
  /** قيمة الحركة لهذه الخلية؛ غيابها يعني خلية غير قابلة للنقر */
  a?: number | string;
  /** إبراز (خط فائز مثلاً) */
  hl?: boolean;
  /** آخر حركة — لحركة ظهور قصيرة */
  pop?: boolean;
  /** لون من المحرّك (hex) — يُفحَص قبل أي استعمال في style */
  c?: string;
};

export type GridBoard = { kind: "grid"; cols: number; cells: GridCell[] };
export type LinesBoard = { kind: "lines"; lines: string[] };
export type TrackBoard = {
  kind: "track"; size: number; cols: number;
  ladders: Array<[number, number]>;
  snakes: Array<[number, number]>;
  tokens: Array<{ pos: number; mark: string; seat: number }>;
};
export type GameBoard = GridBoard | LinesBoard | TrackBoard;

export type GamePanel = { label: string; value: string };

export type GameView = {
  gameId: string; roomId: string; sessionId: string; state: string;
  nonce: number; title: string; icon: string; category: string;
  uiMode?: string;
  turn?: number | null; viewerSeat: number;
  players: Array<{ name: string; seat: number; isAI: boolean; difficulty: string | null; ready: boolean; host: boolean; me: boolean; label: string }>;
  actions: Array<{ type: string; value?: unknown; label?: string }>;
  result?: unknown;
  board?: GameBoard | string | null;
  /** لوحة رسومية أغنى تقدّمها بعض الألعاب إلى جانب board النصّية */
  visualBoard?: GridBoard | null;
  status?: string;
  panels?: GamePanel[];
  marks?: string[];
  scores?: number[];
  [key: string]: unknown;
};

export type GroupRow = {
  groupId: string; subject: string; size: number;
  isGroupAdmin: boolean; isGroupOwner: boolean; botIsAdmin: boolean;
};

export type SubBotsResponse = {
  subBots: Array<{ ref: string; active: boolean; status: string; startedAt: number | null; uptimeMs: number | null; mine: boolean }>;
  pairing: { availableInWeb: boolean; label?: string; targetsOwnNumberOnly?: boolean; reason?: string };
};

/** حالات تدفق التنصيب كما يعلنها الخادم (لا حالة مُستنتَجة في الواجهة) */
export type PairingState =
  | "validating" | "creating" | "waiting-for-pairing-code" | "code-ready"
  | "connecting" | "connected" | "following-channel" | "ready"
  | "failed" | "expired" | "cancelled";

export type PairingRequest = {
  requestId: string;
  state: PairingState;
  /** وسم تدفق التنصيب (TARBOOV6) — ليس رمزاً ولا سرّاً */
  label: string;
  maskedTarget: string;
  expiresInSeconds: number;
  /** الرمز الحقيقي — يظهر للطالب وحده وضمن نافذة قصيرة فقط */
  code?: string;
  copyCode?: string;
};

export type SessionRow = {
  id: string; current: boolean; createdAt: number;
  lastSeenAt: number; expiresAt: number; agent: string;
};

export type OwnerOverview = {
  site: { state: string; listening: boolean; url: string; secure: boolean; domain: string; domainVerified: boolean; tlsMode: string; port: number };
  whatsapp: { connected: boolean; ready: boolean; uptimeMs: number | null; unavailable?: boolean };
  users: { total: number; registered: number; premium: number; banned: number; ownersConfigured: number };
  registry: { plugins: number; categories: number; tools: number };
  queue: Record<string, number>;
  store: Record<string, unknown>;
  auth: { liveChallenges: number; tracked: number };
  process: { uptimeSeconds: number; nodeVersion: string; rssBytes: number };
};
