# Standard des modules Creezio

La documentation installée suit le même artefact verrouillé que le module : README, PRD et changelog sont capturés lors de la construction, puis lus par les opérations communes autorisées. Les documents de développement, le journal local d'installation et le PRD de travail restent distincts. Les limites et la qualification de cette lecture sont précisées dans [T12](IMPLEMENTATION-T12.md).

Ce document définit le contrat des modules natifs, communs, propres à une application et distribués par un éditeur tiers. Il s'applique à leur conception, à leurs sources, à leurs paquets et à leur validation. Le runtime, le SDK, les générateurs et les contrôles qui le feront respecter restent à construire et à qualifier ; la présence de ce contrat ne prouve pas leur fonctionnement.

Lire également la [matrice des capacités](MATRICE-CAPACITES.md), les [extensions et thèmes](EXTENSIONS-THEMES-ECOSYSTEME.md), la [compatibilité ChatGPT](COMPATIBILITE-CHATGPT.md) et le [standard de développement](DEVELOPMENT-STANDARD.md). Les exigences et leur avancement sont suivis dans [EXIGENCES.md](EXIGENCES.md), [USER-STORIES.md](USER-STORIES.md) et [TODO.md](TODO.md), sans créer une seconde numérotation dans chaque guide.

## 1. Une fonctionnalité complète, plusieurs surfaces

Un module possède ses modèles éventuels, ses opérations, ses droits, ses événements, sa recherche, ses écrans et ses relations publiques avec d'autres modules. Il reste utilisable sans conversation. Sa partie **plugin conversationnel** expose les opérations autorisées sous forme d'outils MCP, de ressources, de widgets et de skills ; elle ne constitue ni un second backend ni un second stockage.

Le même contrat s'applique aux emplacements suivants :

| Emplacement | Responsabilité |
|---|---|
| `extensions/native/` | Capacités natives livrées avec Creezio. Leur découpage ne les rend pas facultatives dans la recette de parité. |
| `extensions/common/` | Modules communs installables et versionnés individuellement, dont les connecteurs externes. |
| `extensions/connectors/` | Connecteurs communs optionnels vers des services externes ; même contrat et mêmes suites. |
| `application/extensions/` | Modules appartenant à l'application dérivée. |
| Paquet d'un éditeur tiers | Même contrat, avec éditeur, origine, version, dépendances et intégrité vérifiables. |

Un module n'impose pas un Worker, un conteneur ou une base physique supplémentaire. L'application assemble les modules sélectionnés dans son déploiement commun. Une démo d'éditeur peut être une application distincte, mais elle ne devient pas une dépendance du paquet consommé.

Une catégorie privée peut déclarer `linkedRead` pour rendre un fichier accessible à un lecteur authentifié d'un enregistrement publié. Cette capacité exige SDK 1.3 ou ultérieur (version actuellement candidate), un modèle de lien et une relation parent du même module/contexte, un état parent déclaré et une permission de lecture couvrant fichier, métadonnées, lien et parent. Toutes les colonnes de métadonnées restent protégées. La catégorie conserve ses permissions de propriétaire ; `linkedRead` n'autorise ni upload, ni abandon, ni lecture privée ordinaire. L'hôte vérifie le lien et l'état avant/après R2 ; le front appelle `downloadLinked` et libère ses URL objet. Ne pas contourner cette politique par `public:true`, un changement de propriétaire ou une URL durable. Voir [le client et le contrat de fichiers](../sdk/files/README.md) et [T25](IMPLEMENTATION-T25.md).

Un connecteur reçoit les accès d'un service déjà disponible. Il fournit l'intégration prête à configurer ; Creezio n'installe, n'héberge, ne met à jour et ne sauvegarde pas le service fournisseur. La planification reste extérieure à Creezio : les opérations bornées et leurs reprises sont appelées par un client autorisé.

