# Fichiers du module access

- `module/models.json` : source canonique des vingt et un modèles actuels d'identité et d'autorisation ; relations ACL, capacités de cycle de compte, credentials API/scopes, impersonations et références d'audit incluses.
- `module/manifest.json` : descripteur dérivé, modèles et contrat de validation.
- `module/entry.server.ts` : métadonnées de phase HTTP sans effets de démarrage ; les audiences natives sont sélectionnées par la composition du cœur.
- `plugin/` : projection explicitement vide, sans publication GPT annoncée.
- `ci/`, `tests/`, `gate.mjs` : six familles de contrôles locales.
- `README.md`, `prd.md`, `interview.md`, `TODO.md`, `CHANGELOG.md`, `AGENTS.md` : documentation installée et suivi du travail.
- `LICENSE` : renvoi aux décisions de distribution différées.

Le cœur partagé est dans [core/identity](../../../core/identity/) et [core/authorization](../../../core/authorization/) ; les outils centraux dans [scripts/data](../../../scripts/data/). La séparation ne permet pas aux modules consommateurs de lire directement les tables privées d'identité ou d'autorisation.

Le modèle `account_capabilities` est exploité par les services internes de cycle de compte dans `core/identity/`. Les contraintes de sa D1 sont également exercées dans [tests/identity/sql-schema.test.mjs](../../../tests/identity/sql-schema.test.mjs) ; les recettes complètes du cœur restent distinctes des six suites de ce module. Le manifeste et le SQL central sont régénérés ensemble, sans transformation d'une base existante.

Les modèles `api_credentials` et `api_credential_scopes` utilisent le [parseur de portées machine](../../../core/identity/machine-policy.ts) pour les tuples déclarés et les lignes D1. Ses [tests](../../../tests/identity/machine-policy.test.mjs) vérifient les limites, les refus et l'absence de croisement de contexte/audience ; les permissions effectives sont résolues par le serveur, pas par le parseur.

L'administration humaine utilise les modèles existants `principals`, `human_accounts`, `sessions`, `account_capabilities` et `access_audit`, sans table supplémentaire. Les services et stores d'administration restent dans `core/identity/` ; ce module porte les quatre index de pagination/invalidation, `target_session_id` historique et les actions d'audit humaines. La suite backend vérifie ces contrats et `tests/identity/sql-schema.test.mjs` vérifie les contraintes et plans de recherche dans D1. Les recettes des services distinguent statut du principal, état du compte humain et autorité de la session qui agit.

Les modèles `impersonations` et `impersonation_permissions` conservent la provenance et le plafond d'une délégation distincte. Le noyau d'autorisation et son catalogue natif sont dans `core/authorization/` ; le purpose opaque est dans `core/identity/tokens.ts`. Les [unités d'autorisation impersonation](../../../tests/identity/impersonation-authorization.test.mjs) vérifient l'acteur explicite, les refus absolus, le scope et l'absence de grant automatique. La suite SQL vérifie les FK, contraintes et références historiques ; les recettes D1 des services restent indépendantes de ces contrats.

Le transport natif est dans [core/identity/http.ts](../../../core/identity/http.ts), raccordé par le dispatcher du cœur. [compose-runtime.mjs](../../../scripts/build/compose-runtime.mjs) dérive les audiences depuis la [composition](../../../configuration/composition.json) et son verrou. Les [tests de composition](../../../tests/runtime/composition-build.test.mjs) couvrent module actif, expositions séparées, absence explicite et réservation du namespace. Aucun handler métier fictif, modèle ou SQL supplémentaire n'est nécessaire à ce raccordement.
