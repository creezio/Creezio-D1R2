# Cartographie

- `module/generate-manifest.mjs` : source canonique des modèles, opérations, droits, API/MCP, paquet et validation.
- `module/storage.ts` : descripteur statique du connecteur, configuration et coffre.
- `module/service.ts` : CAS local, contrôle de connexion expurgé et liste admin bornée avec vérification fraîche via le port hôte.
- `ui/index.tsx`, `ui/panel-state.ts` : carte de configuration/connexion, diagnostic paginé à la demande et état du panneau.
- `plugin/` : métadonnées MCP, contribution et usage conversationnel.
- `tests/`, `ci/`, `gate.mjs` : preuves locales séparées des fichiers runtime.
