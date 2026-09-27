# Repères du dépôt

État : PR #1 à #20 intégrées ; main `037c0a0b` qualifié avec 908 tests locaux et CI. Catalogue, dépendances et plans de modules sont raccordés aux opérations communes et au Product Hub original. Chantier actif : T-12, documentation de version installée, sur `core/t12-installed-documentation`. Le [TODO](docs/TODO.md) distingue acquis, travaux et qualifications restantes.

| Emplacement | Responsabilité |
|---|---|
| [README.md](README.md) | Présentation et parcours de lecture. |
| [AGENTS.md](AGENTS.md) | Instructions applicables et invariants. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Point d'entrée des contributions. |
| [LICENSE](LICENSE) | Licence du contenu déjà publié ; ne préjuge pas des conditions du futur produit. |
| [.gitignore](.gitignore) | Exclusion des secrets, données locales et sorties régénérables. |
| [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) | Contenu demandé pour les PR ; ne remplace pas une protection distante. |
| [.github/ISSUE_TEMPLATE/bug.yml](.github/ISSUE_TEMPLATE/bug.yml) | Reproduction et traçabilité des anomalies. |
| [.github/ISSUE_TEMPLATE/change.yml](.github/ISSUE_TEMPLATE/change.yml) | Besoin, critères et dépendances des évolutions/tâches. |
| [skills/README.md](skills/README.md) | Registre et routage des neuf skills de développement canoniques. |
| [docs/PRD.md](docs/PRD.md) | Vision, utilisateurs, périmètre et réussite. |
| [docs/EXIGENCES.md](docs/EXIGENCES.md) | Exigences stables et recettes attendues. |
| [docs/USER-STORIES.md](docs/USER-STORIES.md) | Parcours utilisateur/développeur reliés aux exigences. |
| [docs/TODO.md](docs/TODO.md) | Backlog canonique, dépendances, jalons et états. |
| [docs/IMPLEMENTATION-T12.md](docs/IMPLEMENTATION-T12.md) | Documents installés, lecture et limites de qualification T12. |
| [docs/PLAN-IMPLEMENTATION.md](docs/PLAN-IMPLEMENTATION.md) | Architecture détaillée et lots. |
| [docs/MATRICE-CAPACITES.md](docs/MATRICE-CAPACITES.md) | Inventaire fonctionnel et scénarios de conservation. |
| [docs/ARCHITECTURE-DEPOTS.md](docs/ARCHITECTURE-DEPOTS.md) | Socle/fork/tiers/registre, modules natifs et propriété. |
| [docs/STANDARD-MODULE.md](docs/STANDARD-MODULE.md) | Contrat uniforme, documentation et six CI par module. |
| [docs/DEVELOPMENT-STANDARD.md](docs/DEVELOPMENT-STANDARD.md) | Méthode, impact documentaire, confiance et preuves. |
| [docs/GIT-FLOW.md](docs/GIT-FLOW.md) | Branches, commits, PR, revue, fusion et releases. |
| [docs/CADRE-PRODUIT-ET-COMMUNAUTE.md](docs/CADRE-PRODUIT-ET-COMMUNAUTE.md) | Usages, communauté, registre et création. |
| [docs/EXTENSIONS-THEMES-ECOSYSTEME.md](docs/EXTENSIONS-THEMES-ECOSYSTEME.md) | SDK, paquets, thèmes, starter et updates. |
| [docs/DEPENDANCES-MODULES.md](docs/DEPENDANCES-MODULES.md) | Déclarations, graphe résolu, impacts et cycle de vie intermodules. |
| [docs/INTERACTIONS-WIDGETS.md](docs/INTERACTIONS-WIDGETS.md) | Widgets multiples et trois modes par action ; hôte interne et GPT. |
| [docs/COMPATIBILITE-CHATGPT.md](docs/COMPATIBILITE-CHATGPT.md) | MCP, widgets, plugins et skills conversationnels. |
| [docs/STOCKAGE-ET-HEBERGEMENT.md](docs/STOCKAGE-ET-HEBERGEMENT.md) | Local, Sites, Cloudflare et transfert D1/R2. |
| [docs/LICENCES-ET-OFFRES.md](docs/LICENCES-ET-OFFRES.md) | Politiques/activation/accompagnement et décisions commerciales différées. |
| [docs/QUALIFICATION-SITES.md](docs/QUALIFICATION-SITES.md) | Preuves techniques limitées, distinctes du CMS. |
| [docs/INSTALLATION-LOCALE.md](docs/INSTALLATION-LOCALE.md) | Inspection, premier compte local, configuration commune et reprises sans écrasement. |
| [docs/AUDIT-AVANT-DEVELOPPEMENT.md](docs/AUDIT-AVANT-DEVELOPPEMENT.md) | Audit croisé et conditions de démarrage/livraison. |

## MCP et OAuth natifs T-10

