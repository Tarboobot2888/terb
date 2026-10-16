// هيكل التطبيق: خمسة أقسام مرئية فقط · شريط علوي بقائمة حساب · درج جوال · تنقّل سفلي
// الأقسام المرئية: الذكاء · الألعاب · التنزيلات · البحث · البوتات الفرعية.
// الحساب ولوحة المالك ليسا قسمين: يُفتحان من قائمة الحساب في الشريط العلوي.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../lib/store";
import { useFocusTrap, useMedia } from "../lib/hooks";
import type { Lang } from "../lib/types";

/** الأقسام الخمسة + شاشتان تُفتحان من قائمة الحساب */
export type Route = "ai" | "games" | "downloads" | "search" | "subbots" | "account" | "owner";

/** الأقسام المرئية في التنقّل الرئيسي — خمسة لا أكثر */
export const SECTIONS: Array<{ route: Route; icon: string; labelKey: string }> = [
  { route: "ai", icon: "✶", labelKey: "nav.ai" },
  { route: "games", icon: "◇", labelKey: "nav.games" },
  { route: "downloads", icon: "⬇", labelKey: "nav.downloads" },
  { route: "search", icon: "⌕", labelKey: "nav.search" },
  { route: "subbots", icon: "⌁", labelKey: "nav.subbots" },
];

export function Shell({ route, onRoute, children }: { route: Route; onRoute: (route: Route) => void; children: ReactNode }) {
  const { t, lang, setLang, profile, signOut } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const isMobile = useMedia("(max-width: 900px)");
  const drawerRef = useFocusTrap<HTMLDivElement>(drawer);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // الدرج يُغلق عند التنقّل وبمفتاح Escape
  useEffect(() => { setDrawer(false); setMenu(false); }, [route]);
  useEffect(() => {
    if (!drawer && !menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDrawer(false);
      setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer, menu]);

  // نقرة خارج قائمة الحساب تُغلقها
  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menu]);

  const nav = (
    <>
      <div className="row" style={{ padding: "4px 10px 10px" }}>
        <div className="logo">
          <img className="logo__mark" src="/brand/terboo.png" alt="" width={34} height={34} />
          <span className="logo__text">{t("brand.web")}</span>
        </div>
      </div>
      {SECTIONS.map((entry) => (
        <NavButton key={entry.route} entry={entry} active={route === entry.route} onRoute={onRoute} label={t(entry.labelKey)} />
      ))}
    </>
  );

  const title = SECTIONS.find((entry) => entry.route === route)?.labelKey
    || (route === "owner" ? "nav.owner" : "nav.account");

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

          <strong className="topbar__title">{t(title)}</strong>
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
            <div className="topbar__profile" ref={menuRef}>
              <button
                className="btn btn--ghost btn--sm topbar__avatar"
                type="button"
                onClick={() => setMenu((value) => !value)}
                aria-label={t("common.profileMenu")}
                aria-expanded={menu}
                aria-haspopup="menu"
              >
                {profile.isOwner ? <span className="chip chip--gold" aria-hidden="true">♛</span>
                  : profile.isPremium ? <span className="chip chip--gold" aria-hidden="true">★</span> : null}
                <span className="num ltr">{profile.phoneMasked}</span>
              </button>

              {menu ? (
                <div className="menu" role="menu" aria-label={t("common.profileMenu")}>
                  <button className="menu__item" role="menuitem" type="button" onClick={() => onRoute("account")}>
                    {t("nav.profile")}
                  </button>
                  {profile.isOwner ? (
                    <button className="menu__item" role="menuitem" type="button" onClick={() => onRoute("owner")}>
                      {t("nav.owner")}
                    </button>
                  ) : null}
                  <button className="menu__item menu__item--danger" role="menuitem" type="button" onClick={() => void signOut()}>
                    {t("account.logout")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </header>

        <main className="page" id="main">{children}</main>
      </div>

      {isMobile ? (
        <nav className="bottomnav" aria-label={t("common.menu")}>
          {SECTIONS.map((entry) => (
            <button
              key={entry.route}
              className="bottomnav__item"
              type="button"
              aria-current={route === entry.route ? "page" : undefined}
              onClick={() => onRoute(entry.route)}
            >
              <span aria-hidden="true">{entry.icon}</span>
              <span>{t(entry.labelKey)}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

function NavButton({ entry, active, onRoute, label }: {
  entry: { route: Route; icon: string }; active: boolean; onRoute: (route: Route) => void; label: string;
}) {
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