La première surface exécutable est `contracts.connectors` (facultatif), validée par `sdk/contracts/schemas/v1/connectors.schema.json`. Chaque déclaration appartient au module et nomme ses modèles privés de configuration/coffre, leurs champs, le mode `bearer` ou `api-key-header` et les ressources GET fixes autorisées. Le compilateur les enregistre automatiquement ; aucun import spécial du module n'est ajouté dans le Worker. Le handler utilise `context.connector` du SDK public, sélectionné par son effet fournisseur déclaré. Il ne reçoit ni clé déchiffrée ni client HTTP arbitraire. La configuration de clé expose seulement le port natif de scellement/révocation aux opérations prévues. Les paquets utilisent les imports `@creezio/sdk/*` publiés.

La CI des nouveaux modules Support, Pages, Analytics, Catalogue et n8n assemble leurs véritables archives runtime/validation avec le SDK empaqueté, puis y exécute les six suites. Le générateur relit uniquement le manifeste propre livré ; il ne dépend pas du dossier d'un autre module. Le compilateur SQL central est testé dans les intégrations du socle, sans devenir un import privé des suites distribuées. `scripts/modules/validate-archives.mjs` réalise ce contrôle sur le code approuvé du dépôt ; il ne constitue pas une sandbox pour une extension tierce inconnue.

Cette surface GET ne prétend pas couvrir toutes les API externes. Ajouter une mutation ou un callback exige son contrat d'effet et ses tests, notamment résultat incertain, non-répétition et authentification fournisseur. Déclarer les limites du connecteur, sa disponibilité réelle et les suites non applicables ; ne jamais simuler un service tiers absent. Voir [T26](IMPLEMENTATION-T26.md).

## 2. Structure canonique des sources

```text
<module>/
  README.md
  AGENTS.md
  FILES.md
  prd.md
  interview.md
  TODO.md
  CHANGELOG.md
  gate.mjs
  module/
    manifest.json
    entry.server.ts
    models.ts
    files.ts
    operations.ts
    permissions.ts
    events.ts
    settings.ts
    search.ts
  ui/
    contributions.ts
    workspace/
    front/
    styles.css
  plugin/
    plugin.json
    mcp.json
    contributions.ts
    widgets/
    skills/
  ci/
    backend.mjs
    ui.mjs
    api-mcp.mjs
    widgets.mjs
    package.mjs
    docs.mjs
  tests/
    backend/
    ui/
    api-mcp/
    widgets/
    package/
    docs/
```

Les contrats doivent pouvoir déclarer explicitement l'absence de modèles, de fichiers, de vue front ou de widget quand la fonctionnalité n'en nécessite pas. Les six entrées de validation restent présentes ; une suite non applicable exige un motif vérifiable accepté par la politique commune. Un dossier vide ou un script retournant systématiquement un succès ne constitue pas cette justification.

Les noms ci-dessus fixent les responsabilités et les points d'entrée à construire. Le SDK versionné définira les schémas exacts, les exports TypeScript et les commandes exécutables ; aucune commande de ces futurs scripts n'est réputée disponible du seul fait de cette arborescence.

## 3. Manifeste et contrats métier

Le manifeste porte au minimum :

- Une identité stable incluant l'éditeur et l'origine, une version, la révision source, les licences applicables et les compatibilités du SDK, du cœur et des dépendances.
- Les points d'entrée runtime et UI, les contributions de workspace/front, la partie plugin, les modèles et les contrats publics fournis ou consommés.
- Les opérations, permissions, événements, réglages, ressources de fichiers et projections de recherche déclarés par les fichiers du module.
- Les capacités d'hébergement requises, les services externes éventuels et les états de configuration nécessaires.
- Les documents de la version livrée et les références de validation, avec distinction entre contenu runtime et contenu de développement.
- Les dépendances obligatoires ou facultatives et leur compatibilité, la sélection des contributions et les règles de désactivation.

Le SDK vérifie cohérence et unicité des identités, résolution des dépendances, fermeture des références et absence de collisions. Un paquet portant le même nom avec une autre origine ne remplace pas silencieusement le module installé. Les contraintes d'édition/activation sont séparées de l'identité du paquet et des droits métier ; elles ne créent pas de capacités absentes de l'hébergement.