- [core/mcp](core/mcp/) : catalogue vérifié, transport officiel stateless, authentification native et découverte filtrée.
- [core/oauth](core/oauth/) : protocole, consentement, clients, codes, rotation et révocation D1.
- [sdk/oauth](sdk/oauth/) et [consentement Access](extensions/native/access/ui/consent.tsx) : client de transaction et carte originale adaptée ; montage [hôte](app/oauth/consent/).
- [scripts/mcp](scripts/mcp/) : compilation des contributions ; [tests/oauth](tests/oauth/) et [tests/mcp](tests/mcp/) : suites obligatoires du contrôle global.
- [Réalisation T-10](docs/IMPLEMENTATION-T10.md) : contrats, provenance et limites de qualification.

## Contrôleurs P0 en cours

- [package.json](package.json) et [.node-version](.node-version) : commandes locales et runtime des outils de développement.
- [scripts/quality](scripts/quality/) : documentation, gouvernance, empreintes et observation distante en lecture seule.
- [tests/quality](tests/quality/) : cas positifs/négatifs des contrôleurs, fixtures temporaires nettoyées.
- [Workflow P0](.github/workflows/p0-validation.yml) : tests sans secrets et agrégation ; origine réelle vérifiée par le mainteneur avant fusion.
- [sdk/contracts](sdk/contracts/) : schémas versionnés, validation déclarative et analyse des compositions/transitions ; aucune exécution de module.
- [tests/contracts](tests/contracts/) : fixtures de contrats et cas intermodules, widgets et chargement JSON borné.
- [État P0](docs/IMPLEMENTATION-P0.md), [T-02](docs/IMPLEMENTATION-T02.md) et [CHANGELOG](CHANGELOG.md) : périmètre, preuves et limites.

Tout ajout structurel met ce repère à jour. Chaque module construit fournit ensuite son propre FILES et ses instructions locales, conformément au standard commun.

## Runtime commun T-03

- [worker.ts](worker.ts) : entrée fetch unique, API Creezio puis rendu Vinext.
- [core/runtime](core/runtime/) : routage des opérations statiques, environnement, refus des appels protégés et erreurs bornées.
- [adapters](adapters/) : reconnaissance des bindings D1/R2 et profils d'hébergement ; aucun service tiers installé.
- [configuration](configuration/) : composition explicite et verrou de l'application ; pas de module témoin inclus par défaut.
- [scripts/build](scripts/build/) : génération des imports sélectionnés et contrôle de compatibilité Worker, sans installation implicite.
- [app](app/) : page initiale, entrées natives `/access/admin` et `/access/app`, et montage des seules vues front explicitement anonymes ; aucune administration provisoire ouverte.
- [vite.config.ts](vite.config.ts), [tsconfig.json](tsconfig.json), [scripts/run-framework.mjs](scripts/run-framework.mjs) : outillage figé et build commun ; un seul `dist` et un seul état local `.wrangler/state`.
- [.openai/hosting.json](.openai/hosting.json) : noms logiques DB/BUCKET, sans identité de Site ni ressource distante créée.
- [tests/runtime](tests/runtime/) : contrôles de composition, environnement, routage et workerd ; module témoin avec ses propres docs et six suites.
- [État T-03](docs/IMPLEMENTATION-T03.md) : périmètre vérifié, commandes et limites ; `.creezio`, `.quality`, `.wrangler` et `dist` restent locaux et ignorés.

## Fondations de l'identité T-04

- [sdk/access](sdk/access/) : contrat public de session navigateur, client HTTP, contrôleur et coordination, composants React réutilisables ; aucune lecture directe de cookie, table ou secret, aucun couplage au routeur hôte.

- [core/identity](core/identity/) : credentials opaques, cryptographie, stockage D1 et services natifs de comptes, droits et impersonation ; transport natif login/session/logout dans http.ts et ses règles d'origine, corps et cookies dans http-policy.ts.
- [extensions/native/access](extensions/native/access/) : vingt-deux modèles privés d'identité, de droits et d'audit, contrat, documentation et six suites ; vue native Rôles & accès déclarée et dix opérations HTTP administratives. MCP reste à raccorder.
- [sdk/access/admin-client.ts](sdk/access/admin-client.ts) et [admin-controller.ts](sdk/access/admin-controller.ts) : accès paginés au graphe, aux comptes et au journal, commandes avec clé persistée avant émission et réconciliation sans nouvel envoi.
- [sdk/ui](sdk/ui/) : primitives publiques reprises du Creezio original ; les modules n'importent pas les composants privés de l'administration.
- [core/identity/audit.ts](core/identity/audit.ts) et [audit-store.ts](core/identity/audit-store.ts) : pages du journal et détails des changements sous garde native fraîche.
- [core/authorization/delta.ts](core/authorization/delta.ts) : changements explicites du graphe sans écraser les autres contextes, audiences ou rôles.
- [tests/identity/harness/serve-access-ui.mjs](tests/identity/harness/serve-access-ui.mjs) : recette de l'écran produit sur données synthétiques en mémoire ; aucune base utilisateur ouverte.
- [scripts/data](scripts/data/) et [data/schema/access.sql](data/schema/access.sql) : génération centrale inspectable, contrôle de dérive et moteur d'installation opérateur explicite ; aucune application SQL au démarrage du Worker.
- [scripts/local](scripts/local/) : configuration et stockage locaux communs, verrou des commandes officielles, saisie terminal sans écho et parcours opérateur ; aucun accès fournisseur.
- [core/authorization](core/authorization/) : moteur pur, résolveur natif partagé, contrat de politique, lecture D1 cohérente et service de remplacement des droits protégé par session/epoch/claim ; décision pure distincte d'une écriture autorisée.
- [tests/identity](tests/identity/) : tokens, droits et qualification cryptographique ; données exclusivement synthétiques.
- [État T-04](docs/IMPLEMENTATION-T04.md) : tranches, portée des contrôles et garanties restant à raccorder.

