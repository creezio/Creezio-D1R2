# Cartographie Hermes

- `module/generate-manifest.mjs` définit modèles, permissions, opérations, API/MCP et paquet.
- `module/storage.ts` fixe les routes API Hermes et le coffre utilisé par le port hôte.
- `module/service.ts` borne configuration, générations, projections et lectures autorisées.
- `ui/index.tsx` et `ui/panel-state.ts` reprennent les cartes workspace et purgent au changement de session/contexte.
- `ui/widgets/` fournit les mêmes cartes MCP Apps au chat interne et aux GPT, avec actions directes limitées aux lectures autorisées.
- `plugin/` contient les métadonnées de découverte ; `tests/` et `ci/` vérifient six suites sources.
