# Cartographie

- `module/generate-manifest.mjs` : source canonique des modèles, opérations, droits, API/MCP, paquet et validation.
- `module/storage.ts` : descripteur statique du connecteur, configuration et coffre.
- `module/service.ts` : CAS local, contrôle de connexion expurgé et liste admin bornée avec vérification fraîche via le port hôte.
- `module/indexing.ts`, `module/task.ts` : génération contextuelle, lots durables, tâches 202, réconciliation et recherche relue sur le modèle propriétaire.
- `ui/index.tsx`, `ui/panel-state.ts` : carte de configuration/connexion, diagnostic paginé à la demande et état du panneau.
- `ui/widgets/search-results.ts`, `ui/widgets/search-results.html` : affichage MCP Apps de hits autorisés et recherche directe sur la source du résultat.
- `plugin/` : métadonnées MCP, contribution et usage conversationnel.
- `tests/`, `ci/`, `gate.mjs` : preuves locales séparées des fichiers runtime.
