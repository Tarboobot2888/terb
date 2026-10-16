// هيكل التطبيق: شريط جانبي قابل للطي · شريط علوي · درج جوال · تنقّل سفلي
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../lib/store";
import { useFocusTrap, useMedia } from "../lib/hooks";
import type { Lang } from "../lib/types";

export type Route =
  | "dashboard" | "ai" | "tools" | "media" | "games"
  | "groups" | "subbots" | "commands" | "account" | "owner";

type NavEntry = { route: Route; icon: string; labelKey: string; ownerOnly?: boolean };

const WORKSPACE: NavEntry[] = [
  { route: "dashboard", icon: "◆", labelKey: "nav.dashboard" },
  { route: "ai", icon: "✶", labelKey: "nav.ai" },
  { route: "tools", icon: "⚙", labelKey: "nav.tools" },
  { route: "media", icon: "▣", labelKey: "nav.media" },
  { route: "games", icon: "◇", labelKey: "nav.games" },
];

const MANAGE: NavEntry[] = [
  { route: "groups", icon: "☰", labelKey: "nav.groups" },
  { route: "subbots", icon: "⌁", labelKey: "nav.subbots" },
  { route: "commands", icon: "⌘", labelKey: "nav.commands" },
  { route: "account", icon: "☺", labelKey: "nav.account" },
  { route: "owner", icon: "♛", labelKey: "nav.owner", ownerOnly: true },
];

const BOTTOM: Route[] = ["dashboard", "ai", "tools", "games", "account"];

export function Shell({ route, onRoute, children }: { route: Route; onRoute: (route: Route) => void; children: ReactNode }) {
  const { t, lang, setLang, profile, signOut } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const isMobile = useMedia("(max-width: 900px)");
  const drawerRef = useFocusTrap<HTMLDivElement>(drawer);

  // الدرج يُغلق عند التنقّل وبمفتاح Escape
  useEffect(() => { setDrawer(false); }, [route]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDrawer(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const visible = (entries: NavEntry[]) => entries.filter((entry) => !entry.ownerOnly || profile?.isOwner);

  const nav = (
    <>
      <div className="row" style={{ padding: "4px 10px 10px" }}>
        <div className="logo">
          <img className="logo__mark" src="/brand/terboo.png" alt="" width={34} height={34} />
          <span className="logo__text">{t("brand.web")}</span>
        </div>
      </div>
      <p className="sidebar__group">{t("nav.workspace")}</p>
      {visible(WORKSPACE).map((entry) => (
        <NavButton key={entry.route} entry={entry} active={route === entry.route} onRoute={onRoute} label={t(entry.labelKey)} />
      ))}
      <p className="sidebar__group">{t("nav.manage")}</p>
      {visible(MANAGE).map((entry) => (
        <NavButton key={entry.route} entry={entry} active={route === entry.route} onRoute={onRoute} label={t(entry.labelKey)} />
      ))}
    </>
  );

  return (
    <div className="shell">
      <a className="skip-link" href="#main">{lang === "ar" ? "تخطَّ إلى المحتوى" : "Skip to content"}</a>

      {!isMobile ? (
        <nav className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`} aria-label={t("common.menu")}>
          {nav}
        </nav>
      ) : null}

      {drawer ? (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <div className="drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-label={t("common.menu")}>
            <nav className="sidebar" style={{ width: "100%", position: "static", height: "100dvh" }}>{nav}</nav>
          </div>
        </>
      ) : null}

      <div className="shell__main">
        <header className="topbar">
          {isMobile ? (
            <button className="btn btn--ghost btn--icon btn--sm" type="button" onClick={() => setDrawer(true)} aria-label={t("common.menu")} aria-expanded={drawer}>☰</button>
          ) : (
            <button className="btn btn--ghost btn--icon btn--sm" type="button" onClick={() => setCollapsed((value) => !value)} aria-label={t("common.menu")} aria-pressed={collapsed}>❮❯</button>
          )}

          <strong className="topbar__title">{t(`nav.${route}`)}</strong>
          <span className="topbar__spacer" />

          <select
            className="select btn--sm topbar__lang"
            value={lang}
            onChange={(event) => setLang(event.target.value as Lang)}
            aria-label={t("common.language")}
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>

          {profile ? (
            <div className="row" style={{ gap: 8 }}>
              {profile.isOwner ? <span className="chip chip--gold">♛</span> : profile.isPremium ? <span className="chip chip--gold">★</span> : null}
              <span className="chip num" title={t("login.phone")}>{profile.phoneMasked}</span>
              <button className="btn btn--ghost btn--sm" type="button" onClick={() => void signOut()}>{t("account.logout")}</button>
            </div>
          ) : null}
        </header>

        <main className="page" id="main">{children}</main>
      </div>

      {isMobile ? (
        <nav className="bottomnav" aria-label={t("common.menu")}>
          {BOTTOM.map((item) => (
            <button
              key={item}
              className="bottomnav__item"
              type="button"
              aria-current={route === item ? "page" : undefined}
              onClick={() => onRoute(item)}
            >
              <span aria-hidden="true">{[...WORKSPACE, ...MANAGE].find((entry) => entry.route === item)?.icon}</span>
              <span>{t(`nav.${item}`)}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

function NavButton({ entry, active, onRoute, label }: { entry: NavEntry; active: boolean; onRoute: (route: Route) => void; label: string }) {
  return (
    <button
      className="navitem"
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={() => onRoute(entry.route)}
    >
      <span className="navitem__icon" aria-hidden="true">{entry.icon}</span>
      <span className="navitem__label">{label}</span>
    </button>
  );
}
