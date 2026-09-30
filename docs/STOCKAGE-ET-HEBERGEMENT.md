# Développement local et publication de Creezio

Vérification documentaire du 26 septembre 2026. Ces parcours font partie du produit. La faisabilité des composants est documentée ; leur intégration dans Creezio reste à réaliser et tester.

## Parcours d'hébergement

| Parcours | Application | Données et fichiers | Accès |
|---|---|---|---|
| GPT Sites | Runtime du Site public, backend/back-office/front | Un couple D1/R2 natif partagé par application ; cloisonnement logique par contextes et droits | Compte Sites pour publier ; aucun compte GPT requis des visiteurs, connexion native Creezio pour les fonctions protégées. Aucune clé Cloudflare personnelle nécessaire. |
| Développement local Docker | Worker exécuté localement avec Miniflare/workerd | D1/R2 locaux persistants dans des volumes ; ressources distinctes possibles | Aucun compte Cloudflare nécessaire. Ce parcours sert au développement et aux tests. |
| Production Cloudflare | Backend, API, back-office et front sur Workers avec Static Assets | D1 et R2 dans le compte Cloudflare choisi | Connexion Cloudflare guidée, jeton avec droits nécessaires et identifiant de compte. |

Le parcours principal depuis Docker est **développer et tester localement, puis publier l'application entière avec ses données et ses fichiers sur Cloudflare**. La production ainsi publiée ne dépend plus du Docker local ; son arrêt ne doit pas interrompre le service.

L'accès depuis une application restant dans Docker à des D1/R2 Cloudflare demeure une possibilité distincte. Il ne constitue pas à lui seul le passage en production complet demandé et ne doit pas remplacer ce dernier dans la recette.

Le code métier, les modèles, les modules et les contrats restent communs. Les adaptateurs encapsulent les différences d'hébergement. Les clés et identités du compte de développement ne sont pas intégrées au code livré à chaque fork.

La même app peut fonctionner uniquement dans le workspace Creezio avec des rôles, avec un front thémé dynamique ou en headless, sur chaque hébergement. Un profil de capacités validé pilote les fonctions disponibles ; aucun module ne maintient une logique métier spéciale pour Sites. Le [cadre produit et communauté](CADRE-PRODUIT-ET-COMMUNAUTE.md) définit ce profil, les usages et le registre central. Enregistrement obligatoire à la publication officielle avec propriétaire GitHub/email vérifié ; développement local possible hors ligne. Ce registre ne reçoit ni les données métier ni les secrets fournisseurs.

Les éditions Community/Enterprise partagent les mêmes adaptateurs ; une licence premium ne rend pas disponible une capacité absente de l'hébergement. Leurs conditions sont cadrées dans [Licences et offres](LICENCES-ET-OFFRES.md). Le futur dérivé de recette sera le vrai fork public `Creez-io/Creezio-Lab`, créé après validation du socle ; sa destination est acquise, sa création reste à effectuer. Ses ressources et identifiants seront propres à son déploiement.

Le workspace utilise des panneaux React stables, avec localisation et état propres, séparés du routeur de chaque hébergement. Les modules n'importent aucun contexte privé Next/Vinext ; un éventuel pont interne reste dans l'adaptateur, avec contrôle de version. La résolution d'un import ou le succès du mode dev ne valide pas le comportement des onglets dans le Worker. Qualifier séparément les builds, l'hydratation et la conservation des vues sur les cibles sans réduire leurs fonctions.

Les profils de build Sites et Cloudflare direct partagent une source, un lockfile et l'authentification native Creezio. Leurs conventions de packaging, ressources et limites d'exécution restent distinctes. La planification est externe sur les deux cibles et utilise les mêmes API/MCP autorisés. La présence de D1/R2 sur les deux plateformes ne prouve pas l'équivalence de toutes leurs capacités. Qualifier une tranche fonctionnelle sur chaque cible avant de développer toutes les interfaces ; consulter [Qualification Sites](QUALIFICATION-SITES.md) pour les preuves et limites hébergées.

