# Fichiers

- `module/generate-manifest.mjs`, `module/models.json`, `module/manifest.json` : contrat canonique, modèles D1, droits, API et MCP.
- `module/service.ts`, `module/sidebar.ts`, `module/operations.ts`, `module/entry.server.ts` : opérations métier et overrides cosmétiques sous plans hôte.
- `ui/index.tsx`, `ui/sidebar.tsx`, `ui/contracts.ts`, `ui/state.ts` : éditeur workspace, tableau Sidebar original adapté, client d'opérations et conservation des états.
- `ui/front-page.tsx`, `ui/front-nav.tsx`, `ui/front-link.ts`, `ui/seo.ts`, `ui/prefabs.tsx`, `ui/types.ts`, `ui/published-images.ts`, `ui/landing.css` : vue front authentifiée, navigation publiée découverte par slot, URL canonique et état actif, bail des métadonnées du document, images privées à durée de vie bornée et préfabriqués originaux adaptés.
- `ui/public-document.tsx` : réponse HTML serveur de la page explicitement publique, avec les mêmes préfabriqués et métadonnées SEO.
- `plugin/` : projection conversationnelle des mêmes opérations.
- `tests/`, `ci/`, `gate.mjs` : six suites et porte locale.
- `README.md`, `prd.md`, `CHANGELOG.md` : documentation installée ; `AGENTS.md`, `FILES.md`, `interview.md`, `TODO.md` : développement.