| Fichier | Contrat à couvrir |
|---|---|
| `models.ts` | Modèles actuels, types, contraintes, relations, index, contexte, règles de suppression, champs calculés et champs protégés. |
| `files.ts` | Catégories de fichiers, métadonnées, tailles/types admis, propriétaire et contexte, accès, attachement et suppression cohérents. |
| `operations.ts` | Entrées/sorties typées, validation, effets, erreurs, pagination, concurrence, idempotence, approbation humaine éventuelle et audit. |
| `permissions.ts` | Acteurs, rôles, portées et contextes autorisés, refus par défaut et contrôles à l'exécution ainsi qu'au commit. |
| `events.ts` | Événements versionnés, tâches/outbox, état et progression durables, callbacks, annulation, reprises et effets idempotents. |
| `settings.ts` | Réglages typés, valeurs publiques/privées, références de secrets, validation des accès et diagnostic sans divulgation. |
| `search.ts` | Champs et projections, index dérivés, droits sur résultats/compteurs/facettes, invalidation et reprise bornée. |

Une relation entre modules utilise une identité d'objet et une opération ou un contrat public versionné. Elle ne dépend pas des tables internes, du composant React privé ou d'un identifiant de démonstration d'un autre module. Les cas de dépendance absente, incompatible ou désactivée sont explicites ; les règles de suppression préservent la cohérence des références.

## 4. Données et exécution

Le contexte de données est résolu côté serveur à partir de l'identité autorisée. Un contexte fourni dans une requête reste une demande à vérifier, jamais une preuve de droit. Les lectures, mutations, fichiers, recherches, exports, compteurs et résultats de widgets appliquent les mêmes frontières.

Une catégorie de fichiers possède un `metadataModel` privé dans son module. Son `storageFields` associe explicitement `id`, `objectKey`, `digest`, `byteSize`, `contentType`, `filename`, `version`, `state`, `intentId` et `generation` aux colonnes canoniques, sans déduction par nom. Ces colonnes et `ownerField`/`contextField` sont distinctes, persistées, protégées et non nulles ; les tailles/versions sont entières, les autres valeurs sont des chaînes. La clé primaire est `[contextField, id]`, avec indices uniques `[contextField, intentId, generation]` et `[contextField, objectKey]`. Le digest contient 64 caractères hexadécimaux vérifiés à l'exécution ; `state` admet exactement `staging`, `staged`, `available`, `abandoned`, `deleted`. `ownerScope` peut valoir `principal` pour partager les fichiers d'un même principal entre audiences autorisées ; absent ou `principal-audience`, il conserve l'isolation historique. Le contexte, la catégorie et les permissions sont toujours vérifiés côté serveur, dans chaque audience ; changer le scope d'une catégorie déjà utilisée exige une évolution explicite des données, jamais un renommage implicite du propriétaire. La publication vérifiée rejoint le batch métier gardé. D1 et R2 restent deux ressources : une interruption conserve une intention consultable et une reprise explicite ; aucune transaction commune ni purge planifiée n'est implicite. La tranche initiale qualifie les lectures privées ; une déclaration publique ne les ouvre pas automatiquement.

L'impersonation est une identité d'exécution distincte : permission et opération déclarent explicitement `impersonated-user`, l'exposition déclare `impersonation`. Une session personnelle ou OAuth ne l'active pas implicitement. Le noyau conserve acteur réel/session source/sujet, contexte et audience exacts, puis intersecte le plafond consenti avec les droits actuels. Administration des accès, démarrage d'une autre impersonation et approbations humaines sont refusés sous ce credential. Les widgets utilisent cette même identité et les mêmes refus ; ils ne substituent jamais le token de la session administrative. Les adaptateurs et interfaces doivent être qualifiés séparément des contrats ; voir [T-04](IMPLEMENTATION-T04.md).

Sur Sites, une application utilise son couple D1/R2 partagé avec cloisonnement logique. Hors Sites, un adaptateur peut résoudre des ressources physiques distinctes selon les capacités de l'hôte. Ce choix ne change ni les modèles ni les opérations métier, et ne multiplie pas les applications.