## Un couple D1/R2 par application Sites

Sur Sites, l'application utilise un seul D1 et un seul R2 fournis nativement. Les comptes et espaces partagent ces ressources ; leurs données sont cloisonnées logiquement par le contexte résolu côté serveur et les permissions de chaque opération. Les métadonnées D1 et les accès aux fichiers R2 suivent les mêmes contrôles. Un identifiant ou une clé de fichier transmis par le front ne suffit jamais à obtenir un accès.

Les deux Sites de recette, original et fork, ont chacun leur couple propre. Cette indépendance entre applications complète la vérification des droits entre contextes au sein d'une application. Le provisionnement de plusieurs D1/R2 natifs dans un même Site est hors périmètre ; il ne conditionne pas la construction du socle.

Hors Sites, les adaptateurs conservent la possibilité de choisir des ressources physiquement distinctes, en développement local et sur Cloudflare direct. Le contexte serveur sélectionne alors la ressource autorisée ; aucun état global mutable ne choisit la base pour toutes les requêtes. Ce mode ne crée pas d'instance applicative par client et ne nécessite pas un Docker permanent lorsque l'app est publiée sur Workers. Le provisioning, le raccordement, les quotas et le routage de plusieurs ressources demandent une recette réelle ; leur disponibilité n'est pas déduite du seul token Cloudflare.

