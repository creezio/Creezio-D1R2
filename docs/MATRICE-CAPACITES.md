# Creezio-D1R2 — capacités et critères de validation

Spécification du produit, proposée avant implémentation. Chaque capacité doit être vérifiée dans son environnement réel. Une intégration sans accès fournisseur reste identifiée comme non vérifiée.

## Traçabilité et état

Chaque ligne ci-dessous reste normative ; son détail complète les critères identifiés dans [EXIGENCES.md](EXIGENCES.md). Les tâches et preuves sont suivies exclusivement dans [TODO.md](TODO.md), les besoins dans [USER-STORIES.md](USER-STORIES.md). Aucune capacité produit n'est marquée validée par la seule présence de ce dossier.

| Capacités de cette matrice | Exigences / tâches de réalisation |
|---|---|
| Runtime, installation, limites | REQ-0301 à REQ-0303, REQ-0901 à REQ-0902 ; T-03, T-09 |
| Identités, accès, données, coffre, recherche, export | REQ-0401 à REQ-0603 ; T-04 à T-06 |
| Workspace, onglets, navigation et état | REQ-0701 à REQ-0703 ; T-07 |
| Fronts, thèmes, headless | REQ-1301 à REQ-1302 ; T-13 |
| Conversations, OpenAI, outils et widgets | REQ-1401 à REQ-1607 ; T-14 à T-16 |
| MCP, OAuth et accès machine | REQ-1001 à REQ-1003 ; T-10 |
| Modules, documentation embarquée et PRD révisionnés | REQ-1101 à REQ-1202 ; T-11, T-12 |
| Tâches, messagerie, support, CRM, pages, analytics, intentions, règles | REQ-1701 à REQ-2401 ; T-17 à T-24 |
| Catalogue et connecteurs | REQ-2501 à REQ-2902 ; T-25 à T-29 |
| Starter, paquets, artefacts de validation et tiers | REQ-3001 à REQ-3003 ; T-30 |
| Local, Cloudflare, transfert, multiressource | REQ-3101 à REQ-3301 ; T-31 à T-33 |
| Registre, éditions et accompagnement | REQ-0801 à REQ-0803, REQ-3401 à REQ-3501 ; T-08, T-34, T-35 |
| GitHub, AGENTS/skills, six CI par module et contrôle des contributions | REQ-0101 à REQ-0203 ; T-01, T-02 |
| Release, filiation, mises à jour et recette finale | REQ-3601 à REQ-3901 ; T-36 à T-39 |

Les intervalles regroupent des familles d'identifiants ; seuls les IDs explicitement définis dans EXIGENCES.md existent. Le [standard module](STANDARD-MODULE.md) et la [méthode de développement](DEVELOPMENT-STANDARD.md) s'appliquent transversalement, y compris aux modules natifs, privés et tiers.

## Socle serverless

Le [cadre produit et communauté](CADRE-PRODUIT-ET-COMMUNAUTE.md) fait partie de cette matrice. Creezio couvre l'app personnelle, l'équipe interne et le SaaS ; le workspace est utilisable selon les rôles, le front est facultatif et les fonctions d'administration système restent soumises à des droits propres.

