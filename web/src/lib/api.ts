// ═══════════════════════════════════════════════
// عميل /api/v1 — مغلّف خطأ واحد ورمز CSRF وإلغاء
// ───────────────────────────────────────────────
// • الجلسة في كوكي HttpOnly: لا رمز وصول في localStorage ولا في الذاكرة.
// • رمز CSRF يُجلب من /auth/csrf ويُرسل في X-CSRF-Token لكل طلب يغيّر حالة.
// • كل طلب يقبل AbortSignal: التنقّل يلغي الطلبات المعلّقة.
// ═══════════════════════════════════════════════

export type ApiErrorBody = {
  error: { code: string; message: string; requestId: string; details?: Record<string, unknown> };
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, body: ApiErrorBody | null, fallback = "Request failed") {
    super(body?.error?.message || fallback);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error?.code || "NETWORK";
    this.requestId = body?.error?.requestId || "";
    this.details = body?.error?.details;
  }
}

const BASE = "/api/v1";
let csrfToken = "";

export function setCsrfToken(token: string): void {
  csrfToken = token || "";
}

export function hasCsrfToken(): boolean {
  return Boolean(csrfToken);
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  raw?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

async function call<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method || "GET";
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  const init: RequestInit = { method, headers, credentials: "same-origin" };
  if (options.signal) init.signal = options.signal;

  if (method !== "GET") {
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
    if (options.raw !== undefined) {
      init.body = options.raw;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch (error) {
    // إلغاء المستخدم ليس خطأ شبكة: يُعاد كما هو ليتجاهله المتصل
    if ((error as Error)?.name === "AbortError") throw error;
    throw new ApiError(0, null, "Could not reach the service. Check your connection.");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) throw new ApiError(response.status, parsed as ApiErrorBody | null);
  return parsed as T;
}

export const api = {
  get: <T,>(path: string, signal?: AbortSignal) => call<T>(path, { method: "GET", ...(signal ? { signal } : {}) }),
  post: <T,>(path: string, body?: unknown, signal?: AbortSignal) =>
    call<T>(path, { method: "POST", ...(body !== undefined ? { body } : {}), ...(signal ? { signal } : {}) }),
  patch: <T,>(path: string, body?: unknown, signal?: AbortSignal) =>
    call<T>(path, { method: "PATCH", ...(body !== undefined ? { body } : {}), ...(signal ? { signal } : {}) }),
  del: <T,>(path: string, signal?: AbortSignal) => call<T>(path, { method: "DELETE", ...(signal ? { signal } : {}) }),
  /** رفع ملف كبايتات خام (لا multipart) */
  upload: <T,>(file: File, signal?: AbortSignal) =>
    call<T>("/media/uploads", {
      method: "POST",
      raw: file,
      headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": file.name },
      ...(signal ? { signal } : {}),
    }),
  /** يجلب رمز CSRF للجلسة الحالية (بعد تحديث الصفحة) */
  async refreshCsrf(): Promise<boolean> {
    try {
      const out = await call<{ csrfToken: string }>("/auth/csrf");
      setCsrfToken(out.csrfToken);
      return true;
    } catch {
      setCsrfToken("");
      return false;
    }
  },
};
