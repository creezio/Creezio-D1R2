# Produit, création d'applications et communauté

Contrat de conception du 26 septembre 2026, avant implémentation. Il complète le [plan](PLAN-IMPLEMENTATION.md), le [contrat des extensions](EXTENSIONS-THEMES-ECOSYSTEME.md) et celui des [plugins conversationnels](COMPATIBILITE-CHATGPT.md). Les parcours, le registre central et les contrôles décrits restent à construire et à qualifier.

## Définition du produit

Creezio est un socle d'applications à sources publiques, nativement serverless, inspiré du fonctionnement d'un CMS extensible : backend, données, comptes, droits, API, back-office, chat et modules natifs doivent être prêts à être utilisés et étendus. Il sert à une personne, à une équipe interne ou à un SaaS. L'application peut utiliser directement le workspace Creezio avec les rôles appropriés, proposer un front standard composé dynamiquement depuis les modules, personnaliser ce front par un thème ou construire un front headless indépendant. Les modules natifs, métiers communs et spécifiques respectent les mêmes contrats ; leur partie plugin conversationnel expose outils et interfaces dans les chats Creezio ou ChatGPT. Le code et les règles métier restent communs entre Sites, le développement local et Cloudflare ; des adaptateurs et capacités explicites déterminent ce que chaque hébergement permet. L'architecture prévoit éditions, activation premium et accompagnement ; leurs contrats, tarifs et règles d'accès des SaaS restent différés selon [Licences et offres](LICENCES-ET-OFFRES.md).

## Usages et rôles

| Usage | Interface possible | Accès |
|---|---|---|
| Application personnelle | Workspace Creezio directement ; front facultatif | Un propriétaire avec ses données et ses fonctions. Aucun recrutement d'utilisateurs externes imposé. |
| Application d'entreprise | Workspace Creezio pour toute l'équipe, ou front adapté à l'organisation | Comptes et rôles : opérateur, responsable et administrateur selon les permissions accordées. |
| SaaS ou application destinée à des clients | Front standard thémé ou front indépendant ; workspace pour les personnes autorisées | Fonctions métier séparées de l'administration système ; contexte de données vérifié côté serveur. |

L'accès au workspace et le droit d'administrer le système sont deux autorisations distinctes. Un opérateur peut utiliser ses écrans métier, onglets et chat dans le workspace sans gérer les secrets, extensions, connexions ou comptes de toute l'application. Aucune session ne reçoit des permissions du seul fait qu'elle utilise une URL de back-office. Le premier propriétaire est établi par un parcours contrôlé ; les rôles suivants sont configurés explicitement.

Le front est livré prêt à l'emploi mais son activation est facultative. Une application sans front spécifique ouvre son parcours de connexion/workspace ; elle ne nécessite pas de pages métier supplémentaires. Un front personnalisé reste possible pour un outil interne comme pour une application publique. Les thèmes changent la présentation ; le workspace conserve ses interactions Creezio standard.

La séparation MCP admin/utilisateur correspond aux **pouvoirs exposés**, pas au choix visuel du front ou du workspace. Le MCP utilisateur peut servir un employé interne utilisant le workspace. Le MCP admin exige les droits d'administration ; il n'est jamais obtenu automatiquement par un utilisateur du back-office. Un compte auquel les deux usages sont accordés garde des autorisations explicites pour chaque connexion.

## Trois familles de modules, un contrat

1. **Modules natifs** : capacités livrées d'origine et maintenues avec le socle, selon la matrice produit.
2. **Modules communs installables** : fonctionnalités transverses ou métier réutilisables par plusieurs applications, par exemple catalogue, achats, stocks, paiement ou comparaison de fournisseurs. Un module métier n'est pas nécessairement spécifique à une marque.
3. **Modules spécifiques** : règles, objets et parcours propres à une application, publics ou privés.

Les développeurs utilisent les mêmes contrats de données, relations, opérations, droits, API/MCP, indexation, événements et UI. Une contribution à un module natif suit la revue de l'amont ; une extension métier peut évoluer indépendamment. Le cœur ne contient pas les exceptions propres à chaque client.