| Domaine | Fonctionnalités | Preuve attendue |
|---|---|---|
| Installation | Configuration initiale, identité administrateur, modèles actuels et initialisation D1/R2. | Démarrage sur une base neuve depuis le dépôt ; republication sans perte de données. |
| Modes de stockage natifs | Sites : un couple D1/R2 natif partagé par application, cloisonnement logique par contextes et droits. Docker : D1/R2 locaux persistants sans compte Cloudflare ou connexion au compte Cloudflare de l'utilisateur, avec ressources distinctes possibles. | Même logique métier dans les trois modes ; isolation logique vérifiée sur Sites, volumes locaux résistant aux redémarrages et accès distants vérifiés. Voir [stockage et hébergement](STOCKAGE-ET-HEBERGEMENT.md). |
| Production Cloudflare | Depuis le local dev/test Miniflare, publier backend/API/back-office/front sur Workers avec assets, données sur D1 et fichiers sur R2. | Original et fork publiables avec identités propres, copie du contenu vérifiée, production fonctionnelle après arrêt du local ; mises à jour conservant les données de production. |
| Identités et accès | Front accessible sur un Site public, comptes et connexion natifs Creezio, fournisseurs d'identité configurés pour l'application, invitations, sessions, identités machine autorisées, rôles, droits par compte autorisé/interdit/hérité, impersonation auditée, séparation administration/application. | Session utilisateur ou identité machine selon le canal ; mêmes permissions, contextes, révocations et validations humaines. Refus cohérents UI/API/MCP/widget ; premier admin autorisé explicitement. Aucun compte GPT requis ni droit accordé par un email ou en-tête client. |
| Opérations | Entrées/sorties typées, validation, autorisations, idempotence, erreurs et audit. | Une même opération est utilisée par les différents canaux sans duplication métier. |
| Données | Entités, relations, index, vues, champs calculés/snapshots, règles de suppression, CRUD autorisé, export et contexte de données obligatoire. Sur Sites, les contextes partagent le même D1/R2 sans partager automatiquement leurs droits. | Isolation logique des lectures, mutations, recherches et fichiers, pagination, champs protégés même contre CRUD admin, garde d'accès au commit et mutations atomiques bornées. |
| Fichiers | Stockage R2, métadonnées D1, pièces jointes et accès privés. | Création, lecture et suppression autorisées ; pas de fuite entre utilisateurs ou espaces. |
| Modules | Registre, catalogue, éditeur/origine, dépendances, versions, compatibilité, activation/désactivation, configuration et diagnostic. | Paquet installé sans recoder l'intégration, mise à jour ciblée, désactivation conservant données et historique ; origine homonyme refusée. |
| API et MCP | Capacités natives : opérations/ressources et schémas complets, tokens limités à un acteur et aux opérations/contextes autorisés ; MCP 2026-07-28 et compatibilité stateless des clients 2025 retenus ; OAuth/PKCE S256, découverte, consentement, enregistrement, rotation, révocation et audit. | Appel JSON sans cookie ni navigateur, sans module n8n ; clients réels, validation entrée/sortie, pagination sans JSON tronqué ; refus de jeton/portée/contexte invalides et après révocation. Même exécuteur que l'UI, aucune session fabriquée pour un accès machine. |
| Conversations | UI du chat, messages, pièces jointes, flux de réponse, modes Chat/Work, outils, traces et persistance natifs. Le module OpenAI activé et configuré fournit le LLM. | Persistance, reprise, progression dans le navigateur, annulation, droits et appels d'outils vérifiés avec une vraie réponse OpenAI ; clé API côté serveur, schémas valides et résultats complets ou paginés. |
| Widgets | Schéma versionné, révision interactive et version de l'objet distinctes, rendu déclaré, données validées, actions utilisant les opérations serveur. | Droits au clic, objets périmés/supprimés, clics répétés, historique et module désactivé gérés. |
| Compatibilité ChatGPT | Outils MCP, UI MCP Apps, skills et paquet de plugin standard issus des déclarations du module ; OAuth délégué pour données protégées. | Même objet D1/fichier R2 utilisé depuis Creezio et un vrai widget ChatGPT, skill exercé, autorisations/révocation et mise à jour du paquet vérifiées. Voir [contrat ChatGPT](COMPATIBILITE-CHATGPT.md). |
| Événements | Tâches, boîte d'envoi et progression durables ; traitements bornés, idempotence, coordination des appels concurrents, expiration et annulation. Planification et appels de reprise assurés par un service externe. | Navigateur fermé, un appel externe autorisé exécute ou reprend une opération et laisse un résultat consultable ; aucun scheduler, poller ou daemon interne requis. |
| Recherche | Listes/recherche natives, projections, filtres de droits ; moteurs externes optionnels. | Utilisable sans Meili ; droits avant résultats/compteurs/facettes, indexation externe bornée et reprenable. |
| Secrets | Références opaques, coffre chiffré, configuration serveur et publication vers un environnement indépendant. | Aucun secret dans front/Git/logs ; transfert sélectif et rechiffrement vérifiés, sessions et autorisations transitoires exclues. |
| Entrées publiques | Contrat distinct des sessions, signatures, corps brut, âge, périmètre, idempotence et correspondance test/production. | Appels réels Stripe/n8n/MCP sur le Site public sans session de navigateur ; signatures et autorisations applicatives contrôlées. |
| Diagnostics | Audit, erreurs, état des connexions et versions. | Traces corrélées et résultats réels, sans annoncer un succès avant vérification. |
| Profils d'usage | Personnel, équipe dans le workspace, front thémé facultatif ou headless ; mêmes modèles et opérations. | App sans front spécifique pleinement utilisable ; opérateur du workspace interdit de gestion système ; front personnalisé consommant les mêmes opérations. |
| Composition UI | Vues, routes, navigation, emplacements, composants et permissions déclarés par les modules. | Module ajouté dans les thèmes officiels sans recoder l'app ; désactivation retirant les entrées sans perte de données ; headless libre ou adoptant le moteur de composition. |
| Création et provenance | Fork GitHub réel si accès disponibles, copie d'une release sans GitHub ou dépôt indépendant privé, versions/origine conservées. | Droits de création vérifiés, reprise sans doublon, identité propre au fork et rattachement ultérieur d'un dépôt ; aucune filiation GitHub inventée. |
| Registre central | Projet/déploiement, propriétaire vérifié GitHub/email, token de déclaration, URL, dépôt éventuel et versions datées ; inscription obligatoire à la publication officielle, local hors ligne. | Métadonnées vérifiées selon accès, tokens distincts, panne/reprise et état de synchronisation, absence de données métier/secrets ; installations existantes fonctionnelles pendant la panne. |
| Développement assisté | Skills de développement, SDK, contrats versionnés et contrôles communs local/CI/livraison. | Module valide accepté et exemples invalides bloqués ; archive réellement installable ; aucun contournement des contrôles dans le parcours officiel. |
| Éditions et activation | Politiques versionnées Community/Enterprise, usages personnels/interne/SaaS et fonctions activées par droits signés ; tarifs/licence/éligibilité SaaS différés. | Deux politiques de test autorisent puis réservent le SaaS au premium sans changer le métier ; activation UI/API/MCP, refus de faux droit ou mauvaise installation, expiration/panne sans suppression de données ; payer n'ouvre pas le multi-D1 Sites. Voir [licences et offres](LICENCES-ET-OFFRES.md). |
| Accompagnement | Intervention sur un dépôt/copie sélectionné avec accord, droits limités, durée, journal et révocation. | Inscription/abonnement sans accès implicite ; lecture, branche/PR et déploiement traités comme mandats distincts ; aucun secret ou code privé publié automatiquement. |
| Contribution | Diagnostic expurgé, issue/PR autorisée, revue, test de non-régression, release compatible et adoption par chaque app. | Correction amont appliquée au dérivé sans perte des personnalisations/données ; version du déploiement déclarée après vérification, sans déploiement client automatique. |

