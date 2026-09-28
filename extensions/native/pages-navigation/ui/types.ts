import type { ComponentType } from "react";

export type LandingSectionView = {
  id: string;
  kind: string;
  position: number;
  enabled: boolean;
  content: Record<string, unknown>;
};

export type LandingSettingsView = {
  title?: string;
  brandName?: string;
  tagline?: string;
  accent?: string;
  background?: string;
  logoUrl?: string;
  [k: string]: unknown;
};

export type LandingSectionProps = {
  content: Record<string, unknown>;
  settings: LandingSettingsView;
};

/**
 * Registry de composants par kind — surcharge 100 % marque :
 * `<LandingPublicPage components={{ hero: MonHero, "mon-kind": MaSection }} />`
 * remplace/complète les préfabriqués kit.
 */
export type LandingComponents = Record<
  string,
  ComponentType<LandingSectionProps>
>;
