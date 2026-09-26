# Fichiers du module access

- `module/models.json` : source canonique des dix-neuf modèles actuels d'identité et d'autorisation ; relations ACL, capacités de cycle de compte, credentials API/scopes et références d'audit incluses.
- `module/manifest.json` : descripteur dérivé, modèles et contrat de validation.
- `module/entry.server.ts` : métadonnées sans effets de démarrage.
- `plugin/` : projection explicitement vide, sans publication GPT annoncée.
- `ci/`, `tests/`, `gate.mjs` : six familles de contrôles locales.
- `README.md`, `prd.md`, `interview.md`, `TODO.md`, `CHANGELOG.md`, `AGENTS.md` : documentation installée et suivi du travail.
- `LICENSE` : renvoi aux décisions de distribution différées.

Le cœur partagé est dans [core/identity](../../../core/identity/) et [core/authorization](../../../core/authorization/) ; les outils centraux dans [scripts/data](../../../scripts/data/). La séparation ne permet pas aux modules consommateurs de lire directement les tables privées d'identité ou d'autorisation.

Le modèle `account_capabilities` est exploité par les services internes de cycle de compte dans `core/identity/`. Les contraintes de sa D1 sont également exercées dans [tests/identity/sql-schema.test.mjs](../../../tests/identity/sql-schema.test.mjs) ; les recettes complètes du cœur restent distinctes des six suites de ce module. Le manifeste et le SQL central sont régénérés ensemble, sans transformation d'une base existante.

Les modèles `api_credentials` et `api_credential_scopes` utilisent le [parseur de portées machine](../../../core/identity/machine-policy.ts) pour les tuples déclarés et les lignes D1. Ses [tests](../../../tests/identity/machine-policy.test.mjs) vérifient les limites, les refus et l'absence de croisement de contexte/audience ; les permissions effectives sont résolues par le serveur, pas par le parseur.
