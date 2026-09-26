# Fichiers du module access

- `module/models.json` : source canonique des seize modèles actuels d'identité et d'autorisation ; relations de membership et de rôles incluses.
- `module/manifest.json` : descripteur dérivé, modèles et contrat de validation.
- `module/entry.server.ts` : métadonnées sans effets de démarrage.
- `plugin/` : projection explicitement vide, sans publication GPT annoncée.
- `ci/`, `tests/`, `gate.mjs` : six familles de contrôles locales.
- `README.md`, `prd.md`, `interview.md`, `TODO.md`, `CHANGELOG.md`, `AGENTS.md` : documentation installée et suivi du travail.
- `LICENSE` : renvoi aux décisions de distribution différées.

Le cœur partagé est dans [core/identity](../../../core/identity/) et [core/authorization](../../../core/authorization/) ; les outils centraux dans [scripts/data](../../../scripts/data/). La séparation ne permet pas aux modules consommateurs de lire directement les tables privées d'identité ou d'autorisation.