Tous les Sites de la recette sont **publics**. Le visiteur accède directement au front sans compte GPT, puis utilise la connexion native Creezio pour les fonctions protégées. L'audience publique ne rend publics ni les données ni l'administration. Les Sites A et B ont chacun leur propre couple D1/R2 ; à l'intérieur de chaque application, les utilisateurs et espaces partagent ce couple avec des droits et contextes contrôlés côté serveur. Il n'y a pas de qualification multi-D1/R2 à mener sur Sites. Les entrées machine et capacités d'hébergement sont qualifiées dans [Qualification Sites](QUALIFICATION-SITES.md).

La recette active le **module OpenAI** et configure sa clé API côté serveur. L'interface, les conversations et les widgets restent natifs Creezio ; le module réalise les appels au LLM. Une clé absente ou invalide produit un état explicite sans réponse simulée. Le compte GPT utilisé pour publier le Site n'alimente pas automatiquement le LLM de l'application.

**Preuve actuelle limitée :** deux appels réels OpenAI Responses ont réussi depuis la sonde Sites, demande forcée de l'outil `qualification_bindings` puis réponse en mode stream, avec clé en secret d'environnement côté serveur. Le regroupement SSE est confirmé dans le navigateur. Une sonde d'événements persistés en D1 consultés pendant l'appel réussit, fournissant une alternative de transport sans scheduler. Le module Creezio complet, les chats admin/front, les widgets, l'annulation et la reprise restent à implémenter et tester. Voir [Qualification Sites](QUALIFICATION-SITES.md).