Le résolveur Worker sélectionne un binding autorisé réellement présent dans la configuration déployée. Une nouvelle ressource nécessite sa création et son raccordement au Worker, pas seulement un identifiant dans une table. Wrangler permet plusieurs entrées D1/R2 dans un même Worker ; quotas et budget de métadonnées limitent cette composition. Ne pas annoncer un nombre illimité de clients ni confondre le nombre de bindings D1 avec autant de couples D1/R2. [Configuration Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/), [limites D1](https://developers.cloudflare.com/d1/platform/limits/).

## Sites publics et authentification native

Tous les Sites de la recette sont publics. Le visiteur atteint directement le front sans compte GPT, puis se connecte à Creezio pour les fonctions protégées. Creezio fournit ses propres comptes et sessions pour le front et l'administration, avec droits distincts. Une URL publique n'accorde pas l'accès aux données ni aux opérations d'administration.

Docker local et Cloudflare direct utilisent la même connexion native. Une identité ChatGPT ou ses en-têtes ne créent jamais automatiquement un compte, une session ni des permissions Creezio. Les API/MCP et webhooks conservent leurs autorisations ou signatures propres ; l'ouverture publique du Site ne désactive pas leurs contrôles.

Pour les opérations API/MCP, le contrat accepte une session utilisateur ou une identité machine autorisée selon le canal ; aucun cookie navigateur n'est exigé d'un client machine. Ses tokens sont limités aux opérations et contextes accordés, expirables, révocables et auditables. Les mêmes permissions et validations humaines s'appliquent : une automatisation ne peut approuver implicitement une action qui exige une décision humaine. Les signatures des webhooks suivent leur contrat distinct.

## Planification externe et état natif

n8n ou un autre service déjà hébergé planifie les appels à Creezio. Le socle expose nativement ses opérations par token API ou MCP ; il n'est pas nécessaire d'installer le module n8n pour recevoir ces appels. Le module n8n permet de piloter et d'intégrer le service n8n depuis Creezio, avec des accès fournisseur distincts des tokens entrants Creezio.

Les tâches, la boîte d'envoi, la progression et les résultats restent stockés dans Creezio. Chaque appel autorisé effectue un traitement borné ; un nouvel appel externe peut reprendre la suite ou transmettre un résultat. Les traitements longs restent dans le service externe. Les contrôles de concurrence et d'idempotence empêchent de répéter un effet ; un résultat incertain est réconcilié avant nouvelle tentative. Aucun poller, daemon ou scheduler central n'est ajouté au runtime, et la disponibilité de cron/queues Sites n'est pas un prérequis du socle.

## Module OpenAI et chat natif

Le chat est alimenté par un module OpenAI activé et configuré avec une clé API conservée côté serveur. Les appels au LLM passent par ce module ; l'UI, les conversations persistantes, les droits et les widgets restent natifs Creezio. Les thèmes et le navigateur ne reçoivent pas la clé. Le compte GPT utilisé pour publier n'est pas un accès implicite au LLM. La recette des Sites publics et des autres hébergements vérifie une vraie réponse, les appels d'outils et les erreurs de configuration ; sans clé valide, l'absence de réponse LLM est explicite.

## SQL central de création et d'évolution

Décision acquise : l'outillage central génère et inspecte le SQL de création et d'évolution à partir des modèles déclarés, le versionne avec la source et suit son application. Sur Sites, ces artefacts sont ceux du parcours Drizzle documenté, appliqués avant le code. Ils ne sont pas des scripts confiés aux modules. L'installation neuve et les mises à jour sont testées séparément ; aucune republication ne réinitialise les données. Une évolution incompatible ou destructive non résolue bloque la livraison. Revenir au code précédent ne réécrit pas l'historique SQL appliqué.

Les services tiers connectés par plugins, notamment n8n/Hermes/Meili, ne font pas partie des ressources à déployer. Creezio ne gère ni leur hébergement ni leur maintenance ; le compte utilisateur fournit les accès à un service existant.

## Projets officiels et capacités vérifiées

- [Miniflare dans cloudflare/workers-sdk](https://github.com/cloudflare/workers-sdk/tree/main/packages/miniflare) : exécution locale avec implémentations D1/R2 et persistance. Son rôle dans Creezio est le développement/test, conformément à la présentation officielle.
- [cloudflare/workerd](https://github.com/cloudflare/workerd) : runtime JavaScript/Wasm des Workers utilisé notamment par Miniflare.
- [Wrangler dans cloudflare/workers-sdk](https://github.com/cloudflare/workers-sdk/tree/main/packages/wrangler) : publication du Worker et gestion des ressources Cloudflare.
- [cloudflare/vinext](https://github.com/cloudflare/vinext) : prise en charge des applications React avec API Next.js et intégration Workers ; [adaptateur Cloudflare](https://github.com/cloudflare/vinext/tree/main/packages/cloudflare).

Cloudflare documente l'hébergement d'applications full-stack : code serveur Worker et ressources statiques du front sont publiés ensemble. D1/R2 sont raccordés au Worker par bindings natifs. Une production entièrement sur Cloudflare n'a donc pas besoin d'une passerelle HTTP supplémentaire simplement pour accéder à ses propres D1/R2.

Sources : [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), [applications full-stack](https://developers.cloudflare.com/workers/static-assets/routing/full-stack-application/), [Vinext](https://github.com/cloudflare/vinext).

## Action « Publier sur Cloudflare » depuis l'environnement local

Le back-office local propose un parcours guidé, traité par un exécuteur local de livraison. Il ne demande pas au développeur de recoder le déploiement dans chaque fork.

Avant toute application SQL ou publication en production, l'exécuteur valide l'enregistrement Creezio, le propriétaire vérifié et le token de cette installation ; les fonctions premium vérifient séparément leurs droits d'usage. Un échec conserve la préparation et l'app déjà publiée. Après vérification de la livraison, il déclare sa version et son URL au registre avec idempotence ; une erreur de déclaration reste visible et reprenable.

1. **Connecter le compte.** Renseigner un jeton Cloudflare adapté et choisir le compte cible. Vérifier les droits nécessaires à Workers, D1 et R2 ; ajouter ceux du domaine seulement si cette option est choisie. Les droits utiles à la création de ressources ne sont pas déduits de la seule présence d'une clé.
2. **Préparer la destination.** Définir l'identité de l'application et ses ressources propres ; afficher la destination et ce qui sera créé/utilisé. Un fork reçoit ses propres identifiants. Ne pas écraser une installation existante en réutilisant silencieusement un nom.
3. **Préparer une copie cohérente.** Stabiliser les écritures locales pendant la capture des données et fichiers. Inventorier les ressources, objets, tailles et empreintes ; conserver une trace de progression pour reprendre un transfert interrompu.
4. **Construire l'application.** Produire le Worker et les ressources du front/back-office depuis une révision précise et vérifier le build. Docker et les outils locaux ne sont pas envoyés comme runtime de production.
5. **Transférer D1.** Exporter les modèles et données de l'installation locale Creezio, puis les importer dans une base cible neuve prévue pour cette publication. Les commandes D1 officielles permettent l'export local et l'exécution/import distant. Vérifier relations, volumes et contenu ; adapter le découpage aux limites documentées.
6. **Transférer R2.** Lire les objets via les interfaces de stockage, envoyer les fichiers dans le bucket cible et conserver clés, métadonnées et références D1. Vérifier tailles et empreintes. Ne pas copier directement le répertoire interne Miniflare en supposant qu'il constitue un bucket Cloudflare.
7. **Configurer et publier.** Raccorder les bindings D1/R2 et les secrets de production, configurer les comptes et sessions natifs Creezio pour la destination, publier le Worker et ses assets. Démarrer sur une URL workers.dev, puis un domaine personnalisé si demandé.
8. **Vérifier la production.** Connexion, droits, onglets, chat, modules, lecture/écriture D1 et accès R2. Présenter l'URL, la version et le résultat. Arrêter le runtime local de test pour prouver l'indépendance de la production.

L'application reste protégée pendant la préparation ; le compte rendu ne déclare pas une publication réussie tant que les vérifications finales ne passent pas. Un échec conserve les données locales et l'état du transfert pour reprendre sans dupliquer les ressources ni effacer la destination.

### Données, identités et secrets à transférer

Le manifeste de publication distingue données applicatives, fichiers, paramètres et états transitoires. Préserver les identifiants internes et les relations ; exclure sessions actives, codes OAuth, consentements/jetons liés à un environnement, travaux de démonstration et exécutions en cours non transférables. Une copie SQL brute de toutes les tables n'est pas une politique suffisante. La recette vérifie chaque catégorie exclue ou transférée.

Les utilisateurs gardent leur identité interne Creezio ; les paramètres de session de production sont propres à la destination. Ne pas rattacher automatiquement des comptes par adresse email ou identité ChatGPT ni accepter en production des en-têtes d'identité de développement. L'administrateur de production utilise un parcours d'activation contrôlé ; aucune identité de démonstration ne devient propriétaire par défaut.

Le coffre peut contenir des secrets chiffrés avec une clé locale : copier seulement ses lignes ne suffit pas. Prévoir sélection des connexions à transférer et rechiffrement avec une clé propre à la destination, ou saisie guidée des accès de production. Ne pas copier indistinctement les accès de test. Les clés de chiffrement restent hors du dump applicatif. Les accès Cloudflare permettant de publier restent dans l'exécuteur local et ne deviennent pas des secrets utilisables par le Worker de l'application.

Le transfert R2 vérifie clé, taille, empreinte du contenu et métadonnées ; un ETag n'est pas supposé être universellement une empreinte du contenu. Le journal de reprise identifie source, destination et capture cohérente. Une ressource cible non vide inattendue provoque un arrêt explicite ; reprendre n'autorise pas à remplacer ses données. La gestion des échecs entre D1, R2, secrets et code n'est pas une transaction unique.

Le transfert D1 prévoit un export logique des tables métier déclarées dans les modèles, par lots bornés, et la reconstruction des index dérivés à destination. Le dump global Wrangler n'est pas une garantie suffisante : Cloudflare documente une incompatibilité d'export avec les tables virtuelles FTS5. Ne jamais supprimer une table source pour réussir un export. Qualifier les volumes, limites de requêtes/import, clés étrangères, valeurs binaires, cohérence de la capture et reprise avant de déclarer ce parcours prêt. [Export D1](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

Le transfert R2 parcourt un inventaire paginé et conserve les métadonnées HTTP et personnalisées. Les commandes Wrangler objet par objet ne couvrent pas tous les volumes : au-delà de leur limite documentée de 315 MB, employer un transport adapté. Prévoir S3 multipart pour les transferts volumineux, avec journal des parties et contrôle final du contenu. Les credentials S3 R2 sont distincts d'une simple session OAuth Wrangler et doivent être qualifiés. L'exécuteur fixe explicitement chemins de persistance Miniflare, configuration et environnement afin de lire l'installation réellement utilisée. [Commandes R2](https://developers.cloudflare.com/r2/reference/wrangler-commands/), [multipart R2](https://developers.cloudflare.com/r2/objects/multipart-objects/).

Figer une chaîne Wrangler/Vinext/Node compatible et ses dépendances ; vérifier poids, mémoire, démarrage et routage assets/API sur les deux profils. La chaîne ne dépend pas d'un Wrangler global ou de l'installation d'un autre projet. La réutilisation temporaire d'un outil déjà présent pour qualification ne remplace pas le lockfile autonome de Creezio.

Ce mécanisme copie une installation Creezio vers son hébergement de production. Il ne transforme pas un autre modèle de données et n'ajoute aucun script de transformation entre versions dans les modules.

## Première publication et mises à jour

La première publication comprend explicitement application, données et fichiers de cette installation. Une publication de code seule ne copie pas automatiquement le contenu D1/R2 : le parcours Creezio doit orchestrer ces opérations séparées.

Une fois la production utilisée, elle devient la référence pour ses données. Une mise à jour de code conserve les données de production et ne réimporte pas aveuglément le jeu local de développement. Les personnalisations du fork, la configuration et les accès restent propres à l'application. Toute incompatibilité détectée bloque la mise à jour automatique.

Pour la topologie T33 hors Sites, le parcours en qualification traite le couple principal et chaque couple D1/R2 actif comme des unités physiques distinctes. La capture locale est tenue sous un verrou d'export commun ; l'import distant vérifie les données, objets et reçus du plan SQL central par cible. Les routes copiées restent en `deny` jusqu'à la preuve de la version Worker publiée, de tous ses bindings et de la déclaration au registre. La mise à jour ferme les routes concernées avant SQL et publication, conserve les paires retenues, laisse les paires révoquées fermées et ne rouvre les autres qu'après inspection de leurs reçus. Un changement de D1 ou de bucket pour un contexte déjà actif exige un transfert explicite distinct. Voir [réalisation T33](IMPLEMENTATION-T33.md).

Mettre à jour une seule extension change sa résolution et ses dépendances nécessaires, puis republie l'application complète. Cela ne remet pas les données à zéro et ne met pas à jour les services tiers. Le starter d'extension suit le même parcours pour sa démo ; le paquet distribuable reste distinct de cette installation.

Les commandes de déploiement s'exécutent dans l'environnement local ou un exécuteur explicitement configuré. Le Worker hébergé ne reçoit pas une chaîne de compilation ni un droit général d'auto-publication. Aucun pont de publication depuis le back-office GPT Sites n'est requis : Sites conserve le parcours demande utilisateur/tâche GPT, publication puis vérification.

Si l'application est conservée dans un hébergement Docker, le déclenchement de sa mise à jour depuis le back-office reste pris en charge par l'exécuteur de cet hébergement. Miniflare local n'est pas présenté comme sa distribution de production.

## Connexion à des données Cloudflare depuis Docker

Cette variante utilise les mêmes modèles et opérations, mais un transport différent des bindings Worker natifs :

- **D1** : la documentation recommande une API Worker authentifiée pour un trafic applicatif externe ; l'API REST Cloudflare convient surtout à l'administration. Le connecteur Creezio prend en charge le raccordement, sans intégration métier à refaire.
- **R2** : API compatible S3, endpoint du compte et identifiants adaptés ; configuration guidée et secrets côté serveur.

Sources : [D1 depuis une application externe](https://developers.cloudflare.com/d1/tutorials/build-an-api-to-access-d1/), [API R2](https://developers.cloudflare.com/r2/api/), [authentification R2](https://developers.cloudflare.com/r2/api/tokens/).

## Recette requise

- Profils produit : même application personnelle ou collective entièrement utilisable dans le workspace sans front spécifique sur les cibles ; opérateur sans gestion système, front dynamique facultatif et refus explicite d'une capacité absente. Aucun changement de logique métier selon l'hébergeur.
- Ressources physiques distinctes hors Sites : même module sur deux D1/R2 autorisés derrière un backend commun, en local puis sur Cloudflare direct. Vérifier raccordement, isolation, concurrence, quotas, révocation et absence de repli silencieux ; Sites conserve son stockage partagé.
- Enregistrement : local hors ligne, propriétaire GitHub/email vérifié et token requis avant publication officielle ; panne du registre avant publication préservant l'installation existante ; annonce de la version réellement publiée et reprise d'une déclaration échouée.
- GPT Sites original et véritable fork : deux Sites publics, démarrage avec un couple D1/R2 natif propre à chacun, interfaces et mise à jour via GPT. Cloisonnement logique entre contextes vérifié dans chaque application, sans bases supplémentaires.
- Local : démarrage sans clé Cloudflare, données persistantes après redémarrage du conteneur et fonctions métier identiques.
- Cloudflare direct : application originale puis fork publiables avec identités propres ; backend, back-office et front réellement servis par Workers.
- Passage local → Cloudflare : données, relations, fichiers et métadonnées vérifiés, accès de production configurés ; interruption/reprise contrôlée et aucune altération de l'installation locale.
- Indépendance : production fonctionnelle après arrêt de Docker local.
- Mise à jour : créer aussi des données directement en production, publier une évolution du code, vérifier qu'elles sont conservées ainsi que les personnalisations du fork.
- Sécurité fonctionnelle : clés invalides, permissions insuffisantes, ressources déjà existantes, URLs de fichiers privées et absence de fuite entre applications ou contextes d'un même D1/R2. Le mode à ressources distinctes hors Sites est vérifié séparément.
- Identités/secrets : sur les Sites publics, accès au front et connexion native Creezio sans compte GPT, puis refus des opérations non autorisées. Sessions locales inutilisables en production, coffre lisible avec la clé de destination et absence d'accès de publication dans le Worker.
- Chat : module OpenAI activé, clé API serveur configurée, réponse réelle et appel d'outil autorisé raccordés aux conversations/widgets natifs ; comportement explicite si clé absente ou invalide.
- Workspace : mêmes interactions sur les cibles, deux fiches d'un module conservant chacune brouillon/scroll/historique, transitions interrompues et changement de query sans mélange, portails inactifs neutralisés. Mutation depuis widget ou client externe visible sans effacement silencieux d'un brouillon ; révocation et changement de session purgent les caches. Cette compatibilité avec Vinext et le build Worker reste à vérifier.
- Automatisation externe : un n8n existant planifie une action Creezio, exécutée navigateur fermé via token API ou MCP, sans module n8n installé dans Creezio. Le résultat ou callback reste consultable après reconnexion. Vérifier refus de mauvais token, portée/contexte non autorisés, révocation et rejeu non autorisé ; une reprise autorisée ne produit aucun effet en double et ne contourne pas une validation humaine.

## Capacités Sites restant à qualifier

- Appels machine sur le Site public : la sonde HMAC signée, le rejeu et le refus d'un corps altéré sont vérifiés sans accès GPT. Les tokens API avec opérations/contextes autorisés, le MCP/OAuth complet, les événements Stripe/n8n réels et l'appel planifié depuis le service externe restent à éprouver. Cette recette porte sur les contrats et intégrations applicatifs ; elle ne recherche pas de scheduler natif Sites.
- Sessions natives sur le Site public : cookies, bearer applicatif et révocation sont désormais vérifiés par la sonde publique sans jeton Sites. Le parcours navigateur avec comptes complets, cache et expiration reste à éprouver ; aucun compte GPT nécessaire. Conserver séparément les résultats privés initiaux et publics actuels.
- Matérialisation et évolution des modèles : un ajout SQL généré conservant les données D1/R2 a été qualifié sur la sonde ; la chaîne du produit, les mises à jour de modules et la reprise après échec restent à éprouver. La chaîne SQL centrale est acceptée ; aucun script SQL de transformation n'est confié aux modules.
- Progression du chat sur le Site public : vrai échange OpenAI avec appel d'outil réussi en secret serveur ; regroupement SSE confirmé dans le navigateur. La sonde de lecture concurrente d'événements persistés en D1 réussit avant la fin de l'appel. Intégrer ce transport dans le chat, avec écritures groupées, curseur, droits, annulation et reprise ; ce test borné ne valide pas encore le module complet ni une exécution après fermeture du navigateur. Voir [Qualification Sites](QUALIFICATION-SITES.md).

Les résultats et limites sont détaillés dans [Qualification Sites](QUALIFICATION-SITES.md). Les mesures privées conservées décrivent leur contexte d'origine ; seules les nouvelles mesures publiques servent à qualifier le parcours désormais retenu. Les points restants donnent lieu à des résultats mesurés, pas à des fonctionnalités présumées disponibles. Les identifiants de déploiement ne sont jamais codés dans le starter générique.

## Sources de transfert et publication

- [Déploiement full-stack](https://developers.cloudflare.com/workers/static-assets/get-started/) : code Worker, assets et URL de publication.
- [Commandes D1](https://developers.cloudflare.com/d1/wrangler-commands/) : export local, import/exécution distant et destination de persistance locale.
- [Import/export D1](https://developers.cloudflare.com/d1/best-practices/import-export-data/) : modalités et limites de copie des données.
- [Commandes R2](https://developers.cloudflare.com/r2/reference/wrangler-commands/) : lecture/écriture des objets locaux et distants.
- [Données locales](https://developers.cloudflare.com/workers/local-development/local-data/) : persistance des ressources de développement.

État du parcours Cloudflare personnel : les ports T32 et le raccordement T33 multi-paires ont des tests locaux ciblés, y compris reprise d'ACK inconnus et isolation D1/R2 Miniflare. L'inventaire local persistant et le changement de schéma local T33 restent en finalisation ; la revue indépendante et la recette réelle demeurent nécessaires. Aucun déploiement ni transfert de l'application T33 vers Cloudflare n'a été réalisé. Voir [réalisation T32](IMPLEMENTATION-T32.md) et [réalisation T33](IMPLEMENTATION-T33.md). Les sondes Sites publiées et leurs preuves réelles sont consignées dans Qualification Sites.

## Qualification des accès de publication

Un jeton actif ne prouve pas les droits de déployer l'application complète. Vérifier séparément compte cible, Workers Scripts, D1 et Workers R2 Storage en lecture/écriture, puis Zone/Workers Routes/DNS si le parcours utilise un domaine personnalisé. La lecture d'une liste ne qualifie pas une écriture ; le contrôle des politiques et la recette autorisée de publication restent distincts. Ne pas modifier les permissions ou créer un jeton implicitement pour faire réussir un test. [Permissions Cloudflare](https://developers.cloudflare.com/fundamentals/api/reference/permissions/).

Les identifiants du protocole S3 R2 ne sont pas un bearer OAuth Wrangler. Ils peuvent toutefois être obtenus à partir d'un **jeton R2 disposant des droits appropriés** selon la procédure Cloudflare (identifiant du jeton et dérivation de son secret) ; ne pas exiger systématiquement un second jeton si l'accès fourni permet déjà le parcours. Vérifier droits d'administration des buckets et droits objet selon le besoin, sans conserver ces dérivés en clair. [Authentification R2](https://developers.cloudflare.com/r2/api/tokens/).
