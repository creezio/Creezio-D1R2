# Fichiers

- `module/` : modèle D1, opérations, port public versionné, génération de manifeste.
- `ui/` : parcours workspace/front, prix et état du panneau avec journal SDK ; lecture liée des images visibles avec budget de transport et libération des URL Blob.
- `ui/widgets/` : deux ressources et rendus MCP Apps liste/fiche, lecteur d’image privée borné aux cartes visibles et libération des URL Blob.
- `plugin/` : projection MCP et guide.
- `tests/`, `ci/`, `gate.mjs` : six suites du module.
- `tests/catalog/integration.test.mjs` : moteur réel D1/R2/ACL/transports.
- `README.md`, `prd.md`, `TODO.md`, `interview.md`, `CHANGELOG.md` : portée, décisions et limites.