## Fondations des données T-05

- [core/data](core/data/) : catalogue runtime, capacités par module/contexte et plans D1 sous garde fraîche ; aucune API SQL publique.
- [core/files](core/files/) : métadonnées de fichiers privés, préparation R2, publication D1 et reprise explicite.
- [core/operations](core/operations/) : registre canonique, exécutions internes, validation statique, stockage technique et transport HTTP déclaré intégré.
- [core/operations/native-access.ts](core/operations/native-access.ts) : raccordement hôte fermé des services Access existants aux mêmes transactions d'exécution ; aucun SQL ni accès privilégié ajouté aux handlers publics de modules.
- [scripts/operations](scripts/operations/) : compilation centrale des validateurs d'opérations pour le Worker.
- [data/schema/runtime.sql](data/schema/runtime.sql) et [scripts/data/prepare-runtime.mjs](scripts/data/prepare-runtime.mjs) : quatre modèles techniques des exécutions et contrôle central de leur SQL ; aucun changement automatique de base.
- [tests/operations](tests/operations/) : registre, schémas compilés, exécutions D1 et Worker, refus et idempotence ; famille obligatoire de l'agrégat.
- [docs/IMPLEMENTATION-T06.md](docs/IMPLEMENTATION-T06.md) : périmètre, progression et critères du registre commun.
- [core/vault](core/vault/) : références opaques et chiffrement des secrets côté serveur.
- [tests/data](tests/data/) : recettes synthétiques SQL/D1/R2/coffre et intégration indépendante aux comptes natifs.
- [État T-05](docs/IMPLEMENTATION-T05.md) : travail, contrats et limites de cette première tranche.

## Tranches T-06 et T-07 en cours

- [core/operations/http.ts](core/operations/http.ts), [sdk/operations](sdk/operations/) et [scripts/operations/http-bindings.mjs](scripts/operations/http-bindings.mjs) : transport HTTP et client d'opérations intégrés par PR #16 ; hébergements encore à qualifier.
- [core/workspace](core/workspace/) : projection de navigation sous session, contexte et droits natifs cohérents ; sa lecture ne remplace pas la garde des mutations.
- [sdk/workspace](sdk/workspace/) : panneaux, historique, navigation, conservation et restauration bornée en session ; seules les données déclarées par un schéma d'état sont restaurables, pas les brouillons React arbitraires.
- [app/workspace](app/workspace/) : routes et hôte natif par audience. [admin/workspace](admin/workspace/) adapte les composants du Creezio original (sidebar, barre d'onglets, recherche, chrome de page), distincts du SDK public. Parité produit complète encore à qualifier.
- [tests/workspace](tests/workspace/) : recettes ciblées de composition, droits, contrôleur, client et interface ; [état T-07](docs/IMPLEMENTATION-T07.md) pour leurs limites.

## Registre séparé et Docker local

- [sdk/registry](sdk/registry/) : protocole public partagé, sans serveur embarqué.
- [services/registry](services/registry/) : service central à déployer séparément ; [état T-08](docs/IMPLEMENTATION-T08.md).
- [core/registry](core/registry/) : client serveur et contrôle de publication, distincts du runtime métier.
- [scripts/registry](scripts/registry/) : build indépendant, configuration sans secret et opérateur explicite du D1 dédié.
- [tests/registry](tests/registry/) et [tests/local](tests/local/) : protocoles et refus du registre, Worker, journal de reprise et adaptateur Docker ; suites obligatoires dans le contrôle global.
- [adapters/docker](adapters/docker/) : démarrage local persistant ; [état T-31](docs/IMPLEMENTATION-T31.md).

## Gestion des modules T-11

- `extensions/native/modules-settings/` : catalogue, fiches issues du Product Hub Creezio, plans et journal D1 ; six suites et docs propres.
- `sdk/modules/`, `sdk/module-settings/`, `sdk/operations/handler.ts` : solveur, inventaire vérifié au build, client/contrôleur et surface publique des handlers.
- `scripts/modules/` : archives déterministes, verrou et plan local ; aucun téléchargement ou lancement de code tiers.
- `configuration/module-inventory.json` : origines autorisées et candidats présents supplémentaires ; inventaire compilé injecté par le cœur.
- `core/operations/host-inventory.ts` : capture immuable liée à la composition et au module natif exact.
- `scripts/data/prepare-modules-settings.mjs`, `data/schema/modules-settings.sql` : création actuelle centralisée des trois modèles.
- `tests/modules/`, [IMPLEMENTATION-T11](docs/IMPLEMENTATION-T11.md) : recette du graphe, du service et des interfaces.