Le module déclare ses modèles actuels. La chaîne centrale génère et inspecte le SQL, le versionne et vérifie sa compatibilité avec les données avant publication. Le SQL appliqué est immuable. Il n'y a pas de script de transformation de bases fourni par chaque module. Une évolution incompatible ou destructive non résolue bloque la livraison ; désactiver ou mettre à jour un module ne réinitialise pas ses données.

Les traitements se terminent dans les bornes de l'hôte et conservent leur progression si plusieurs appels sont nécessaires. Un service externe planifie ou reprend les opérations autorisées. Le module ne crée ni scheduler central, ni poller interne, ni daemon. Le navigateur peut consulter l'état d'un traitement sans devenir son moteur d'exécution.

Les secrets restent côté serveur et les clients reçoivent des références ou états expurgés. Clé fournisseur, identité machine Creezio, consentement OAuth, token d'inscription et droit d'activation sont des objets distincts. Les bibliothèques et imports doivent être compatibles avec le build Worker ; un besoin de processus résident ou de système local passe par un service externe explicitement configuré.

## 5. Workspace, front et navigation

Le module déclare vues, routes, navigation, emplacements, titres, badges et permissions dans `ui/contributions.ts`. Le workspace Creezio et les thèmes compatibles les composent sans ajout manuel dans chaque application. Un front spécifique est facultatif ; une application headless peut utiliser les API ou le moteur de composition du SDK.

Une vue déclare son identité de panneau et peut référencer un `panel.stateSchema` canonique pour les petits états client à restaurer après rechargement. Seules les propriétés validées sont enregistrées dans la session du navigateur ; ne jamais y placer de secret. Les titres, sous-titres et fils d'Ariane dynamiques passent par les hooks publics de [métadonnées workspace](../sdk/workspace/metadata.tsx), les actions du bandeau par [le SDK de toolbar](../sdk/workspace/toolbar.tsx). Ces métadonnées de présentation ne donnent aucun droit et sont recalculées au montage. Une vue de module ne doit importer ni les composants privés `admin/`, ni un contexte interne de framework.

L'accès au workspace n'accorde pas l'administration système. Les vues métier et les réglages sensibles sont filtrés selon leurs droits ; le serveur reste l'autorité même si une entrée UI est cachée.

Les vues passent par le SDK de navigation. Elles n'importent pas de contexte privé Next/Vinext et ne dérivent pas l'objet d'un panneau inactif depuis l'URL globale. Identité, localisation, historique, activité et état du panneau sont distincts. Les tests couvrent onglets multiples, brouillons, scroll, focus, liens directs, transitions interrompues, réponses tardives, portails, mutation externe et révocation. Une vue inactive ne poursuit pas des effets interdits par son état d'activité.

Un thème personnalise le front, ses composants et sa présentation. Il ne remplace pas le chat ni les comportements standard du workspace Creezio et ne redéfinit pas les permissions métier. Retirer une contribution désactivée ne doit ni laisser un écran actionnable ni effacer les données qui pourront être réutilisées après réactivation.

## 6. Plugin, MCP, skills et widgets

Le plugin est une projection du module vers les conversations. Son manifeste, ses outils/ressources MCP, ses skills et ses widgets suivent le [contrat ChatGPT](COMPATIBILITE-CHATGPT.md). Les opérations restent exploitables sans widget ; l'absence d'UI dans un client ne rend pas les résultats inutilisables.

Décrire les unités et conventions des données dans les `description` de leurs champs JSON Schema, notamment quand un entier représente un montant en unité mineure. Ces annotations restent distinctes des titres affichés à l'utilisateur. Le cœur peut projeter un résumé borné des descriptions de sortie vers le fournisseur du chat ; MCP conserve le schéma de sortie. Aucune unité, devise ou conversion n'est déduite d'un nom de champ, et une annotation ne garantit pas à elle seule l'exactitude de la réponse du modèle.