**Décision acquise : la planification est externe.** n8n ou un autre service déjà hébergé programme les appels aux API/MCP natifs de Creezio, même sans navigateur ouvert. Ces appels ne nécessitent pas le module n8n, qui sert au pilotage et à l'intégration de n8n depuis Creezio. Le socle conserve tâches, boîte d'envoi, progression et résultats ; il traite chaque appel de façon bornée et reprend sur un nouvel appel autorisé. Aucun scheduler, poller ou daemon central n'est ajouté, et aucune qualification cron/queue Sites n'est requise pour le socle.

Chaque appel API/MCP utilise une session utilisateur ou une identité machine autorisée selon son contrat. Le serveur résout les opérations et contextes permis, vérifie révocation et droits, puis applique les mêmes validations humaines que dans l'interface et recontrôle à l'écriture. Le champ `authInfo` du SDK MCP contient une identité déjà vérifiée ; il ne valide aucun bearer à la place de Creezio. Ne jamais fabriquer une session navigateur à partir d'un jeton machine. Un token d'automatisation ne contourne pas une approbation requise. Il est distinct de la clé API utilisée par Creezio pour accéder à n8n ou OpenAI et du secret d'un client OAuth ; les webhooks signés conservent leur propre contrat.

Le profil MCP borné utilise les interfaces Web Request/Response et des réponses JSON structurées ; aucun SSE permanent ni magasin de sessions de transport n'est requis. Qualifier métadonnées/en-têtes, origine lorsqu'elle est présente, limites de corps/résultat, schémas découvrables et pagination. Pour OAuth : découverte de ressource/serveur, issuer et audience, PKCE S256, redirections validées, code consommé atomiquement et renouvellement/révocation. Prévoir Client ID Metadata Documents et préinscription, avec DCR pour les clients qui en ont besoin ; les credentials MCP n8n proposent encore DCR par défaut ou un client préinscrit. Tester la version réelle du nœud MCP Client et séparément le sous-nœud MCP Client Tool s'il est utilisé. Ce sont des recettes d'implémentation, pas des décisions utilisateur en attente.

La recette programme dans un n8n existant une action Creezio, ferme le navigateur et vérifie l'exécution ainsi que le résultat ou callback consultable après reconnexion. Elle vérifie aussi le refus d'un mauvais token, d'une portée ou d'un contexte non autorisés, d'un accès révoqué et d'un rejeu non autorisé ; une reprise idempotente autorisée ne répète aucun effet. Ce parcours entrant fonctionne sans installer le module n8n dans Creezio.

## Administration standardisée Creezio

Le back-office conserve une identité et des comportements communs à toutes les applications. Les modules y ajoutent leurs surfaces prévues par contrat. Les personnalisations du front ne remplacent ni le workspace ni le chat administrateur.

| Surface | Fonctionnalités à vérifier |
|---|---|
| Onglets | Ouverture, activation, fermeture, dashboard épinglé, verrouillage, navigation depuis un onglet protégé, réorganisation et gestion des doublons. |
| Navigation | Historique par onglet, précédent/suivant, URL/paramètres, liens directs, sidebar, titres, métadonnées, fil d'Ariane, badges et notifications vers onglets. |
| État des vues | Conservation formulaires/scroll/focus, restauration, invalidation après mutation, transitions interrompues, portails et panneaux inactifs ; nettoyage à la déconnexion. Qualifier le routeur avec les versions figées du framework. |
| Panneaux et routeur hôte | Vues de modules montées dans des panneaux React stables ; identité, objet, localisation et historique propres au panneau. SDK sans contextes privés Next/Vinext ; routeur hôte limité à URL/liens directs/hydratation. Vérifier deux objets du même module, query seule, cible froide, réponses tardives, navigation interrompue, widget et révocation en navigateur et build Worker ; compatibilité non encore validée. |
| Disposition | Panneaux, modes plein écran, commandes, adaptation aux tailles d'écran et interactions définies dans la spécification détaillée. |
| Chat administrateur | Conversations, Chat/Work, modèle/effort, voix selon fournisseur, fichiers, streaming, annulation, traces, demandes de précision, validation de spécification et recette humaine ; contexte réservé aux acteurs autorisés. |
| Administration des données | Modèles, relations, vues, recherche, édition autorisée, export et journal des accès. |
| Configuration | Comptes, droits, ressources D1/R2, modules, connexions, navigation administrable avec remise à zéro, API/MCP et onboarding reprenable. |
| Modules | Installation, configuration guidée, vérification des accès et écrans d'utilisation ; états absent, non configuré, disponible, indisponible et interdit. |
| Exploitation | État de l'application, événements, journaux, versions, diagnostic, export d'observabilité et support. |