Chaque module déclare ses tables/modèles, fichiers et projections de recherche. L'adaptateur de recherche native ou Meili configuré exploite ces déclarations sans intégration propre à chaque app. Les relations entre modules passent par les contrats publics et leurs permissions ; les données ne sont pas dupliquées dans les widgets. Voir la distinction module complet / plugin conversationnel dans le [contrat ChatGPT](COMPATIBILITE-CHATGPT.md).

## Front composé depuis les modules

Une contribution UI déclare un identifiant stable, ses surfaces autorisées, sa route, ses entrées de navigation, ses permissions, ses composants exportés, ses paramètres et sa compatibilité avec les thèmes. Le build assemble le registre des contributions, leurs ressources et leurs dépendances ; l'exécution sélectionne les modules actifs et les vues permises à l'acteur.

Le front standard et tous les thèmes officiels consomment ce registre. Installer et activer un module qui déclare une vue front fait apparaître cette vue et sa navigation sans modification manuelle du routeur de l'app ou du thème. Un module réservé à l'administration ou sans vue front n'ajoute pas une page client implicite. L'auteur fournit les vues métier nécessaires ; des rendus génériques documentés peuvent couvrir les listes/formulaires courants, sans prétendre inventer un écran spécialisé depuis les seules tables.

Changer de thème conserve données, routes stables, permissions et actions. Désactiver un module retire ses points d'entrée et gère ses liens/widget historiques sans supprimer ses données. L'ajout de code demande toujours un build et une publication ; cette intégration automatique ne suppose pas de charger du code arbitraire à chaud.

Le SDK headless expose opérations, comptes, fichiers, conversations et registre de contributions. Un front entièrement indépendant peut réutiliser le moteur de composition ou créer ses propres écrans. L'apparition automatique des vues est garantie pour les thèmes compatibles et pour un front qui utilise ce moteur ; une interface librement codée n'est pas modifiée automatiquement à l'insu de son auteur.

## Une architecture, des capacités d'hébergement

Le runtime, les modèles, les opérations, les permissions, les modules et les contrats UI restent identiques. Aucun module ne contient une seconde logique métier conditionnée par le nom de l'hébergeur. Les adaptateurs exposent un profil de capacités versionné et validé ; une fonction non disponible est refusée explicitement, sans repli silencieux changeant le sens des données.

| Capacité | Sites | Local Docker/Miniflare puis Cloudflare direct |
|---|---|---|
| Stockage partagé d'application | Un couple D1/R2 natif, isolation logique | Même fonctionnement disponible |
| Ressources distinctes par contexte/client | Non proposé | Possible via résolution de ressources autorisées ; qualification réelle obligatoire |
| Métier, rôles, modules, workspace et front | Contrats communs | Contrats communs |
| Livraison | Demande et exécution dans GPT | Outillage local/CI autorisé ; déclenchement administratif local possible |
| Progression du chat | Adaptateur tenant compte du regroupement du flux observé | Même protocole d'événements ; transport selon capacités vérifiées |

La résolution de stockage reçoit un contexte serveur autorisé ; elle ne reçoit pas un nom de base choisi librement par le navigateur. Hors Sites, des D1/R2 distincts sur Cloudflare doivent fonctionner derrière le même backend applicatif, sans Docker permanent requis ni app par client. Le résolveur choisit parmi les bindings autorisés réellement déployés ; ajouter une ressource exige provisioning et raccordement/configuration du Worker. Un identifiant n'est pas un binding créé à la volée. Tester quotas et routage avant d'annoncer ce mode opérationnel. La limite Sites est une capacité de l'hébergement, pas une architecture différente. Les fonctions premium sont décidées dans un périmètre commercial distinct ; payer ne supprime aucune limite de plateforme.

Le couple D1/R2 est la restriction produit de stockage retenue pour Sites. Les contraintes de transport et de publication déjà observées restent prises en charge par les adaptateurs ; ne pas effacer leurs preuves sous prétexte d'une architecture commune. Les modules ne réimplémentent pas ces adaptations.

## Créer une application avec ou sans GitHub