Les contributions précisent leur audience : MCP/plugin d'administration ou MCP/plugin applicatif. Il s'agit de catalogues et droits distincts dans le même backend, sans exposition administrative automatique. Un site public ne rend aucune opération protégée anonyme.

Les appels utilisent une session utilisateur, une identité machine ou une délégation OAuth vérifiée selon le canal. Les outils, le front et les widgets appellent le même exécuteur autorisé. Un jeton ne remplace pas une approbation humaine exigée et une identité GPT ne crée aucun droit Creezio.

Le module déclare une collection de widgets nommés/versionnés, avec plusieurs types et instances possibles. Chaque widget décrit son schéma, son rendu, ses actions, ses versions compatibles, son audience et les données strictement nécessaires. Chaque action possède un mode `message`, `context` ou `direct`, sa cible, son schéma, les capacités requises et son repli selon [INTERACTIONS-WIDGETS.md](INTERACTIONS-WIDGETS.md). Les modes peuvent coexister dans un même widget. La révision interactive, la version du contrat de widget et la version de l'objet métier sont distinctes. Les opérations métier effectivement appelées revalident côté serveur droits, contexte, état de l'objet, approbations et idempotence ; le contenu historique d'un message n'est pas une autorisation.

La recette couvre plusieurs plugins dans un chat, l'historique des widgets, les clics répétés, objets supprimés/périmés, module désactivé, changement de session, révocation, résultat trop volumineux et client sans UI. Une compatibilité ChatGPT annoncée exige une recette réelle dans ChatGPT ; un test local de manifeste seul ne la prouve pas.

Les skills conversationnels du module sont distincts des [skills de développement](../skills/README.md). Aucun skill n'étend de lui-même le mandat de publication, l'accès aux données ou les permissions de l'utilisateur.

## 7. Documentation persistante et versions

| Document du module | Responsabilité |
|---|---|
| `README.md` | Usage, installation/configuration, surfaces, dépendances, compatibilités et limites prouvées. |
| `prd.md` | Objectif et comportement de la version source, périmètre, parcours, critères d'acceptation et critères négatifs. |
| `interview.md` | Questions utiles, décisions, validations explicites et éléments encore ouverts ; aucune approbation déduite d'un silence. |
| `TODO.md` | Travail réel restant, dépendances, preuves attendues, état et liens vers les tâches centrales. |
| `CHANGELOG.md` | Changements de paquet, compatibilités et versions effectivement publiées ; intentions non livrées identifiées séparément. |
| `AGENTS.md` | Instructions locales, périmètre, invariants et liens vers la méthode commune ; aucun assouplissement silencieux des contrôles. |
| `FILES.md` | Cartographie utile des responsabilités et points d'entrée, entretenue lorsque la structure change. |

L'application doit rendre consultables les documents de la **version installée**, avec origine, version et révision, depuis les surfaces autorisées et leurs opérations API/MCP. Un texte amont plus récent ne remplace pas silencieusement le PRD ou le changelog de cette version.

Les travaux de spécification dans une installation sont des révisions persistantes rattachées au module, à l'installation, à la version de départ, à l'auteur, à l'état et aux preuves de validation. Une révision approuvée est immuable ; toute modification crée une nouvelle révision. La publication d'un document d'éditeur n'approuve pas une demande locale et une approbation locale ne publie pas le paquet de l'éditeur.

Le cycle associe clarification, PRD approuvé, tâches, réalisation autorisée, contrôles sur la révision concernée, recette humaine requise et livraison déclarée. Une tâche cochée ou une CI verte ne signifie pas que la version est installée. Les documents de travail sensibles restent réservés aux acteurs autorisés ; ils ne sont pas exposés par défaut au front ou au MCP applicatif.

L'historique d'installation est distinct du changelog du paquet : version et origine reçues, livraison concernée, date, résultat effectif et preuves. Il conserve échecs et reprises sans les convertir en succès. Les passages source → paquet → installation sont liés explicitement, sans synchronisation bidirectionnelle implicite des documents.

## 8. Six suites et un contrôle commun

