// الجذر: splash ⇒ landing/login ⇒ التطبيق. التوجيه بالـhash (بلا راوتر خارجي).
// الأقسام المرئية خمسة: الذكاء · الألعاب · التنزيلات · البحث · البوتات الفرعية.
// الحساب ولوحة المالك يُفتحان من قائمة الحساب في الشريط العلوي لا كقسمين.
import { useCallback, useEffect, useState } from "react";
import { Splash } from "./components/Splash";
import { Shell } from "./components/Shell";
import type { Route } from "./components/Shell";
import { Toasts } from "./components/ui";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { AIWorkspace } from "./pages/AIWorkspace";
import { Games } from "./pages/Games";
import { Downloads } from "./pages/Downloads";
import { Search } from "./pages/Search";
import { SubBots } from "./pages/SubBots";
import { Account } from "./pages/Account";
import { Owner } from "./pages/Owner";
import { useApp } from "./lib/store";

const ROUTES: Route[] = ["ai", "games", "downloads", "search", "subbots", "account", "owner"];
const DEFAULT_ROUTE: Route = "ai";

const routeFromHash = (): Route => {
  const value = window.location.hash.replace(/^#\/?/, "");
  return (ROUTES as string[]).includes(value) ? (value as Route) : DEFAULT_ROUTE;
};

export function App() {
  const { authState } = useApp();
  // Splash مرة واحدة لكل تبويب؛ تحديث الصفحة لا يعيد عرضها
  const [splashDone, setSplashDone] = useState(() => {
    try {
      return sessionStorage.getItem("terboo.splash") === "1";
    } catch {
      return false;
    }
  });
  const [wantsLogin, setWantsLogin] = useState(false);
  const [route, setRoute] = useState<Route>(routeFromHash);
  /** رابط يُرسل من البحث إلى التنزيلات بنقرة صريحة من المستخدم */
  const [handoffUrl, setHandoffUrl] = useState("");

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((next: Route) => {
    window.location.hash = `#/${next}`;
    setRoute(next);
  }, []);

  const sendToDownloads = useCallback((url: string) => {
    setHandoffUrl(url);
    go("downloads");
  }, [go]);

  const finishSplash = useCallback(() => {
    try {
      sessionStorage.setItem("terboo.splash", "1");
    } catch {
      // تخزين الجلسة محجوب: تُعرض Splash مرة في كل تحميل، ولا شيء يتعطّل
    }
    setSplashDone(true);
  }, []);

  if (!splashDone) return <><Splash onDone={finishSplash} /><Toasts /></>;

  // فحص الجلسة جارٍ: لا نُظهر landing ثم نقفز للتطبيق
  if (authState === "checking") {
    return (
      <>
        <div className="boot" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
        </div>
        <Toasts />
      </>
    );
  }

  if (authState === "anonymous") {
    return (
      <>
        {wantsLogin ? <Login /> : <Landing onSignIn={() => setWantsLogin(true)} />}
        <Toasts />
      </>
    );
  }

  return (
    <>
      <Shell route={route} onRoute={go}>
        {route === "ai" ? <AIWorkspace /> : null}
        {route === "games" ? <Games /> : null}
        {route === "downloads" ? <Downloads initialUrl={handoffUrl} /> : null}
        {route === "search" ? <Search onSendToDownloads={sendToDownloads} /> : null}
        {route === "subbots" ? <SubBots /> : null}
        {route === "account" ? <Account /> : null}
        {route === "owner" ? <Owner /> : null}
      </Shell>
      <Toasts />
    </>
  );
}
