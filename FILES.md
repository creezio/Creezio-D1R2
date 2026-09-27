# Repères du dépôt

État : implémentation autorisée, contrôleurs P0/contrats SDK et runtime T-03 local présents ; fondations T-04 en cours. Aucun CMS complet ni déploiement produit qualifié. Distinguer les scripts réellement présents des commandes encore prévues dans les contrats.

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
- [extensions/native/access](extensions/native/access/) : vingt et un modèles privés d'identité et de droits, contrat, documentation et six suites ; module sélectionné par la composition pour activer le transport natif, sans contributions UI/API métier/MCP encore exposées.
- [scripts/data](scripts/data/) et [data/schema/access.sql](data/schema/access.sql) : génération centrale inspectable, contrôle de dérive et moteur d'installation opérateur explicite ; aucune application SQL au démarrage du Worker.
- [scripts/local](scripts/local/) : configuration et stockage locaux communs, verrou des commandes officielles, saisie terminal sans écho et parcours opérateur ; aucun accès fournisseur.
- [core/authorization](core/authorization/) : moteur pur, résolveur natif partagé, contrat de politique, lecture D1 cohérente et service de remplacement des droits protégé par session/epoch/claim ; décision pure distincte d'une écriture autorisée.
- [tests/identity](tests/identity/) : tokens, droits et qualification cryptographique ; données exclusivement synthétiques.
- [État T-04](docs/IMPLEMENTATION-T04.md) : tranches, portée des contrôles et garanties restant à raccorder.

## Fondations des données T-05

- [core/data](core/data/) : catalogue runtime, capacités par module/contexte et plans D1 sous garde fraîche ; aucune API SQL publique.
- [core/files](core/files/) : métadonnées de fichiers privés, préparation R2, publication D1 et reprise explicite.
- [core/vault](core/vault/) : références opaques et chiffrement des secrets côté serveur.
- [tests/data](tests/data/) : recettes synthétiques SQL/D1/R2/coffre et intégration indépendante aux comptes natifs.
- [État T-05](docs/IMPLEMENTATION-T05.md) : travail, contrats et limites de cette première tranche.
