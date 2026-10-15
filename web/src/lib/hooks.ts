// خطّافات مشتركة: جلب مع إلغاء · تأخير البحث · مؤقّت تنازلي · وسائط
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** جلب يُلغى عند التنقّل، بحالات تحميل/خطأ/إعادة حقيقية */
export function useFetch<T>(
  path: string | null,
  deps: readonly unknown[] = [],
): { data: T | null; loading: boolean; error: unknown; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.get<T>(path, controller.signal)
      .then((out) => { if (!controller.signal.aborted) { setData(out); setLoading(false); } })
      .catch((cause) => {
        if (controller.signal.aborted || (cause as Error)?.name === "AbortError") return;
        setError(cause);
        setLoading(false);
      });
    return () => controller.abort();
     
  }, [path, tick, ...deps]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, loading, error, reload };
}

/** تأخير للبحث حتى لا يُرسل طلب لكل حرف */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** عدّاد تنازلي بالثواني */
export function useCountdown(seconds: number): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => { setLeft(seconds); }, [seconds]);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return Math.max(0, left);
}

/** استعلام وسائط (للتخطيط المتجاوب في JS حيث يلزم) */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener("change", onChange);
    setMatches(list.matches);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** هل المستخدم يفضّل تقليل الحركة؟ */
export function useReducedMotion(): boolean {
  return useMedia("(prefers-reduced-motion: reduce)");
}

/** إدارة التركيز داخل حوار/درج */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    const node = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => [...node.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )];
    focusables()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [active]);
  return ref;
}
