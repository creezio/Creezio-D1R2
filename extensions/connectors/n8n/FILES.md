# Cartographie

- `module/generate-manifest.mjs` : source canonique des modèles, opérations, droits, API/MCP, paquet et validation.
- `module/storage.ts` : deux descripteurs fixes API/Webhook, configurations et coffres séparés.
- `module/service.ts` : CAS local, projection de métadonnées et appels via le port hôte.
- `module/webhook.ts`, `module/runs.ts` : configuration du webhook et intention/émission/suivi corrélés.
- `ui/index.tsx`, `ui/panel-state.ts` : réglages et listes n8n dans le workspace, restauration de session.
- `ui/runs.tsx`, `ui/widgets/` : écran de déclenchement et widgets MCP Apps de lecture seule.
- `plugin/` : métadonnées MCP, contribution et usage conversationnel.
- `tests/`, `ci/`, `gate.mjs` : preuves locales séparées des fichiers runtime.
