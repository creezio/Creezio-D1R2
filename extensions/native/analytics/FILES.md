# Fichiers

- `module/service.ts` : validation, ingestion, scan D1 borné, agrégats, export, politique de collecte et purges manuelles gardées.
- `module/operations.ts`, `module/entry.server.ts` : entrées du moteur natif.
- `module/generate-manifest.mjs`, `module/manifest.json`, `module/models.json` : contrat canonique.
- `ui/contracts.ts`, `ui/index.tsx`, `ui/panel-state.ts`, `ui/export.ts`, `ui/retention.tsx`, `ui/collection.tsx` : six onglets, appels SDK, export borné, politique optionnelle et commandes de rétention à issue incertaine vérifiable.
- `plugin/` : métadonnées et guide MCP textuel.
- `tests/` et `ci/` : six suites contractuelles ; `tests/analytics/collection.test.mjs` et `integration.test.mjs` : filtrage client, D1/permissions et refus synthétiques.
- `README.md`, `prd.md`, `interview.md`, `TODO.md`, `CHANGELOG.md` : périmètre et écarts assumés.

- `ui/widgets/` : deux rendus MCP Apps et runtime partagé, lectures explicites.
- `tests/widgets/runtime.test.mjs` : lecture initiale, pagination et refus borné.