`gate.mjs` compose les contrôles du module avec ceux du SDK approuvé. Les mêmes critères s'appliquent localement, en CI et à la livraison ; leur sélection dépend du profil et de l'impact contrôlé, pas de la seule déclaration de l'auteur.

| Suite | Preuves exigées selon les capacités du module |
|---|---|
| `backend` | Modèles, invariants, isolation, autorisations, atomicité bornée, concurrence, idempotence, reprises et refus d'actions invalides. |
| `ui` | Vues réelles, états de configuration, droits, navigation/panneaux, formulaires, clavier, erreurs et absence de régression du workspace. |
| `api-mcp` | Contrats entrée/sortie, découverte, audiences, pagination, appels sans navigateur, mauvaises identités/portées/contextes, révocation et approbations. |
| `widgets` | Plusieurs types d'un même module et plusieurs instances ; modes message/contexte/direct et capacités/replis ; versions, absence d'UI, objets périmés, clics répétés, contexte obsolète, module indisponible, droits au clic et absence de fuite. |
| `package` | Archive produite, intégrité/origine, fermeture des références, dépendances, assets UI/widgets, imports Worker, installation, mise à jour ciblée et désactivation conservant les données. |
| `docs` | Documents requis, liens, schémas déclarés, cohérence versions/contrats, décisions et critères traçables, absence de secret et statut de preuve honnête. |

Les cas négatifs sont obligatoires : un module valide doit être accepté et un module invalide doit être rejeté pour la bonne raison. Un contrôle absent, vide, non exécuté, ignoré ou fondé sur une autre révision ne vaut pas validation. Les justifications de non-applicabilité sont contrôlées et conservées avec les résultats.

Les tests ne sont pas embarqués dans le Worker de production et n'imposent pas un Worker par module ou par test. Les recettes qui demandent un hôte ou un fournisseur réel restent explicitement non vérifiées tant que les accès et l'exécution manquent.

## 9. Paquet runtime et artefact de validation externe

La validation porte sur l'archive réellement distribuée, pas seulement sur le checkout de l'éditeur. Le paquet runtime contient les entrées `module/`, `ui/`, `plugin/`, les assets nécessaires et la documentation publique de version, notamment `README.md`, `prd.md` et `CHANGELOG.md`. Son manifeste publié ne conserve aucune référence de développement vers un fichier absent du paquet.

Les scripts CI, fixtures, tests et documents de travail peuvent être distribués dans un artefact de validation séparé. Cet artefact est lié de façon immuable à l'identité du paquet, sa version, sa révision source et son intégrité ; sa propre intégrité est vérifiée. Une URL pointant sur une branche mutable ne suffit pas.

Le SDK assemble les deux artefacts dans un environnement de validation isolé. Il vérifie la fermeture de **toutes** les références, y compris transitives : `gate.mjs`, `ci/`, `tests/`, `interview.md`, `TODO.md`, `AGENTS.md`, `FILES.md`, règles de gouvernance, skills, guides, scripts auxiliaires, gabarits GitHub/hooks, notices de changement et `CONTRIBUTING.md` lorsqu'ils sont référencés. Les entrées provenant du runtime, telles que `prd.md` et `CHANGELOG.md`, sont identifiées explicitement et proviennent du même paquet vérifié.

Une référence manquante ou inaccessible bloque la validation requise. L'éditeur peut restreindre l'accès à un artefact privé ; le parcours officiel doit alors disposer d'un accès autorisé, sans rendre publics ses documents de travail. Les références ne permettent ni sortie du périmètre assemblé ni récupération arbitraire non figée.

La politique fournie par un éditeur explique ses propres contrôles ; elle ne remplace pas la politique SDK approuvée de l'application consommatrice. Le code de test d'un tiers est exécuté sans secrets de production ni droits de publication. Les exemples, hooks ou workflows présents dans l'artefact ne sont jamais activés implicitement.

## 10. Installation et mise à jour

