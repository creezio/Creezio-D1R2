# Cartographie

- `module/generate-manifest.mjs` : source canonique des modèles, opérations, droits, API/MCP, paquet et validation.
- `module/storage.ts` : descripteur statique du connecteur, configuration et coffre.
- `module/service.ts` : CAS local, projection de métadonnées et appels via le port hôte.
- `ui/index.tsx`, `ui/panel-state.ts` : réglages Resend et état de session, sans action d’envoi.
- `plugin/` : métadonnées MCP, contribution et usage conversationnel.
- `tests/`, `ci/`, `gate.mjs` : preuves locales séparées des fichiers runtime.
