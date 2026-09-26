# Dépôts, propriété des fichiers et composition

Architecture cible au 26 septembre 2026. Les contrats et le runtime commun ont leur première qualification locale ; les fondations d'identité sont en cours. Cet arbre décrit aussi les modules/interfaces **encore à construire**, sans prétendre qu'ils sont livrés. Consulter le [backlog](TODO.md) et les documents de réalisation pour chaque périmètre.

## Quatre responsabilités distinctes

| Dépôt / composant | Rôle et propriété | Distribution |
|---|---|---|
| `creezio/Creezio-D1R2` | Socle, workspace, modules natifs, SDK, thèmes, adaptateurs, outillage et documentation de référence | Dépôt prêt à démarrer et releases cohérentes ; paquets versionnés lorsque leurs frontières sont stabilisées. |
| App dérivée, dont le futur `Creez-io/Creezio-Lab` | Composition, front et modules propres dans `application/`, configuration et données de son déploiement | Vrai fork public ou dépôt indépendant privé avec provenance. Aucune donnée ni secret livré dans Git. |
| Starter puis dépôts des modules externes | Un module complet, ses tests/docs, sa projection plugin et sa démo | Paquet de module, artefact de validation autonome, paquet de plugin et démo distincts, même version source. Le nom du dépôt starter sera choisi lors de sa création. |
| Registre central Creezio | Propriétaires vérifiés, installations/déploiements, versions et politiques d'offres ; accompagnement consenti | Service séparé avec son propre déploiement. Les apps embarquent son client et les justificatifs nécessaires, pas son serveur. |

Les sources des connecteurs optionnels officiels peuvent d'abord résider dans `extensions/common/` pour partager l'outillage ; leur publication reste indépendante. Un module externe peut être développé dans un dépôt dédié ou dans le workspace d'une app. Son origine effective est unique : source locale sélectionnée **ou** paquet verrouillé. Pas de copie simultanée concurrente.

## Arbre du socle et des applications dérivées

```text
AGENTS.md, FILES.md, CONTRIBUTING.md, README.md
.github/                  Issues, PR, propriétaires et contrôles réellement activés au lot P0
governance/               Politique de développement versionnée et règles attendues
app/                      Entrées HTTP et montage des surfaces
core/                     Identité, droits, données, coffre, opérations, événements, registre
admin/                    Workspace standard : onglets, panneaux, chat et administration
ui/                       Composants, composition et hôte des widgets
themes/                   Standard et ChatGPT-like
extensions/native/        Modules fonctionnels fournis d'origine
extensions/common/        Modules optionnels officiels ou métier communs
sdk/                      Contrats, SDK headless, validateurs et tests indépendants
catalog/                  Métadonnées signées/versionnées, sans secrets
application/config/       Composition, branding du front, choix des modules et thèmes
application/frontend/     Personnalisations ou front indépendant de l'application
application/extensions/   Modules métier propres à cette application
adapters/sites/           Conventions Sites, bindings et transports
adapters/docker/          Développement local et exécuteur local de livraison
adapters/cloudflare/      Publication Worker/assets et ressources réellement déployées
adapters/storage/         Résolution du stockage et capacités disponibles
data/                     Modèles composés et SQL central généré/versionné
scripts/                  Contrôles, build, emballage et livraison
skills/development/       Guides canoniques, routage documenté et adapters de découverte
docs/                     PRD, exigences, stories, tâches, contrats et preuves
```

L'organisation source n'impose pas un paquet npm ou un Worker par dossier. Le code métier reste indépendant du routeur ; les exports serveur/client et les assets sont vérifiés au packaging. Le lockfile et le manifeste de composition peuvent évoluer dans un fork : leur différence est attendue et contrôlée. La frontière de propriété, pas une comparaison aveugle d'arbres identiques, gouverne l'adoption des mises à jour.

## Modules natifs à conserver

Les identifiants de dossiers suivants fixent les familles ; le registre de manifestes validera les identifiants qualifiés et leurs dépendances. Le mécanisme technique d'une fonction peut appartenir au cœur, son écran et son parcours à un module natif.