Le dépôt livré inclut un parcours de création reproductible utilisable par un humain ou par une IA, ses skills de développement, ses contrats et son outillage. Le skill de création vérifie les capacités et accès réellement disponibles : il ne peut pas supposer qu'une demande formulée dans n'importe quel chat dispose automatiquement d'un outil GitHub capable de créer un fork.

- **GitHub connecté et droits adaptés** : vérifier le propriétaire cible puis créer un véritable fork public ; contrôler sa relation avec l'amont. Ne pas confondre lecture de dépôts et autorisation d'en créer. La connexion est proposée si nécessaire ; aucun jeton partagé n'est livré dans Creezio.
- **Sans GitHub** : récupérer une release/SHA précise des sources publiques, créer l'app et conserver sa provenance. Cette copie peut fonctionner sur Sites ou hors Sites. Elle n'est pas annoncée comme un fork GitHub ; l'identifiant de dépôt reste absent jusqu'à un éventuel rattachement.
- **Application aux sources privées** : dépôt indépendant avec origine, versions et manifeste de composition conservés. Un fork public ne devient pas privé par simple configuration.

Le manifeste de provenance conserve origine, release/SHA initial, versions des contrats, composition verrouillée et mode de création. L'identité du projet, celle de chaque déploiement et celle du dépôt sont distinctes. Un fork crée ses propres identifiants/secrets ; un rattachement ultérieur à GitHub conserve l'identité du projet sans inventer une relation de fork. Le stockage source de Sites reste distinct du dépôt GitHub : le parcours vérifie la révision utilisée et évite deux sources divergentes silencieuses.

La connexion GitHub, le fork, l'enregistrement Creezio, la création du Site et sa publication sont des opérations séparées et reprenables. Un échec partiel conserve les ressources créées et indique l'étape restante ; relancer ne crée pas une seconde app. Une connexion absente n'est pas présentée comme acquise.

## Registre central Creezio

Le service central demandé enregistre les projets et leurs déploiements, propriétaires, URL, dépôt éventuel, origine, versions du socle et de ses contrats, composition autorisée et dernière déclaration datée. Il aide à suivre l'adoption, les versions et les contributions. Il est distinct des applications clientes : leurs requêtes métier, données D1/R2, comptes utilisateurs, conversations et secrets fournisseurs ne transitent pas par lui.

Le parcours officiel demande un identifiant de projet et un token de déclaration à portée limitée pour chaque installation/déploiement. Développement et production peuvent appartenir au même projet sans partager un secret ; un nouveau fork reçoit une identité de projet propre. Le secret est conservé côté serveur ou dans l'environnement de livraison, jamais dans le front, le Git ou un paquet public. Il permet d'enregistrer et actualiser les métadonnées de cette installation ; il ne donne pas l'administration des autres apps et ne remplace ni une session applicative, ni OAuth MCP, ni un accès GitHub/Cloudflare. Rotation, révocation et changement de propriétaire sont des opérations explicites.

Une création conduite dans GPT peut appeler ce service si un outil HTTP/MCP et les autorisations nécessaires sont disponibles. Elle renseigne le dépôt lorsqu'il existe, puis l'URL après publication réussie, avec idempotence et reprise. L'URL et le dépôt sont déclarés puis vérifiés selon les accès disponibles ; un token seul ne prouve pas leur possession. Les adresses de dépôts privés et coordonnées du propriétaire ne sont pas publiées dans un catalogue public. Le propriétaire voit les métadonnées transmises ; aucune collecte de ses utilisateurs métier n'est nécessaire.

La création, la livraison vérifiée, le changement d'URL/dépôt et une synchronisation explicite mettent à jour le registre. Une tentative de livraison n'est pas une version installée confirmée. Le registre affiche état déclaré/vérifié, révision, date et éventuel retard de synchronisation ; sans nouveau contact il ne prétend pas connaître l'état actuel. Aucun scheduler n'est ajouté aux apps : un suivi régulier éventuel est assuré par un service externe configuré.

**Décisions approuvées : enregistrement obligatoire à la publication dans le parcours officiel, développement local possible hors ligne et propriétaire vérifié par GitHub ou email.** Une connexion GitHub déjà autorisée peut simplifier ce parcours ; sans GitHub, vérifier l'email par un lien/code limité dans le temps. La simple déclaration d'une adresse, un identifiant GPT ou l'accès à un Site public ne vérifient pas le propriétaire. L'automatisation commence après cette autorisation initiale, puis elle peut créer l'installation et recevoir son token sans ressaisie inutile.