## Capacités fonctionnelles natives

Ces capacités sont fournies d'origine et peuvent être organisées en modules natifs. L'externalisation de leur moteur ou de leur transport ne retire pas leurs données, écrans ou interactions du produit.

| Capacité | Fonctions et preuve attendue |
|---|---|
| Tâches et travail | Kanban, tâches humaines, demandes, exécutions, journaux, quotas, validation, annulation et consultation après reconnexion. Les tâches humaines fonctionnent sans exécuteur externe. |
| Messagerie | Boîtes, composition/brouillons, pièces jointes, HTML sûr, état d'envoi, reprises et réception. Brouillons consultables sans transport ; envoi/réception réellement vérifiés avec un transport configuré. |
| Support et CRM | Tickets, échanges, statuts, prospects, vues et droits. Parcours complets sans dépendance à un moteur d'agents. |
| Présentation et navigation | Éditeur landing, sections/media/SEO, navigation configurable et variantes résolues. Les pages ne sont pas réduites à un texte codé en dur. |
| Analytics et observabilité | Usage, productivité, tableaux de bord, audit et erreurs ; export externe facultatif. |
| Intentions et développement | Intentions, spécifications, clarifications, validation de travail, suivi des modules et artefacts ; la génération/exécution de code utilise un service externe configuré. |
| Automatisations | Règles, événements, déduplication, journal et état de reprise natifs. n8n ou un service externe planifie les appels API/MCP ; Creezio exécute les opérations autorisées et conserve leurs résultats, sans ordonnanceur interne. |

## Front libre et thèmes

- Front de départ immédiatement utilisable, facultatif et entièrement remplaçable ; le workspace à rôles peut être l'interface unique de l'application.
- Bibliothèque de composants : navigation, formulaires, listes, panneaux, pièces jointes, chat et widgets.
- Thème standard et thème ChatGPT-like, avec personnalisation propre à l'application.
- Chat applicatif utilisant les services communs avec ses propres conversations et droits.
- Changement de thème sans altérer données, autorisations ou administration.
- Pages de présentation, onboarding, paramètres et parcours apportés par les modules.
- SDK headless : un front indépendant consomme les mêmes API sans importer le back-office.
- Personnalisations séparées du thème parent, préservées lors de sa mise à jour.
- Conversations : brouillons, recherche, renommage, archivage/restauration, pièces jointes, panneaux et liens profonds. Parcours guidés avec pause, correction, reprise et historique ; cache séparé par acteur/surface/espace.

Les widgets sont multiples par module et par conversation. Leurs actions déclarent demande au chat, contexte du prochain tour ou traitement direct ; vérifier les trois modes dans le chat Creezio et ChatGPT, capacités absentes, contextes révisés/retirés, réponses tardives et autorisations. Voir [INTERACTIONS-WIDGETS.md](INTERACTIONS-WIDGETS.md).

## Extensions et services prêts à configurer

Chaque extension fournit les modèles utiles, ses opérations, API/MCP, droits, événements, écrans, widgets et diagnostics selon son périmètre. Les accès sont configurés côté serveur. Le service externe reste indépendant du runtime Creezio. Les fonctions natives décrites plus haut restent présentes même si un fournisseur n'est pas configuré.

Modules natifs, modules métier communs et modules spécifiques respectent ce même contrat. Une extension métier autonome ne requiert aucun fournisseur : la configuration d'accès externes concerne seulement les modules connecteurs. Les contributions UI déclarées rejoignent automatiquement les surfaces et thèmes compatibles selon les droits.