| Module | Fonctions et frontières |
|---|---|
| `access` | Comptes, invitations, rôles et gestion des accès ; l'enforcement reste dans le cœur. |
| `data-explorer` | Exploration autorisée des modèles, entités, fichiers, relations, exports ; aucune écriture contournant les opérations. |
| `modules-settings` | Onboarding, catalogue, activation, connexions, configuration, diagnostics, versions et docs de la version installée. |
| `conversations` | Chats, historique, brouillons, recherche, archives, pièces jointes et progression ; le LLM reste un fournisseur configuré. |
| `tasks-work` | Tâches humaines, kanban, demandes, exécutions, quotas et validations. |
| `messaging` | Boîtes, messages, composition, brouillons, HTML sûr, pièces jointes et états d'envoi ; transport externe. |
| `support` | Tickets, réponses, affectations et suivi des statuts. |
| `crm` | Contacts, entreprises, prospects et liens métier autorisés. |
| `pages-navigation` | Pages, landing, navigation, médias, SEO, publication et remise à zéro explicitement contrôlée. |
| `analytics` | Usage, productivité, erreurs, diagnostics et consultation de l'audit selon les droits. |
| `intentions-development` | PRD révisionnés, clarifications, validations humaines, tâches et artefacts ; exécution par prestataires/agents externes autorisés. |
| `automation-rules` | Définitions, événements, déduplication, journal et reprise ; aucun scheduler intégré. |

## Modules communs et exemple de composition

Catalogue produits, OpenAI, Stripe, n8n, Meili, Hermes, transport mail, navigateur distant, Granola, agents de développement, export d'observabilité, desktop/infrastructure et livraison locale sont des familles de modules optionnels. Le contrat fournisseur permet d'autres IA et capacités vocales. Pour chacun, le périmètre des opérations et les accès requis sont documentés ; une fonction non testée avec le fournisseur ne devient pas « opérationnelle » par présence de fichiers.

Le fork de recette utilise une **demande d'achat** avec titre, statut, montant proposé et pièce jointe ; un second module de validation de budget complète obligatoirement cette recette via un contrat public, pour prouver les relations intermodules. Un comparateur externe possède fournisseurs/offres/comparaisons/documents et consomme les ports publics de catalogue/achats si ces intégrations sont sélectionnées. Il ne dépend pas d'un module privé du fork, ne lit pas ses tables privées et reste utilisable seul. Le parcours minimal de demandes reste testable sans Stripe, Meili ou comparateur configuré.

Chaque module possède le même dossier documentaire, les six suites CI, les tests et les contributions UI/plugin décrits dans [STANDARD-MODULE.md](STANDARD-MODULE.md). Une absence de vue ou de widget pour une opération purement technique est justifiée et testée ; elle ne dispense pas le module de son contrat global.

## Propriété et mises à jour

| Surface | Mainteneur | Règle d'évolution |
|---|---|---|
| Cœur, workspace, SDK, adaptateurs et natifs | Creezio | Release cohérente ; corrections locales contribuent par PR ou sont identifiées comme divergence à résoudre. |
| Module commun/tiers ou thème | Son éditeur | Version et compatibilité indépendantes ; paquet verrouillé, update ciblée puis build/recette de l'app complète. |
| `application/` | Éditeur de l'app | Conservé lors des mises à jour ; hooks et ports publics pour étendre les comportements. |
| Modèles composés/SQL et lockfiles | Outils de composition, sous revue de l'app | Génération déterministe et diff vérifié ; jamais remplacés aveuglément. |
| Données, secrets, déclarations de déploiement | Exploitant de l'app | Hors sources distribuées ; transfert initial contrôlé, aucune réimportation locale automatique aux updates. |

Le client du registre déclare l'origine et les versions effectivement installées. Une copie sans GitHub conserve une provenance mais n'est pas annoncée comme un fork GitHub. Les réglages de protection de branche et les droits de publication ne sont pas hérités par copie des fichiers ; leur activation fait partie du parcours officiel de création d'un dépôt.

## Graphe intermodules

Le module natif `modules-settings` présente le graphe « dépend de / utilisé par » ; le SDK valide et résout les déclarations de toute origine. `application/config/` porte les choix et le verrou de composition. Le serveur commun protège installation, activation, update et retrait, indépendamment de l’interface employée. Le [contrat des dépendances](DEPENDANCES-MODULES.md) s’applique aussi entre modules de deux éditeurs tiers. Ni la séparation des dépôts ni un paquet npm ne crée une nouvelle instance de données ou un runtime par module.
