# Fichiers

- `module/service.ts` : validation, ingestion, scan D1 borné, agrégats, export et rétention manuelle gardée.
- `module/operations.ts`, `module/entry.server.ts` : entrées du moteur natif.
- `module/generate-manifest.mjs`, `module/manifest.json`, `module/models.json` : contrat canonique.
- `ui/contracts.ts`, `ui/index.tsx`, `ui/panel-state.ts`, `ui/export.ts`, `ui/retention.tsx` : six onglets, appels SDK, export borné, filtres limités à la session/contexte et commandes de rétention à issue incertaine vérifiable.
- `plugin/` : métadonnées et guide MCP textuel.
- `tests/` et `ci/` : six suites contractuelles ; `tests/analytics/integration.test.mjs` : recette D1/permissions.
- `README.md`, `prd.md`, `interview.md`, `TODO.md`, `CHANGELOG.md` : périmètre et écarts assumés.

- `ui/widgets/` : deux rendus MCP Apps et runtime partagé, lectures explicites.
- `tests/widgets/runtime.test.mjs` : lecture initiale, pagination et refus borné.