Les services tiers sont obtenus et administrés hors de Creezio. Les modules n8n/Hermes/Meili ne fournissent aucun hébergement, installateur, mise à jour ou gestion de sauvegarde de ces applications : ils reçoivent les accès d'un service existant. Leur propre mise à jour concerne uniquement l'intégration Creezio.

| Module | Fonctions livrées | Validation réelle |
|---|---|---|
| n8n | Pilotage du service n8n depuis Creezio : URL/clé, workflows autorisés, déclenchement selon leur type, exécutions, résultats, erreurs, événements et widgets de suivi. | Configurer les accès, exécuter un workflow de test et consulter son résultat sans changer le code de l'app. Les appels entrants n8n → API/MCP Creezio fonctionnent aussi sans ce module. |
| Stripe | Accès test/production, clients, catalogue/prix, sessions de paiement, abonnements, webhooks signés et suivi idempotent. | Paiement de test, réception d'événement et état consultable par API/MCP/widget. |
| Meili | Connexion, index et projections déclarés par les modules, synchronisation, reconstruction, recherche et filtres de droits. | Indexer, rechercher, modifier et retirer un objet sans fuite entre contextes. |
| Hermes | Connexion, capacités, soumission, progression, résultat, validation humaine et annulation/reprise selon protocole. | Exécution externe réelle, progression persistée et retour au chat autorisé. |
| OpenAI | Module activé pour le chat, clé API serveur, adaptateur Responses, modèles autorisés, événements typés, appels d'outils, annulation et diagnostics raccordés aux conversations/widgets natifs. | Réponse réelle dans le chat admin/front, progression navigateur mesurée, outil autorisé puis widget et outil interdit refusé ; schémas fournisseur validés, collisions de noms détectées, sorties bornées/paginées, limites d'exécution et état final après interruption. Clé absente du navigateur/Git/logs, erreur de configuration explicite. |
| Autres fournisseurs IA et voix | Fournisseurs, modèles, streaming, appels d'outils et capacités vocales configurées, selon le même contrat. | Réponse réelle et exécution d'outil contrôlée ; état explicite si fournisseur absent. |
| Catalogue | Produits, catégories, fichiers, droits, opérations, recherche déclarative et widgets. | Parcours CRUD, fichiers et actions du chat via la même logique métier. |
| Transports de messagerie | Connexion d'un fournisseur HTTP ou d'une passerelle existante, envoi/réception, accusés et webhooks raccordés aux boîtes et à l'outbox natives. | Envoi vers un destinataire de test autorisé, réception, réconciliation et reprise sans simulation. |
| Navigateur | Sessions, profils, navigation, actions et visualisation via service externe ; relais du navigateur utilisateur comme capacité distincte. | Transport réel, droits et cycle de vie des sessions vérifiés. |
| Granola | Notes, transcriptions, dossiers, réception signée, déduplication, synchronisation et consultation. | Compte fournisseur connecté et parcours réel vérifié. |
| Agents de développement | Projets et modèles autorisés, demandes, exécutions, journaux, artefacts, annulation et outils MCP. | Service externe connecté, aucun lancement de processus dans le socle. |
| Exécution de développement | Génération, vérifications, journaux et artefacts par exécuteur externe, raccordés aux intentions/spécifications et suivis natifs. | Code produit puis validé hors du runtime, livré par le parcours de l'hébergement. |
| Export d'observabilité | Export et analyse complémentaire via services configurés ; diagnostics et analytics natifs restent autonomes. | Événement corrélé exporté sans secrets. |
| Desktop et infrastructure | Client desktop, commandes autorisées, état des ressources et outils externes optionnels. | Protocole authentifié, capacités annoncées vérifiées, aucune dépendance du démarrage web. |
| Démonstrations | Parcours et jeux de données explicitement identifiés par module. | Une démo ne remplace pas la preuve d'une intégration avec un service réel. |
| Livraison locale | Déclenchement administrateur depuis Docker dev/test, préparation, publication Workers/assets/D1/R2 et vérification. | Production indépendante du local, interruption récupérable et mises à jour conservant les données distantes. Variante de mise à jour Docker traitée par son exécuteur dédié. |

## Communauté et développement d'extensions

