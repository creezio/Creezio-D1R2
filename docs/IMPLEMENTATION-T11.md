# T-11 — Modules et dépendances

Tranche `core/t11-module-lifecycle`, depuis `f52a17b9` (PR #19, 866 tests), en qualification finale avant intégration. Le [backlog](TODO.md#T-11) conserve l'état global ; les exigences [1101 à 1106](EXIGENCES.md#REQ-1101) sont inchangées.

## Interface conservée

Le module natif `creezio.modules-settings` adapte les composants Product Hub `plugins-list.tsx` et `plugin-detail.tsx` du Creezio original : liste, fiches, badges, onglets et actions. Les raccordements reposent sur le SDK workspace et les opérations communes. Aucun sidecar, gestionnaire de processus ou installation de service tiers n'est réintroduit. Documentation installée et PRD éditable restent raccordés dans leurs lots T-12/T-23.

## Inventaire et plans

Au build, un inventaire fermé vérifie les descripteurs, origines explicitement autorisées, verrous et archives locales réellement assemblées. `configuration/module-inventory.json` ajoute des candidats présents sans les activer. Les candidats de la composition sont inclus. Les archives déterministes réutilisent un cache unique adressé par empreinte ; aucune transformation des octets des sources, exécution de module ou récupération réseau. Le verrou se renouvelle uniquement via `npm run modules:lock -- --write`, après examen des changements ; son contrôle par défaut refuse les divergences.

L'inventaire est injecté uniquement au module natif dont l'origine et le chemin source sont vérifiés. Le navigateur envoie des choix et une base de révision/empreintes, jamais un descripteur, un verrou de remplacement ou du code. Le solveur commun à Node et au Worker conserve les sélections hors périmètre, résout les dépendances depuis cet inventaire et applique les règles de contrat T-02. Une source substituée, une dépendance manquante ou incompatible et un retrait qui casse un consommateur bloquent le plan. Les contributions facultatives suivent leurs déclarations. L'acceptation recalcule le résultat.

Les choix sont bornés à 32 actions et 8 Kio ; le résumé persistant à 8 Kio. Un dépassement produit un refus explicite, sans tronquer une décision. Les données de catalogue/journal sont paginées. Le code présent, l'activation, la configuration et les conditions de fonctionnement restent des états distincts ; les diagnostics locaux ne sont pas un contrôle de disponibilité d'un fournisseur distant.

L'ajout et l'activation demandent explicitement les audiences à exposer : administration, utilisateurs, les deux, ou aucune (headless). Le plan reprend cette décision ; les dépendances ajoutées au plan ne reçoivent pas automatiquement une exposition ni des droits. Le retrait et la désactivation enlèvent l'exposition au prochain build. La dépendance native Modules → Access interdit de retirer l'authentification tout en conservant son administration active.

## Persistance et publication

Les modèles privés `head`, `plans` et `journal` appartiennent au module. Leurs tables sont générées centralement depuis les modèles actuels, comme celles d'Access. La première acceptation crée la tête révision 1, le plan et le journal dans le batch T-06 qui contient également le résultat et l'audit ; ensuite le CAS porte la révision et les empreintes de base. Droits, audience admin, contexte application et identité sont revérifiés au commit. Aucun droit implicite n'est accordé au propriétaire.

Un plan accepté est `accepted_pending_publication`. L'état effectif provient uniquement des empreintes de composition/verrou embarquées par le Worker. Une nouvelle demande ne peut remplacer silencieusement le plan encore à publier. Désactiver ou retirer un module conserve ses données et historiques. Les API/MCP/UI courantes continuent de suivre la composition déployée ; elles changeront avec la publication. Sites exige une publication demandée dans GPT ; les adaptateurs Docker/Cloudflare du lot T-32 consommeront les plans sans changement de logique métier.

Le client conserve la clé avant envoi, puis utilise la lecture d'exécution après réponse incertaine. Il ne rejoue pas automatiquement une commande dont le résultat est inconnu. Les écrans conservent leur identité et leur état de panneau via le SDK et invalident leurs données lorsque l'identité change.

## Vérification et limites

Six suites locales propres au module vérifient modèles, UI déclarée, API/MCP, absence explicite de widget, emballage et docs. Les suites `tests/modules/` exercent le résolveur, les archives, le client, le service, les gardes D1 et l'interface. Le contrôle global inclut composition, SQL, types, build et runtime Workerd ; la recette navigateur porte son artefact final.

Les contrôles D1 couvrent notamment deux acceptations concurrentes, le rollback forcé du journal, la relecture du résultat et la distinction entre plan en attente et composition effective. Le client MCP réel découvre les seize outils Access/Modules, prépare puis accepte un plan sous OAuth natif. La recette navigateur vérifie le refus de désactiver Access tant que Modules en dépend, les fiches indépendantes, le journal, la conservation de la commande après une réponse HTTP 200 coupée et un rechargement (une seule acceptation D1), puis la suppression des vues après révocation fraîche. Sources, artefact, résultats et limites de chaque recette sont consignés dans les preuves du candidat, hors de son commit.

Le premier build complet mesure 2 643 213 octets de JavaScript serveur (SSR inclus), soit 574 726 compressés, contre 1 978 546 / 492 502 pour Access seul. Les quinze nouveaux schémas statiques, les six opérations, l'inventaire vérifié et les écrans expliquent cette croissance ; aucune seconde copie complète de l'inventaire n'a été trouvée dans le SSR. Les plafonds locaux sont ajustés à 2 800 000 / 625 000, avec une marge limitée. Les contrôles restent actifs, sans modifier les plafonds de démarrage/latence ni les frontières serverless. Ces mesures agrégées ne sont pas des quotas d'hébergement.

Le contrôle d'archives ne certifie pas encore un paquet tiers autonome distribué et installé : T-30 conserve cette recette. T-12 ajoute la lecture documentaire, T-23 ses révisions de travail, T-32 la publication effective. Sites et la recette ChatGPT demeurent à qualifier avec leurs accès. Aucun de ces raccords n'est annoncé livré par une simple acceptation de plan.