L'application verrouille version, origine, dépendances et intégrités. L'installation compose les contrats et les assets, vérifie modèles/droits/conflits et construit l'application. Une mise à jour individuelle de module sélectionne une nouvelle version compatible, puis reconstruit et republie l'application ; elle n'injecte pas du code exécutable distant à chaud dans le Worker.

La recette de mise à jour conserve front personnalisé, extensions propres, données, droits et provenance ; elle vérifie aussi refus d'incompatibilité, dépendance absente, retrait de contribution et désactivation sans effacement. Une montée de version du plugin Creezio n'actualise pas le service externe auquel il se connecte.

Le parcours de livraison respecte le [cycle Git](GIT-FLOW.md) et le [stockage/hébergement](STOCKAGE-ET-HEBERGEMENT.md). Sur Sites, publication dans GPT sur mandat ; depuis Docker local, exécuteur de livraison autorisé. L'artefact, le SQL applicable et les droits d'inscription sont vérifiés avant les modifications de production. Un retour au code précédent ne prétend pas annuler le SQL déjà appliqué.

## 11. Dépendances de toutes origines

Le [contrat des dépendances](DEPENDANCES-MODULES.md) est obligatoire. Le manifeste distingue required/optional, origine/version attendues, ports publics versionnés et contributions conditionnelles ; le verrou fixe la résolution transitive. Une dépendance npm ne suffit pas à enregistrer ou activer un module. Le cycle de vie contrôle les consommateurs directs/transitifs avant update, désactivation ou suppression, avec données préservées. Les six suites qualifient absence, incompatibilité, désactivation, intégration facultative et même opération par les différents canaux. Le starter et les AGENTS de chaque module renvoient à ce contrat.

Le point public d'écriture d'un handler est `sdk/operations/handler.ts` : il reçoit des lectures et plans bornés, pas une transaction SQL ni un credential. Le runtime compose les références statiques et conserve le commit. Un module tiers ne reçoit pas l'inventaire administratif réservé à l'implémentation native Modules. Les choix de cycle de vie ciblent les candidats vérifiés de l'hôte ; ils n'envoient pas de manifeste ou de code depuis le navigateur. Une nouvelle présence ou activation précise ses audiences sans attribuer de permission. Voir [la réalisation T-11](IMPLEMENTATION-T11.md) pour les contrôles disponibles et les qualifications encore ouvertes.

## Mutations de panneau et reprise

Les vues ciblant le SDK 1.2 utilisent l'export public `@creezio/sdk/operations/command-journal` pour suivre leurs mutations avec clé de demande. Déclarer les métadonnées `pending` dans le schéma de panneau et les conserver dans **chaque** sauvegarde de sélection ou d'onglet. La persistance synchrone doit réussir avant l'envoi. Les résultats inconnus et refus de lookup restent en attente ; seule l'inspection de statut est proposée, sans replay. Une erreur d'effacement local ne transforme pas le résultat serveur confirmé.

Lier l'état sauvegardé à la session native vérifiée, l'audience et le contexte. Ne pas le consommer pendant l'état anonyme ou non résolu de l'accès ; attendre l'hydratation puis restaurer uniquement le scope exact. Lors d'un vrai changement de scope, masquer immédiatement les anciennes données, invalider les réponses tardives et réinitialiser les états concernés. Un simple changement d'objet client ou l'inactivité d'un onglet ne doit pas perdre un brouillon. Tester restauration, refus de persistance, réponse incertaine, lecture de statut et changement de scope. La disponibilité de cet export dans une candidate source ne prouve pas sa présence dans une archive SDK antérieure.

## Thèmes de front T13

Un thème est distribué comme un module avec `contracts.ui.themes` : identifiant, codeRef et liste d’emplacements supportés. La composition choisit le module actif et son thème exact. Les vues/navigation/slots proviennent des modules actifs exposés à app et sont filtrés par la projection native ; aucune route métier n’est codée dans le thème. Les emplacements montent des vues à entrée vide et identité sans paramètres. Voir [le SDK front](../sdk/front/README.md). Les modules thèmes ont leurs six suites, même lorsqu’une suite vérifie explicitement l’absence d’API ou de widget.