Chaque extension est un module complet avec données, API, logique et relations intermodules. Sa partie plugin conversationnel adopte le format standard GPT même sans publication dans ChatGPT. Le chat Creezio héberge plusieurs de ces plugins. Chaque application sépare son MCP d'administration du MCP destiné aux utilisateurs métier, dans le workspace ou dans le front, avec outils, ressources, skills et politiques distincts dans le même déploiement. Vérifier les deux catalogues, le refus d'accès administratif depuis le front, les widgets de plusieurs plugins dans une même conversation, une opération entre modules et le même plugin utilisable sans publication GPT. Désactiver cette exposition ne supprime ni les données, ni les écrans et API du module. Voir [le contrat ChatGPT](COMPATIBILITE-CHATGPT.md).

Voir [le dossier écosystème](EXTENSIONS-THEMES-ECOSYSTEME.md). Livrer SDK, manifeste validé, documentation, catalogue et starter de module utilisable par fork. Le starter contient modèles, API, outils MCP, permissions, écran admin, vue front et widget ; il produit un paquet installable et une démo du même code publiable sur Cloudflare.

La recette exige une extension créée sans modifier les fichiers internes du CMS, sa démo en ligne, puis le même paquet installé dans le fork. Mettre à jour ce paquet seul et un thème séparément, vérifier les versions non concernées, les données et les personnalisations. Une incompatibilité ou origine inattendue bloque la livraison. GitHub, registre de paquets et catalogue ont des responsabilités distinctes.

L'[architecture Community/Enterprise](LICENCES-ET-OFFRES.md) prépare éditions, activation et accompagnement ; licence, tarifs et éligibilité des SaaS restent à décider. Le LICENSE actuel reste applicable au contenu qu'il couvre. Le premier vrai fork public sera `Creez-io/Creezio-Lab`, après validation du socle ; aucun fork créé. Une app ou extension privée peut vivre dans un dépôt indépendant avec origine et versions, sans être présentée comme un fork GitHub privé du dépôt public. Données, secrets et audience d'un Site restent indépendants de la visibilité des sources.

## Installation et mises à jour

Les modèles décrivent les données actuelles du produit. L'installation initialise les structures nécessaires sur une base neuve. Les modules ne contiennent pas de scripts de transformation de bases entre versions. Une mise à jour conserve les données présentes et bloque une incompatibilité détectée.

La génération et la gestion **centralisées** des artefacts SQL sont acceptées. Les modèles actuels des modules alimentent cette génération ; les modules ne livrent aucun script SQL de transformation entre versions. Le SQL central et ses métadonnées sont inspectés avant publication ; les fichiers déjà appliqués et leur journal sont immuables. Sur Sites, le SQL est appliqué avant l'envoi du Worker : une publication échouée peut avoir déjà modifié le schéma. La recette vérifie la reprise et la compatibilité avec le code encore publié ; revenir au code précédent n'annule ni ce SQL ni les données modifiées. Une mise à jour de module cible sa version, mais reconstruit et republie la livraison Worker complète.

| Hébergement | Déclenchement | Preuve |
|---|---|---|
| GPT Sites | Demande de l'utilisateur dans GPT, ou tâche GPT explicitement planifiée. Préparation, publication puis vérification dans ce parcours. | Deux Sites publics : original puis véritable fork ; connexion native Creezio, un couple D1/R2 par application et module OpenAI configuré. Mise à jour du fork préservant son front, ses modules et ses données. Aucun bouton de publication Sites dans Creezio. |
| Docker | Demande dans le back-office, traitée par le module de livraison et un exécuteur limité à l'application. | Déploiement effectif, contrôle de santé, conservation des personnalisations et procédure de reprise vérifiée. |
| Cloudflare direct | Demande depuis le back-office local, exécution de la publication complète par l'outillage local et vérification de l'URL distante. | Worker/assets, D1/R2 transférés, accès vérifiés, production indépendante de Miniflare ; reprise après interruption. |

Aucune tâche GPT n'est créée par cette spécification. Les versions, accès et identités de déploiement restent propres à chaque application.

## Suivi de validation

Chaque capacité recevra une spécification détaillée, ses tests, ses dépendances et ses preuves. Statuts : spécifié, implémenté, testé localement, testé dans l'hébergement cible, accès fournisseur manquant, point à résoudre. À la rédaction, aucun runtime Creezio-D1R2 n'est implémenté.
