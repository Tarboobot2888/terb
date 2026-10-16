// الجذر: splash ⇒ landing/login ⇒ التطبيق. التوجيه بالـhash (بلا راوتر خارجي).
import { useCallback, useEffect, useState } from "react";
import { Splash } from "./components/Splash";
import { Shell } from "./components/Shell";
import type { Route } from "./components/Shell";
import { Toasts } from "./components/ui";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { AIWorkspace } from "./pages/AIWorkspace";
import { Tools } from "./pages/Tools";
import { Media } from "./pages/Media";
import { Games } from "./pages/Games";
import { Groups } from "./pages/Groups";
import { SubBots } from "./pages/SubBots";
import { Commands } from "./pages/Commands";
import { Account } from "./pages/Account";
import { Owner } from "./pages/Owner";
import { useApp } from "./lib/store";

const ROUTES: Route[] = ["dashboard", "ai", "tools", "media", "games", "groups", "subbots", "commands", "account", "owner"];

const routeFromHash = (): Route => {
  const value = window.location.hash.replace(/^#\/?/, "");
  return (ROUTES as string[]).includes(value) ? (value as Route) : "dashboard";
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

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((next: Route) => {
    window.location.hash = `#/${next}`;
    setRoute(next);
  }, []);

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
        {route === "dashboard" ? <Dashboard onRoute={go} /> : null}
        {route === "ai" ? <AIWorkspace /> : null}
        {route === "tools" ? <Tools /> : null}
        {route === "media" ? <Media /> : null}
        {route === "games" ? <Games /> : null}
        {route === "groups" ? <Groups /> : null}
        {route === "subbots" ? <SubBots /> : null}
        {route === "commands" ? <Commands /> : null}
        {route === "account" ? <Account /> : null}
        {route === "owner" ? <Owner /> : null}
      </Shell>
      <Toasts />
    </>
  );
}
