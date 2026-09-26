# Creezio-D1R2

CMS nativement serverless, conçu pour D1/R2. Le [plan d'implémentation](docs/PLAN-IMPLEMENTATION.md) et la [matrice des capacités](docs/MATRICE-CAPACITES.md) décrivent le produit à construire. Les décisions structurantes ci-dessous sont acquises ; la [qualification Sites](docs/QUALIFICATION-SITES.md) distingue les preuves techniques de la future recette du socle complet.

Le [dépôt GitHub](https://github.com/creezio/Creezio-D1R2) est public ; son contenu documentaire actuel est accompagné de la [licence MIT](LICENSE). Le produit doit prévoir **Community et fonctions Enterprise activables**, ainsi qu'un service d'accompagnement. Licence, tarifs, périmètre premium et accès des SaaS à Community ou à Enterprise seront décidés plus tard. L'[architecture des éditions et de l'activation](docs/LICENCES-ET-OFFRES.md) prépare ces choix sans remplacer le LICENSE actuel. Le socle complet reste à construire.

Le dossier [Extensions, thèmes et écosystème](docs/EXTENSIONS-THEMES-ECOSYSTEME.md) propose le SDK communautaire, le catalogue, les mises à jour individuelles et un starter produisant une extension installable et sa démonstration Cloudflare.

Un module ou extension Creezio possède ses données, sa logique métier, ses API, ses relations intermodules et ses écrans. Sa partie plugin conversationnel expose les outils MCP, skills et widgets selon le format standard GPT, sans dupliquer le backend ni les données. La publication dans ChatGPT est facultative ; le chat Creezio héberge plusieurs de ces plugins. Chaque application possède son MCP d'administration et peut exposer son MCP destiné aux utilisateurs métier, dans le workspace ou dans le front, avec catalogues et droits distincts dans un même déploiement. Le [contrat de compatibilité ChatGPT](docs/COMPATIBILITE-CHATGPT.md) définit cette cible et sa recette réelle, encore à réaliser.

## Implémentation en cours

Le GO complet a été reçu le 26 septembre 2026. [P0](docs/IMPLEMENTATION-P0.md), les [contrats SDK](docs/IMPLEMENTATION-T02.md), le [Worker commun](docs/IMPLEMENTATION-T03.md) et les [comptes/sessions D1](docs/IMPLEMENTATION-T04.md) sont construits. Les rôles, contextes et exceptions persistants sont intégrés par PR #6, avec modification du graphe autorisée au commit. La tranche courante ajoute les services natifs d’invitation, d’activation et de récupération de compte. Les preuves exactes accompagnent chaque PR et sa CI ; T-04 reste en cours, sans parcours HTTP ni interface de connexion exposés. Le produit complet n'est pas implémenté et la sonde hébergée garde sa portée limitée.

Avec Node 24, installer une fois les dépendances verrouillées par `npm ci --ignore-scripts`, puis lancer `npm run dev`. Le développement utilise D1/R2 locaux persistants et ne demande aucune clé fournisseur. `npm run build` prépare le Worker et les assets ; `npm start` exécute ce build localement. La composition de départ ne contient pas encore les modules natifs : sa page vérifie uniquement la présence des bindings et la réponse du socle. L'authentification native, les données métier et le workspace suivent dans les lots du backlog.

`npm run check` vérifie documents, contrôleurs, contrats, SQL généré, types, build, runtime et identité D1. `npm run test:contracts` cible les contrats ; `npm run test:runtime` nécessite un build à jour ; `npm run test:identity` cible primitives, services et refus. `npm run data:access` régénère explicitement le schéma d'access, puis `npm run check:data` contrôle sa concordance sans écrire de données. Les tests exercent un module témoin explicitement sélectionné et des données synthétiques isolées. Ils ne prouvent ni une publication du CMS sur Sites/Cloudflare, ni le cycle d'installation des paquets communautaires.

| Document | Usage |
|---|---|
| [PRD](docs/PRD.md) | Définition de Creezio, publics, parcours, périmètre et réussite attendue. |
| [Exigences](docs/EXIGENCES.md) | 89 exigences identifiées avec critères, preuves et profils de recette. |
| [User stories](docs/USER-STORIES.md) | 39 résultats attendus pour les utilisateurs et développeurs. |
| [Backlog](docs/TODO.md) | 39 lots de travail, dépendances, livrables et état réel ; liste canonique des tâches. |
| [Plan d'implémentation](docs/PLAN-IMPLEMENTATION.md) | Architecture, lots P0 à P9 et recette complète. |
| [Architecture des dépôts](docs/ARCHITECTURE-DEPOTS.md) | Socle, douze familles natives, fork, modules externes et registre central. |
| [Dépendances entre modules](docs/DEPENDANCES-MODULES.md) | Relations obligatoires/facultatives, versions, graphe et protection du cycle de vie. |
| [Interactions des widgets](docs/INTERACTIONS-WIDGETS.md) | Plusieurs widgets par module, modes message/contexte/direct et parité des chats. |
| [Standard module](docs/STANDARD-MODULE.md) | PRD/changelog/docs, contrats, six suites CI et paquets vérifiables. |
| [Développement](docs/DEVELOPMENT-STANDARD.md) · [Git flow](docs/GIT-FLOW.md) | Règles de travail, branche/PR/revue/squash, versions et publication. |
| [Skills](skills/README.md) · [Contribuer](CONTRIBUTING.md) · [Fichiers](FILES.md) | Points d'entrée pour humains et IA. |
| [Audit avant développement](docs/AUDIT-AVANT-DEVELOPPEMENT.md) | Corrections, couverture, limites et prérequis avant les différents jalons. |

## Objectif

Un socle d'applications personnelles, internes ou SaaS avec backend et modules prêts à l'emploi. Le back-office conserve l'identité Creezio et peut constituer toute l'interface de l'application, avec des vues et opérations accordées selon les rôles ; l'administration du système exige des droits spécifiques. Un front facultatif consomme les mêmes API : thèmes composant automatiquement les vues des modules, personnalisation libre ou interface headless indépendante.

Le [cadre produit et communauté](docs/CADRE-PRODUIT-ET-COMMUNAUTE.md) précise les usages, les trois familles de modules, la création avec ou sans GitHub, le registre central des applications, les skills de développement et les contrôles de conformité. L'enregistrement central sera obligatoire à la publication officielle, avec propriétaire vérifié par GitHub ou email ; le développement local reste possible hors ligne. Le registre, à construire, conserve les métadonnées des applications enregistrées et leurs versions déclarées, sans centraliser leurs données métier.

Chaque application rassemble son administration et son front dans un seul projet/repo et un déploiement applicatif commun. GPT Sites est la cible principale ; le socle ne dépend ni de Docker ni de processus persistants. Sur Sites, un couple D1/R2 commun dessert l'application avec séparation logique des données par contexte et droits serveur. Docker permet aussi de choisir des ressources D1/R2 distinctes, sans multiplier les instances de l'application.

## Exigences acquises

- GPT Sites avec ses D1/R2 natifs ; développement local Docker avec Miniflare/D1/R2 persistants ; publication de l'application complète sur le compte Cloudflare de l'utilisateur : Workers, front/back-office, D1 et R2. La production ne dépend plus du local. L'accès depuis Docker aux données Cloudflare reste aussi possible. Voir [stockage et hébergement](docs/STOCKAGE-ET-HEBERGEMENT.md).

- Fournir les capacités du produit dans le socle ou dans des modules complets, selon leur rôle et leurs besoins d'exécution.
- Concevoir le stockage pour D1 et R2. Meilisearch, Hermes, n8n et les services incompatibles avec le serverless deviennent des extensions optionnelles connectées à des services externes.
- Distinguer les capacités natives, les extensions communes installables (exemples : catalogue produits, Stripe) et les extensions propres à chaque application.
- Standardiser les modèles actuels, données, API, MCP, permissions, index/projections de recherche et contributions UI de chaque extension. L'installation initialise une base neuve ; les mises à jour préservent les données présentes.
- Générer et inspecter le SQL de création et d'évolution dans la chaîne centrale de publication, puis le versionner avec la source. Les modules déclarent leurs modèles et ne fournissent aucun script de transformation SQL.
- Publier les Sites du projet en mode public : le front est atteint directement, puis les comptes et sessions natifs Creezio protègent les fonctions du navigateur. Les API/MCP sont aussi accessibles aux clients externes avec leur autorisation machine, sans cookie. Droits et données restent protégés dans les deux cas, sans connexion GPT ni identité ChatGPT implicite.
- Fournir le LLM du chat par un module OpenAI activé et configuré avec une clé API serveur. Le chat, ses conversations, outils et widgets restent des capacités Creezio ; sans configuration valide, aucune réponse IA n'est simulée.
- Ajouter au contrat d'extension les widgets interactifs affichables dans le chat, utilisant les mêmes opérations métier et permissions que le front.
- Fournir des modules prêts à configurer : n8n ou Stripe apportent déjà leurs API, outils MCP, droits, événements et interfaces/widgets. Chaque application ne doit pas réintégrer le fournisseur.
- Les applications tierces restent entièrement gérées hors de Creezio : aucun hébergement, installation ou mise à jour de n8n/Hermes/Meili. Le module reçoit les accès à un service existant ; sa mise à jour concerne uniquement l'intégration.
- La planification appartient à n8n ou à un autre service externe qui appelle Creezio par API avec jeton ou par MCP. Aucun scheduler interne n'est nécessaire. Creezio garde les opérations, tâches, approbations, états et journaux ; les relances automatiques arrivent de l'extérieur. Cet accès API/MCP natif fonctionne sans installer le module n8n, qui apporte le pilotage et l'intégration de ce fournisseur.
- Permettre des extensions officielles, communautaires ou privées, avec versions et mises à jour individuelles. GitHub pour les sources, paquets pour la distribution, catalogue pour la découverte et la compatibilité. Prévoir politiques Community/Enterprise et services d'accompagnement ; conditions commerciales et éligibilité des SaaS restent à décider.
- Créer la première app de test par véritable fork GitHub public sous `Creez-io/Creezio-Lab`, après structuration et validation du socle. Les applications qui doivent rester privées utilisent des dépôts indépendants avec origine du socle, versions et mises à jour conservées. La visibilité du dépôt GitHub et l'audience du Site sont indépendantes.
- Préserver toutes les fonctionnalités des interfaces d'administration, notamment les onglets et le chat standard Creezio. Les chats métier personnalisés appartiennent au front, pas à l'administration.
- Monter les vues administratives dans des panneaux React stables, avec identité, localisation et historique propres à chaque panneau. Le routeur hôte gère URL et liens directs ; les modules utilisent le SDK sans importer les contextes privés Next/Vinext. La conservation des brouillons, du scroll, des widgets et des interactions reste à vérifier dans le navigateur et sur chaque cible.
- Fournir un front de départ facultatif, entièrement remplaçable, des composants réutilisables et un registre montant les vues autorisées des modules sans recoder l'app ou le thème.
- Livrer des thèmes de front, dont un thème ChatGPT-like, sans modifier le back-office standardisé.
- Fournir un SDK pour les fronts headless et un dépôt de départ de module, avec données/API/MCP/widgets/UI et démonstration déployable à partir du même paquet.
- Sur GPT Sites, effectuer les mises à jour sur demande de l'utilisateur ou d'une tâche GPT planifiée, puis les vérifier. La publication n'est pas déclenchée depuis le back-office.
- Sur Docker, permettre les mises à jour depuis le back-office via un module de livraison adapté à l'hébergement. Le socle serverless reste indépendant de Docker.
- Depuis le développement local, fournir l'action Publier sur Cloudflare : configurer les accès, envoyer application/données/fichiers, vérifier la production. Les mises à jour suivantes conservent les données de production.
- Garder le socle générique ; les règles de restaurants, points de vente ou autres métiers relèvent des extensions.

## Ordre de travail demandé

1. Préparer et auditer PRD, exigences, stories, backlog, contrats et méthode ; attendre le GO avant développement.
2. Après GO, qualifier la gouvernance P0 puis construire le socle selon le backlog et les décisions validées.
3. Faire fonctionner l'original sur un premier GPT Site. Une fois le socle structuré et vérifié, créer une première application de test par véritable fork et la faire fonctionner sur un second GPT Site indépendant. Le dépôt doit démarrer directement avec son front de départ, son back-office et sa persistance ; aucun assemblage manuel propre à la démo.
4. Valider le parcours de mise à jour Docker séparément, puis faire valider l'application de test avant de construire d'autres applications métier.

L'application de test générique « Creezio Lab » sera créée comme véritable fork public `Creez-io/Creezio-Lab` après validation du socle. Cette destination est approuvée ; le fork n'est pas encore créé. L'original reste `creezio/Creezio-D1R2`, sans transfert ni changement d'offre. Les applications et productions existantes restent préservées.
