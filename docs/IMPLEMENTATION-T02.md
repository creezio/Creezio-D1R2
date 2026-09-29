# T-02 — Contrats SDK et dépendances

Contrôles statiques réalisés sur `core/t02-contracts`, depuis le checkpoint P0 `3767c43`, puis intégrés par la [PR #2](https://github.com/creezio/Creezio-D1R2/pull/2) après reprise d'Actions. Les exigences sont suivies dans [T-02](TODO.md#T-02), avec le [standard module](STANDARD-MODULE.md), le [contrat des dépendances](DEPENDANCES-MODULES.md) et les [interactions des widgets](INTERACTIONS-WIDGETS.md).

## Réalisation

- `sdk/contracts/schemas/v1/` : schémas JSON Schema 2020-12 fermés pour modules, données, opérations, surfaces, docs/CI, composition et verrou. Un reçu détaché décrit la liaison des archives ; aucun fichier ne doit contenir sa propre empreinte.
- `sdk/contracts/validate.mjs` : validation déclarative de module, composition et transition ; diagnostics structurés, sans chargement de handlers ou de code d'un module inspecté.
- `sdk/contracts/semantics.mjs` et `references.mjs` : références, ports publics, effets, audiences, intégrités déclarées, dépendances et contributions conditionnelles.
- `sdk/contracts/load.mjs` : lecture JSON locale bornée, confinement et refus des chemins liés, données non inertes et références de schémas distantes.
- `tests/contracts/` : fixtures explicitement factices et cas positifs/négatifs, dont plusieurs widgets, trois modes par action et chaîne de modules de trois éditeurs.

Le validateur emploie AJV 8, ajv-formats et semver, versions exactes verrouillées. Ces outils appartiennent au développement ; ils n'ajoutent ni serveur Node persistant ni dépendance runtime à chaque module. La CI installe ce verrou sans scripts d'installation, puis lance les mêmes contrôles locaux. L'agrégateur refuse la disparition de la suite contrats au lieu de réduire silencieusement sa couverture.

## Dépendances et impacts

La déclaration est commune aux modules natifs, métier et tiers. Le SDK vérifie versions/origines et contrats publics, chaîne transitive, composition/verrou, conflits et transitions invalides. Le choix d'une intégration facultative est distinct de la présence de son fournisseur. Les références actives vers une contribution retirée sont refusées ; les droits, l'accès aux données et les effets des opérations ne sont pas hérités implicitement d'une dépendance.

Le dossier produit comporte désormais 89 exigences, toujours réparties dans 39 stories et 39 tâches. Les six nouveaux critères détaillent les contrats statiques, le futur gestionnaire, les archives interéditeurs et les mises à jour du fork. Les guides IA, AGENTS et modèles de revue demandent leurs déclarations, impacts et cas négatifs.

## Validation et limites

### Complément REQ-0203 — archives de validation

Le lanceur `scripts/modules/validate-archives.mjs` vérifie l'empreinte de l'archive SDK et assemble les fichiers déclarés des modules avant leurs six suites fermées. Le générateur et la gate de chaque archive sont exécutés comme enfants Node avec un environnement construit pour cette validation : chemin du binaire Node, répertoire temporaire propre à l'assemblage, et chemins système Windows nécessaires. Les variables ambiantes de secrets, `NODE_OPTIONS` et les paramètres npm ne sont pas transmis ; les processus de test lancés par la gate héritent de ce même environnement. Un test fait passer une sentinelle dans l'environnement du lanceur et vérifie son absence chez l'enfant et son descendant. La gate réelle du module Support, assemblée avec l'archive publique SDK 1.4.1, passe ses six suites sous cette restriction.

Cette restriction porte sur les variables d'environnement transmises par ce lanceur. Elle ne constitue pas une isolation du système de fichiers ou du réseau pour du code d'archive exécuté ; la politique d'origine, les droits et les autres gardes d'installation restent requis. Les fixtures initiales de T-02 ne prouvent pas, à elles seules, l'exécution de modules tiers.

Commandes : `npm run test:contracts` pour les contrats ; `npm run check` pour l'agrégat du dépôt. Le rapport `.quality/latest.json` porte le SHA/tree et les empreintes des sources réellement testées ; une modification invalide la preuve précédente. L’agrégat local a réussi sans suite ignorée. Les 195 tests ont aussi réussi dans le [run de PR](https://github.com/creezio/Creezio-D1R2/actions/runs/36265616619) sur la tête synchronisée `0d672e5`, de même arbre que le checkpoint revu `72c7f3f`. Squash `61c70fd925ce6e444dd2676012d84b56b7389787`, puis [CI du nouveau main](https://github.com/creezio/Creezio-D1R2/actions/runs/36265701280) réussie. Cette qualification ne coche pas les futurs exécuteurs.

Une composition déclarative acceptée **n'est pas une installation autorisée ou exécutée**. T-11 reste responsable du résolveur de paquets, du gestionnaire visible, de la configuration effective, des gardes d'exécution et des transitions persistantes. T-30 vérifie les vrais octets des archives, signatures/provenances et références transitives de code ; T-38 exerce les mises à jour sur les déploiements du fork. Les valeurs d'intégrité des fixtures ne sont pas des preuves de paquet réel. Les capacités déclarées de l'hôte et les politiques doivent être confrontées à une autorité approuvée par les exécuteurs.

Aucun compte, base D1, fichier R2, module applicatif, Site ou déploiement n'est créé par ces contrôleurs. La parité UI, le chat OpenAI et la compatibilité réelle ChatGPT restent des recettes ultérieures. La validation locale et la CI sont toutes deux acquises pour ce livrable déclaratif.
