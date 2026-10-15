// حالة التطبيق: اللغة · الجلسة · التنبيهات — بلا مكتبة حالة إضافية
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, api, setCsrfToken } from "./api";
import { applyDocumentLang, detectLang, rememberLang, translate } from "./i18n";
import type { Lang, Profile } from "./types";

type Toast = { id: number; text: string; kind: "info" | "error" | "success" };

type AppState = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, ...args: (string | number)[]) => string;
  profile: Profile | null;
  authState: "checking" | "anonymous" | "signed-in";
  signedIn: (csrfToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  reloadProfile: () => Promise<void>;
  toasts: Toast[];
  notify: (text: string, kind?: Toast["kind"]) => void;
  /** رسالة خطأ مفهومة من أي خطأ API */
  errorText: (error: unknown) => string;
};

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectLang());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authState, setAuthState] = useState<AppState["authState"]>("checking");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  useEffect(() => {
    applyDocumentLang(lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    rememberLang(next);
  }, []);

  const t = useCallback((key: string, ...args: (string | number)[]) => translate(lang, key, ...args), [lang]);

  const notify = useCallback((text: string, kind: Toast["kind"] = "info") => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((list) => [...list, { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), 5200);
  }, []);

  const errorText = useCallback((error: unknown): string => {
    if (error instanceof ApiError) {
      // الرسالة من الخادم آمنة للعرض؛ بعض الرموز لها نص أوضح في الواجهة
      if (error.code === "RATE_LIMITED") {
        const seconds = Number(error.details?.["retryAfterSeconds"]) || 0;
        return seconds ? translate(lang, "login.resendIn", seconds) : error.message;
      }
      if (error.code === "BOT_OFFLINE") return translate(lang, "login.botOffline");
      return error.message;
    }
    if ((error as Error)?.name === "AbortError") return "";
    return translate(lang, "common.error");
  }, [lang]);

  const reloadProfile = useCallback(async () => {
    try {
      const out = await api.get<{ profile: Profile }>("/me");
      setProfile(out.profile);
      setAuthState("signed-in");
      if (out.profile.language && out.profile.language !== lang) setLangState(out.profile.language);
    } catch (error) {
      setProfile(null);
      setAuthState("anonymous");
      if (error instanceof ApiError && error.code === "ACCOUNT_BANNED") notify(error.message, "error");
    }
  }, [lang, notify]);

  // استعادة الجلسة بعد تحديث الصفحة: الكوكي موجود، نحتاج رمز CSRF فقط
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hasSession = await api.refreshCsrf();
      if (cancelled) return;
      if (!hasSession) {
        setAuthState("anonymous");
        return;
      }
      await reloadProfile();
    })();
    return () => { cancelled = true; };
    // مرة واحدة عند الإقلاع
     
  }, []);

  const signedIn = useCallback(async (csrfToken: string) => {
    setCsrfToken(csrfToken);
    await reloadProfile();
  }, [reloadProfile]);

  const signOut = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // الخروج محلي أيضاً: الجلسة تُسقط من الواجهة في كل الأحوال
    }
    setCsrfToken("");
    setProfile(null);
    setAuthState("anonymous");
  }, []);

  const value = useMemo<AppState>(() => ({
    lang, setLang, t, profile, authState, signedIn, signOut, reloadProfile, toasts, notify, errorText,
  }), [lang, setLang, t, profile, authState, signedIn, signOut, reloadProfile, toasts, notify, errorText]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const value = useContext(Ctx);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
