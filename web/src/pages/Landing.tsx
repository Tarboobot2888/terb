// صفحة التعريف قبل الدخول: قدرات مؤكَّدة فقط وحالة خدمة حقيقية
import { useFetch } from "../lib/hooks";
import { useApp } from "../lib/store";
import type { PublicCapabilities } from "../lib/types";

/** الأقسام المعروضة: صورها موجودة فعلاً في assets/image/sections/ */
const SECTIONS = [
  { key: "ai", ar: "الذكاء", en: "AI" },
  { key: "downloader", ar: "التحميل", en: "Downloads" },
  { key: "tools", ar: "الأدوات", en: "Tools" },
  { key: "media", ar: "الوسائط", en: "Media" },
  { key: "game", ar: "الألعاب", en: "Games" },
  { key: "sticker", ar: "الملصقات", en: "Stickers" },
  { key: "search", ar: "البحث", en: "Search" },
  { key: "group", ar: "المجموعات", en: "Groups" },
] as const;

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  const { t, lang } = useApp();
  const { data, loading } = useFetch<PublicCapabilities>("/public/capabilities");

  const features: Array<{ key: keyof PublicCapabilities["features"]; ar: string; en: string; body_ar: string; body_en: string }> = [
    { key: "aiWorkspace", ar: "اسأل الذكاء", en: "Ask the AI", body_ar: "محادثة بنفس نواة البوت وذاكرته وسياسات مزوّداته.", body_en: "Chat through the same kernel, memory and provider routing the bot uses." },
    { key: "toolsAndDownloads", ar: "أدوات وتحميل", en: "Tools and downloads", body_ar: "سجل الأدوات والـscrapers الحقيقي بمخطّط مدخلات لكل أداة.", body_en: "The real tool and scraper registry, with each tool's own input schema." },
    { key: "mediaStudio", ar: "فهم الملفات", en: "Understand files", body_ar: "صور وصوت وفيديو ومستندات بحدود التنفيذ الفعلية.", body_en: "Images, audio, video and documents within the real engine limits." },
    { key: "games", ar: "ألعاب", en: "Games", body_ar: "محرّك الأركيد نفسه: كل حركة تُحتسب على الخادم.", body_en: "The same arcade engine: every move is resolved on the server." },
    { key: "groupModeration", ar: "إدارة المجموعات", en: "Group moderation", body_ar: "إجراءات حقيقية بتحقق حيّ من صلاحيتك وصلاحية البوت.", body_en: "Real actions, verified live against your role and the bot's." },
  ];

  return (
    <main className="landing" id="main">
      <section className="hero">
        <div className="hero__text">
          <div className="chip chip--violet">{t("brand.web")}</div>
          <h1>{t("landing.heroTitle")}</h1>
          <p className="hero__body">{t("landing.heroBody")}</p>
          <div className="row">
            <button className="btn btn--primary" type="button" onClick={onSignIn}>{t("landing.cta")}</button>
            <a className="btn btn--ghost" href="#capabilities">{t("landing.capabilities")}</a>
          </div>
          <p className="card__meta">{t("landing.footerNote")}</p>
        </div>
        <div className="hero__art">
          <img src="/brand/terboo-banner.jpg" alt="" width={1280} height={720} loading="eager" />
        </div>
      </section>

      <section className="stack" id="capabilities">
        <h2>{t("landing.capabilities")}</h2>
        <div className="grid">
          {features.map((feature) => {
            const on = data?.features?.[feature.key] !== false;
            return (
              <article key={String(feature.key)} className="card">
                <div className="row row--between">
                  <h3 className="card__title">{lang === "ar" ? feature.ar : feature.en}</h3>
                  {loading
                    ? <span className="skeleton" style={{ width: 54, height: 20 }} />
                    : <span className={`chip ${on ? "chip--success" : "chip--muted"}`}>
                        <span className={`dot ${on ? "dot--on" : "dot--off"}`} />
                        {on ? t("common.online") : t("common.notAvailable")}
                      </span>}
                </div>
                <p className="card__meta">{lang === "ar" ? feature.body_ar : feature.body_en}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="stack">
        <h2>{t("landing.status")}</h2>
        <div className="grid">
          <StatusCard
            label={lang === "ar" ? "اتصال واتساب" : "WhatsApp connection"}
            loading={loading}
            on={Boolean(data?.whatsapp?.connected)}
            onText={t("common.online")}
            offText={t("common.offline")}
          />
          <StatusCard
            label={lang === "ar" ? "مزوّدات الذكاء" : "AI providers"}
            loading={loading}
            on={Boolean(data?.ai?.available)}
            onText={`${data?.ai?.providerCount ?? 0}`}
            offText={t("common.notAvailable")}
          />
          <StatusCard
            label={lang === "ar" ? "فهم الصور" : "Image understanding"}
            loading={loading}
            on={Boolean(data?.ai?.vision)}
            onText={t("common.yes")}
            offText={t("common.no")}
          />
          <StatusCard
            label={lang === "ar" ? "خدمة الموقع" : "Web service"}
            loading={loading}
            on={data?.site?.state === "ready" || data?.site?.state === "ready-insecure-http"}
            onText={data?.site?.secure ? "HTTPS" : "HTTP"}
            offText={String(data?.site?.state || t("common.unknown"))}
          />
        </div>
      </section>

      <section className="stack">
        <h2>{t("landing.sections")}</h2>
        <div className="grid">
          {SECTIONS.map((section) => (
            <button key={section.key} className="sectioncard card--interactive" type="button" onClick={onSignIn}>
              <img src={`/brand/sections/${section.key}.jpg`} alt="" width={1280} height={720} loading="lazy" decoding="async" />
              <span className="sectioncard__label">{lang === "ar" ? section.ar : section.en}</span>
            </button>
          ))}
        </div>
      </section>

      <footer className="landing__footer">
        <div className="logo">
          <img className="logo__mark" src="/brand/terboo.png" alt="" width={34} height={34} />
          <span className="logo__text">{t("brand.name")}</span>
        </div>
        <p className="card__meta">{t("landing.footerNote")}</p>
      </footer>
    </main>
  );
}

function StatusCard({ label, loading, on, onText, offText }: {
  label: string; loading: boolean; on: boolean; onText: string; offText: string;
}) {
  return (
    <article className="card">
      <p className="card__meta">{label}</p>
      {loading ? (
        <span className="skeleton" style={{ width: 92, height: 24, display: "block", marginTop: 8 }} />
      ) : (
        <div className="row" style={{ marginTop: 6 }}>
          <span className={`dot ${on ? "dot--on" : "dot--off"}`} />
          <strong className="num">{on ? onText : offText}</strong>
        </div>
      )}
    </article>
  );
}
