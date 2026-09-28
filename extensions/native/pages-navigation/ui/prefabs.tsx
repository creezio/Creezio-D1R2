/**
 * Composants préfabriqués du module landing — un par kind.
 * Purs (props = contenu DB) : la marque peut en remplacer n'importe lequel
 * via le registry `components` de `LandingPublicPage` (surcharge 100 %).
 */

import type { LandingComponents, LandingSectionProps } from "./types.ts";

function str(content: Record<string, unknown>, key: string): string {
  const v = content[key];
  return v == null ? "" : String(v);
}

export function LandingHero({ content, settings }: LandingSectionProps) {
  const logo = str(content, "logoUrl") || (settings.logoUrl ? String(settings.logoUrl) : "");
  const image = str(content, "imageUrl");
  const cta = str(content, "ctaLabel");
  return (
    <section className="lnd-section lnd-hero">
      {logo ? <img className="lnd-hero-logo" src={logo} alt="" /> : null}
      <h1>{str(content, "title") || settings.brandName || ""}</h1>
      <p>{str(content, "subtitle") || settings.tagline || ""}</p>
      {cta ? (
        <a className="lnd-btn" href={str(content, "ctaHref") || "#"}>
          {cta}
        </a>
      ) : null}
      {image ? <img className="lnd-hero-image" src={image} alt="" /> : null}
    </section>
  );
}

export function LandingFeatures({ content }: LandingSectionProps) {
  const items = Array.isArray(content.items)
    ? (content.items as Array<Record<string, unknown>>)
    : [];
  return (
    <section className="lnd-section lnd-features">
      <h2>{str(content, "title")}</h2>
      <div className="lnd-features-grid">
        {items.map((it, i) => (
          <div className="lnd-feature" key={i}>
            {it.imageUrl ? <img src={String(it.imageUrl)} alt="" /> : null}
            <h3>{it.title == null ? "" : String(it.title)}</h3>
            <p>{it.text == null ? "" : String(it.text)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function LandingPricing({ content }: LandingSectionProps) {
  const plans = Array.isArray(content.plans)
    ? (content.plans as Array<Record<string, unknown>>)
    : [];
  return (
    <section className="lnd-section lnd-pricing">
      <h2>{str(content, "title")}</h2>
      <div className="lnd-pricing-grid">
        {plans.map((p, i) => (
          <div className="lnd-plan" key={i}>
            <h3>{p.name == null ? "" : String(p.name)}</h3>
            <div className="lnd-plan-price">
              {p.price == null ? "" : String(p.price)}
            </div>
            <ul>
              {(Array.isArray(p.features) ? p.features : []).map((f, j) => (
                <li key={j}>{String(f)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export function LandingCta({ content }: LandingSectionProps) {
  const cta = str(content, "ctaLabel");
  return (
    <section className="lnd-section lnd-cta">
      <h2>{str(content, "title")}</h2>
      <p>{str(content, "text")}</p>
      {cta ? (
        <a className="lnd-btn" href={str(content, "ctaHref") || "#"}>
          {cta}
        </a>
      ) : null}
    </section>
  );
}

export function LandingFooter({ content }: LandingSectionProps) {
  const links = Array.isArray(content.links)
    ? (content.links as Array<Record<string, unknown>>)
    : [];
  return (
    <footer className="lnd-footer">
      <div>{str(content, "text")}</div>
      {links.length ? (
        <div>
          {links.map((l, i) => (
            <a key={i} href={l.href == null ? "#" : String(l.href)}>
              {l.label == null ? "" : String(l.label)}
            </a>
          ))}
        </div>
      ) : null}
    </footer>
  );
}

/** Registry par défaut — un préfabriqué par kind kit. */
export const LANDING_PREFAB_COMPONENTS: LandingComponents = {
  hero: LandingHero,
  features: LandingFeatures,
  pricing: LandingPricing,
  cta: LandingCta,
  footer: LandingFooter,
};