Le parcours officiel vérifie l'enregistrement et le token avant d'envoyer une nouvelle livraison. Si cette vérification échoue ou que le registre est indisponible, conserver la préparation et suspendre cette publication ; l'installation déjà en service continue à fonctionner. Après publication réussie, un échec de transmission du résultat laisse une déclaration à reprendre, sans annoncer à tort la version comme synchronisée au registre. La prochaine action autorisée de livraison/synchronisation, ou un service externe configuré, peut la transmettre. Les requêtes métier ne font pas d'appel bloquant au registre et une révocation du token de déclaration ne constitue pas un arrêt distant de l'application.

Le service central est provisionné initialement par son mainteneur, avec propriétaire et identité établis explicitement ; son amorçage ne dépend pas d'une inscription dans un service encore inexistant. Aucun token universel d'enregistrement ou d'administration n'est inclus dans les sources distribuées.

Un code accessible peut être modifié et une copie divergente peut tenter de retirer la déclaration centrale, indépendamment des autorisations que sa licence lui accorde réellement. Le registre suit les installations enregistrées, pas un inventaire exhaustif de toutes les copies. Les relations GitHub identifient les vrais forks visibles, pas toutes les archives ou apps privées. Le modèle Community/Enterprise et les droits premium signés sont détaillés dans [Licences et offres](LICENCES-ET-OFFRES.md) ; ni inscription ni abonnement n'accordent un accès implicite au code ou aux données d'un client.

## Dossier produit et standard des modules

Le [PRD](PRD.md), les [exigences identifiées](EXIGENCES.md), les [stories](USER-STORIES.md) et le [backlog](TODO.md) rendent le plan exécutable et reprenable. Chaque exigence porte critères positifs/négatifs, tâche, profil et preuve attendue. Le [standard des modules](STANDARD-MODULE.md) impose PRD, décisions/interview, TODO, CHANGELOG, README, AGENTS, FILES et gate à tous les modules, avec six suites backend/UI/API-MCP/widgets/package/docs et tests indépendants du SDK. Le [dossier des dépôts](ARCHITECTURE-DEPOTS.md) fixe les frontières et l'inventaire natif.

La documentation de la version installée est embarquée avec le module ; les révisions de travail validées et l'historique d'installation sont des états applicatifs distincts. L'artefact externe de validation conserve toutes les références nécessaires, sans dépendance cachée à un checkout ni secrets de production.

## Skills de développement et contrôles de conformité

Fournir un pack versionné de skills pour créer une app, créer/modifier un module, déclarer modèles/opérations, développer les vues/widgets, tester, publier, mettre à jour et contribuer. Ces skills de **développement** sont distincts des skills **conversationnels** qui guident l'utilisateur du module. Ils référencent les contrats canoniques, les exemples et les commandes, avec un `AGENTS.md` concis ; ne pas multiplier des copies contradictoires des règles.

Les skills guident l'IA. Une même commande de conformité dans le développement local, la CI et les parcours de livraison officiels vérifie et bloque les écarts contrôlables :

- Manifeste, identité/origine, versions, dépendances, modèles D1, fichiers R2 et relations intermodules.
- Registre unique des opérations, schémas d'entrée/sortie et droits, projections API/MCP, séparation des audiences, champs et données protégés.
- Index/recherche déclarés, synchronisation/suppression et reconstruction bornées, filtres d'accès.
- Contributions workspace/front, routeur et navigation composés, contrat des thèmes, frontières serveur/client, widgets et paquet conversationnel standard.
- Capacités d'hébergement, imports compatibles, assets/exports réellement distribués et absence de chemins ou dépendances cachés vers un checkout voisin.
- Installation sur base neuve, évolution compatible conservant les données, collisions et conflits refusés, permissions exercées sur des cas autorisés et interdits.

