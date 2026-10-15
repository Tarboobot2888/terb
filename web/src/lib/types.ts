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

export type ToolResult = {
  ok: boolean; id: string; category: string; source: string; kind: string;
  text: string;
  items: Array<{ type: string; url: string; external: boolean; title: string; mimetype: string; sizeBytes: number | null; durationSeconds: number | null }>;
  error: string; latencyMs: number;
  attempts: Array<{ id: string; via: string; ok: boolean; latencyMs: number; skipped: string }>;
};

export type GameRow = {
  id: string; title: string; icon: string; category: string; mode: string;
  uiMode: string; players: { min: number; max: number };
  supportsAI: boolean; supportsPrivate: boolean;
  webRunnable: boolean; unavailableReason: string;
};

export type GameView = {
  gameId: string; roomId: string; sessionId: string; state: string;
  nonce: number; title: string; icon: string; category: string;
  turn?: number | null; viewerSeat: number;
  players: Array<{ name: string; seat: number; isAI: boolean; ready: boolean; host: boolean; me: boolean; label: string }>;
  actions: Array<{ type: string; value?: unknown; label?: string }>;
  result?: unknown;
  board?: unknown;
  [key: string]: unknown;
};

export type GroupRow = {
  groupId: string; subject: string; size: number;
  isGroupAdmin: boolean; isGroupOwner: boolean; botIsAdmin: boolean;
};

export type SubBotsResponse = {
  subBots: Array<{ ref: string; active: boolean; status: string; startedAt: number | null; uptimeMs: number | null; mine: boolean }>;
  pairing: { availableInWeb: boolean; reason: string };
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