Des exemples volontairement invalides doivent échouer pour prouver que les contrôles sont effectifs. Les schémas/linters contrôlent la structure ; les tests de contrat et recettes contrôlent le comportement et les intégrations réelles. Aucune validation statique ne prouve toute la logique métier ou l'innocuité d'un module malveillant. Les règles de branche et de publication imposent ces contrôles sur les dépôts administrés ; un fork modifié hors de ces parcours ne reçoit pas automatiquement la qualification Creezio. Les skills ne sont pas une interdiction technique universelle de modifier des sources accessibles. [Rôle des skills](https://developers.openai.com/plugins/build/skills).

## Contributions et mises à jour de l'écosystème

Appliquer [GIT-FLOW.md](GIT-FLOW.md) et [DEVELOPMENT-STANDARD.md](DEVELOPMENT-STANDARD.md) : branches courtes depuis main, commits ciblés, PR à jour, revue technique par un autre agent sur le SHA final, squash uniquement, puis tests de l'artefact du SHA réellement fusionné avant tag/publication. Le compte `creezio` est conservé sans second approbateur GitHub requis ; la preuve de revue reste hors du commit source ou dans un artefact associé. L'orchestrateur vérifie l'origine du workflow et les résultats avant fusion, sans attribuer cette vérification à une protection automatique de GitHub. Synchroniser une branche publiée par merge de main ; pas de force-push/rebase ni de bypass. Le bootstrap PR #1 étendue au P0 est l'exception initiale autorisée au découpage des travaux. Les protections PR/check Actions à jour/squash restent à activer et qualifier ; les consignes seules ne prouvent pas leur application.

Le parcours de retour utilisateur prépare une reproduction minimale, les versions et diagnostics expurgés ; il distingue bug du socle, module officiel, module tiers et personnalisation. L'auteur peut demander l'envoi d'une issue puis proposer une correction. Le token du registre n'accorde pas l'accès GitHub : utiliser une connexion autorisée ou fournir un brouillon/patch prêt à soumettre. Aucun code privé, secret ou donnée métier n'est joint implicitement.

Une correction commune suit : reproduction → test de non-régression → branche de contribution → PR amont → revue du mainteneur → contrôles et recettes pertinents → release versionnée → disponibilité dans les apps compatibles. Une copie sans lien de fork peut reporter son correctif sur un fork de contribution sans transformer sa propre app en dépôt public. Le mainteneur décide de l'intégration ; un signalement ou une PR n'est pas une permission de fusionner ou déployer.

La matrice de compatibilité d'une release porte sur versions du cœur/contrats/modules, modèles, thèmes, plugins conversationnels et hébergements. Une mise à jour compare origine, personnalisations et version cible ; elle conserve les données et bloque les conflits non résolus. Fusionner une PR ne déploie pas toutes les apps. Sur Sites, l'adoption est demandée/exécutée dans GPT ; hors Sites, elle suit le parcours de livraison autorisé. Le registre conserve ensuite la version réellement déclarée et vérifiée de chaque déploiement.

## Recettes ajoutées au plan

1. App personnelle sans front spécifique ; équipe utilisant le workspace avec un opérateur incapable d'administrer le système ; front SaaS avec comptes natifs.
2. Installer un module commun puis un module spécifique : leurs vues apparaissent automatiquement dans les thèmes compatibles, avec droits et navigation corrects ; API utilisables depuis un front indépendant.
3. Même module sur Sites partagé et hors Sites avec ressources distinctes, sans branche métier spécifique ni runtime par client ; refus explicite d'une capacité indisponible.
4. Création par vrai fork et par copie sans GitHub, provenance et identités propres ; reprise d'une création partielle et rattachement ultérieur d'un dépôt.
5. Enregistrement central, token invalide/révoqué, annonce de version après livraison, panne/reprise sans perte métier et absence de données/secrets dans les déclarations.
6. Module valide accepté, exemples invalides bloqués localement et en CI ; installation de l'archive produite dans une app indépendante.
7. Correction proposée depuis une app, release amont puis mise à jour du dérivé conservant données/front/modules ; statut central actualisé seulement après réussite vérifiée.

Ces recettes complètent les deux Sites A/B et le parcours local → Cloudflare ; elles ne les remplacent pas. Aucune infrastructure centrale, tâche planifiée, issue ou PR n'est créée par cette spécification.
