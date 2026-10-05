# Changelog

## Cycle des extensions — candidat du 5 octobre 2026

- Le gestionnaire exporte les choix et empreintes du plan accepté depuis le journal Product Hub. Le plan reste en attente tant que le runtime publié ne correspond pas à sa cible.
- La commande `modules:apply` recalcule ce plan puis applique les paquets, l'inventaire et la composition au checkout sous journal avec retour arrière en cas d'échec. Les dépendances npm existantes restent verrouillées ; aucune publication ni modification D1 n'est déclenchée par cette commande.
- L'inventaire admet la première installation d'un paquet externe avec identité et origine explicites, archives vérifiées et origine autorisée. Une mise à jour conserve cette identité et exige une version supérieure.
- Les compositions refusent les collisions de noms npm entre modules. Les cycles sont évalués sur les modules actifs ; une intégration facultative absente conserve le comportement autonome de son module.
- Désactiver un module installé conserve les définitions de ses droits pour les rôles existants, sans réactiver ses opérations ni ses interfaces. Cela évite qu'un droit devenu inconnu bloque aussi l'administration des autres modules.

## Grandes réponses des widgets — 3 octobre 2026

- Le pont du chat conserve le widget d'une grande page CRM après relecture autorisée de l'exécution et vérification de son empreinte. Le modèle reçoit uniquement un marqueur court lorsque la carte est enregistrée ; les plafonds du contexte restent inchangés.
- Sans widget admissible, le refus de résultat trop volumineux reste explicite. Les anciennes opérations en attente restent compatibles ; aucun schéma D1, contrat métier ni composant d'interface ne change. La recette hébergée reste distincte des tests locaux.

## Correctif candidat T16 — focus du lien après revalidation clavier

- Un Tab avant quittant l'iframe vers la confirmation hôte déclenche toujours la relecture d'accès. Si la même proposition HTTPS revient après vérification de la session, du principal, du contexte, de l'instance et du catalogue, le focus revient sur sa nouvelle ancre ; Entrée reste nécessaire pour l'ouvrir.
- Un autre geste pendant la lecture, une révocation, un retour externe ou une autre proposition ne restaure pas ce focus. Aucun contrat métier, droit, URL ou export du SDK public ne change ; la recette hébergée reste distincte des contrôles locaux.

## Refus de provisionnement Cloudflare — 2 octobre 2026

- Les refus structurés de création D1/R2 sont distingués des réponses perdues lorsque l'absence de la ressource est confirmée. Le journal conserve les codes numériques et toute D1 déjà créée ; l'opérateur reçoit un code de refus propre à la ressource.
- Une inspection indisponible ou une ressource apparue conserve un résultat inconnu. Aucune seconde création, suppression ou publication n'est déclenchée automatiquement. Ce diagnostic ne prétend pas mesurer les quotas disponibles.

## Guides de contribution et de diagnostic — 2 octobre 2026

- Les missions explicitent leur exigence, résultat attendu, sources réutilisables et condition de fin. Les revues distinguent défaut de conformité et amélioration facultative ; les critères produit, l'interface Creezio originale et les reports utilisateur restent inchangés.
- Le guide de recette demande une étape et une erreur exploitable avant tout nouvel essai ; le parcours clavier exige l'observation du focus. Les anciennes notes d'AGENTS sont séparées de l'état courant du TODO. Les contrôleurs, la CI et les contrats runtime ne sont pas modifiés.

## Livraisons et recettes ciblées — 2 octobre 2026

- PR #100 est intégrée sur `d7e117a` après CI candidate et main, chacune à 1 513/1 513 tests. La même source applicative est livrée sur Linux, Cloudflare et Original domix v6 ; les registres sont synchronisés et les données témoins conservées. La relecture navigateur Original retrouve le même fil, brouillon, réponse et fichier après rechargement, sans nouveau tour.
- CRM : déplacement et édition du prospect témoin dans le kanban, puis restauration de son contenu métier, qualifiés sur Original. Pages : image privée publiée dans deux sections, lecture anonyme exacte et anciennes références refusées. Ces recettes ne ferment pas les autres critères des modules, le parcours clavier du widget ou la validation utilisateur T39.

## Correctif candidat T16 — confirmation de lien au clavier après revalidation

- Une proposition `app.openLink` affichée dans le panneau est conservée brièvement en mémoire lorsque Tab depuis l'iframe déclenche une relecture d'accès. Elle ne revient qu'après vérification de la même session, du principal, du contexte, de l'instance et du catalogue ; un nouveau geste explicite reste nécessaire pour ouvrir le lien.
- Fermeture ou changement de conversation, révocation et ressource incompatible annulent cette reprise, même si le démontage du widget arrive après la fermeture. Les contrôles ciblés et un reproducteur Chromium sans réseau passent ; la recette sur l'application hébergée reste ouverte. Le paquet SDK public et les contrats MCP ne changent pas.

## Correctif candidat T16 — restauration du fil après rechargement

- Le contrôleur Conversations reprend les lectures de messages et de brouillon interrompues après l’affichage du titre, sous l’accès courant ; une sélection manuelle plus récente conserve la priorité. Le panneau attend cette restauration pour lister les pièces jointes.
- Le test de régression et les six suites du module passent localement. La livraison et la recette navigateur sur Original restent ouvertes ; aucun tour ni appel fournisseur n’est rejoué par le correctif.

## Correctif candidat T16/T33 — consultation sans droit OpenAI

- Les refus 403 des lectures facultatives de configuration et modèles OpenAI ne vident plus les onglets du workspace. La disponibilité du fournisseur retourne un état sans détails après vérification de la session et du contexte ; l'historique Conversations, le brouillon et les fichiers restent lisibles sous leurs propres droits.
- Le transport OpenAI et les nouveaux tours restent interdits sans le droit `creezio.openai:use`. Les erreurs de session et les refus Conversations conservent la revalidation globale ; tests ciblés acquis, recette navigateur après livraison ouverte.

## Tranche candidate T27 — offres et achat app

- Le module Stripe 0.5 ajoute des offres administrées, une vue front dynamique `/offers` et deux widgets pour consulter les offres et relire un Checkout. API, MCP app et interfaces utilisent les mêmes opérations, avec des droits distincts de Facturation.
- L'achat utilise le prix et le propriétaire déterminés par le serveur. Les sessions administratives historiques restent privées ; le retour du navigateur déclenche une lecture authentifiée et ne déclare jamais seul un paiement réussi.
- Le schéma central conserve les données antérieures et ajoute les rattachements facultatifs. Cette tranche ne dépend pas de Catalogue ; sa qualification et sa livraison restent ouvertes.
- Le chat natif raccorde la capacité standard MCP Apps d'ouverture de lien à une confirmation dans l'hôte. Les widgets n'ont besoin ni de dialogues ni de fenêtres surgissantes dans leur iframe ; le sandbox reste inchangé.
## Correctif candidat T33 — checkpoint de transfert routé

- Le journal accepte l'identité de capture routée uniquement avec `sourceContextId` et `routeFence` cohérents ; l'identité du couple principal reste exacte. Trois tests ciblés passent dans une image Linux isolée, dont capture/import/vérification et reprise sans second upload. L'entrée Docker `--application-root` vérifie une source applicative distincte et le même verrou de dépendances avant les proxys ; 12 tests locaux ciblés passent. La reprise du transfert Cloudflare b9 attend la qualification du déploiement opérateur/source séparés.

## Candidate Stripe 0.4.0 — maintien d'un abonnement avant son échéance

- Le connecteur permet de programmer ou de retirer l'arrêt en fin de période d'un abonnement TEST. La nouvelle opération `subscription.cancel.set` conserve le contrat `subscription.cancel.schedule` déjà distribué ; les droits administratifs et le journal commun restent applicables.
- L'écran Facturation reprend la même interface et propose l'action correspondant à l'état confirmé. Un abonnement déjà terminé ne devient pas réactivable. Le mode live, les changements de tarif et les parcours d'achat client restent distincts de cette tranche ; sa recette fournisseur n'est pas encore effectuée.
- Le suivi intègre les recettes hébergées récentes de Pages, CRM, Analytics et Meili ainsi que la conservation des témoins Linux T33. Les résultats de Core b9 restent liés à cette source et ne constituent pas une livraison de cette candidate.

## Core b9 — livraisons et recettes du 2 octobre 2026

Les correctifs de sandbox et de provenance ci-dessous sont intégrés par la PR #92 sur `b9a4562`, avec 1 490 tests et 33 commandes réussis en CI candidate puis main. Core b9 est livré sur Linux et Cloudflare ; Original Sites v7 utilise la source Site `3bd36bc`. Le rendu des deux images Catalogue Cloudflare, le canonical externe puis restauré sur Sites, les trois fiches CRM liées et le cycle Meili d'insertion/modification/retrait/reconstruction sont vérifiés dans leurs reçus propres. Les critères non exercés et les reports utilisateur restent suivis dans le TODO.

## Correctif candidat T25/T32 — sandbox du Worker mis à jour

- Les updates Cloudflare normal et routé journalisent et inspectent le sandbox des widgets avant de publier le Worker principal. La lignée remonte au reçu de première publication pour les updates historiques, et les reprises d'upload incertain n'émettent pas une seconde publication à l'aveugle.
- Le retry d'un artefact conservé vérifie aussi le sandbox exact avant son nouveau POST. Les phases publiques du SDK ne changent pas. Livraison et rendu Blob Cloudflare restent à qualifier.

## Correctif candidat T33 — provenance après déconnexion routée

- L'inspection d'installation reconnaît la mutation native `logout:` dans la lignée contiguë `local-install:`/`local-schema:`/`authority:`/`logout:`. Son identifiant utilise le digest de commande, le contexte et le slot, comme `authority:` ; elle doit être ouverte et ne change pas la dernière mutation structurelle.
- Un test ciblé confirme la provenance A/B après déconnexion routée officielle, puis le refus d'un digest altéré et d'une cible retargetée. Aucun bootstrap, DDL ou réparation live n'est déclenché ; livraison, CI et inspection T33 sur Linux restent à qualifier.

## Correctif du retour vers le front

- Les paramètres de retour Checkout sur la racine n'entraînent plus une fausse vue introuvable. Le front affiche son accueil neutre sans déduire un paiement des paramètres de l'URL.
- Le nouveau paiement Stripe TEST sur Core be89116 est confirmé, avec nouvel événement et projection des abonnements ; l'ancien webhook incertain conserve sa preuve distincte. La recette du retour corrigé attend sa livraison.

## Correctif T07/T22 — refus de l'aperçu de rétention

- L'ouverture de l'aperçu de rétention avec le seul droit de lecture Analytics renvoyait un 403 et fermait les onglets du workspace. La recette Sites confirme que session et projection restaient valides. Ce refus reste désormais dans le panneau concerné ; les commandes, les 401 et les refus de session conservent leur traitement.
- Les deux tests ciblés du garde et les CI candidate/main de la PR #90 passent. Original Sites v5 (`a2cf524`, Core `be89116`) conserve Support, Conversations et Analytique après l'alerte de droit `analytics.purge` ; le chat reste accessible, la session active et les deux clics précédents visibles. Aucun droit de gestion, activation de collecte ou purge n'est ajouté (`CREEZIO-T22-ORIGINAL-RETENTION-LOCAL-BE89116.json` hors dépôt).

## Correctif T15 — statut d'une réponse connue avant reprise du flux

- La reprise d'un tour possédant déjà un reçu OpenAI lit d'abord son statut : une réponse terminée peut être confirmée sans rouvrir un flux long. Une réponse encore active reprend le même flux ; aucune seconde création n'est émise.
- Le délai et l'annulation restent applicables avant et après la lecture. Un résultat arrivé après expiration, ou un reçu devenu indisponible, conserve l'état inconnu. Les six scénarios ciblés et les CI candidate/main de la PR #90 passent ; Core `be89116` est livré sur Linux, Cloudflare et Original Sites v5. Aucun nouveau tour hébergé ne qualifie encore cette reprise ; l'ancien tour Original n'est pas déclaré récupéré.

## 1er octobre 2026 — PR #90, livraisons Core et recettes Sites

- PR #89 est intégrée sur `8d723ce`, puis PR #90 sur `be89116` (arbre `793b9b8`) avec 1 472 tests dans chacune des CI candidate et main. Core `be89116` sert Linux sur le volume conservé, schéma prêt et zéro DDL ; Cloudflare a livré l'update `a0270e39`, registre synchronisé et témoins D1/R2 conservés. Original Sites v5 sert la source `a2cf524` liée à Core `be89116`, avec registre synchronisé. Ces livraisons restent distinctes des recettes métier ciblées.
- Lab Sites v4 sert le correctif widget depuis `7c6dc10` : lecture directe, contexte, message préparé et conservation après rechargement sont vérifiés ; l'API confirme la demande à 42,50 € et son fichier inchangés. Un premier mauvais choix d'outil par le modèle reste documenté. Sur Original Sites v4, l'index Meili est prêt révision 5 et la recherche native retrouve le produit à 42,50 € ; le widget Meili et le nouveau webhook Stripe restent ouverts.

## Correctif candidat T33 — provenance de l’installation conservée

- Après une adoption centrale de schéma sans DDL, l’inspection reconnaît les routes passées du journal d’installation au journal de schéma. Elle vérifie la chaîne complète par pages, les identités D1/R2 et le reçu courant ; un cutover fermé doit être repris par la commande de schéma.
- Huit tests ciblés passent et la revue indépendante est favorable. Sur le profil T33 isolé de source `8d723ce`, les témoins API/R2 A/B et la révocation A sont qualifiés ; après ces mutations de politique, `install.inspect` perd la provenance des deux routes malgré le schéma prêt. Le nouveau correctif candidat reconnaît la lignée `authority:` avec cinq tests Miniflare et un test négatif filtré, sans nouveau bootstrap ni DDL. Intégration, CI, inspection Linux corrigée et Cloudflare T33 restent ouvertes.

## Correctif candidat T09/T14/T16 — choix de l'alias widget dans le chat natif

- Sur Lab Sites version 3, un tour OpenAI réel a exécuté la lecture d'une demande, puis produit du texte sans widget. L'outbox montre que le modèle a choisi l'outil canonique `creezio.purchase-requests:request.get` plutôt que l'alias de rendu `purchase_request_get` ; le résultat d'outil a réussi. L'écart de montant dans la prose du modèle est un défaut distinct, sans preuve que la valeur retournée par l'outil était erronée.
- Le correctif candidat projette les alias de rendu admissibles avant leur opération canonique et garde cette dernière en repli si l'alias manque, est refusé, est incompatible ou dépasse le budget. La sélection reste soumise aux droits et au schéma existants ; elle ne change ni API, ni MCP, ni SDK, ni données. Le correctif Lab est intégré par la PR #15 sur main `7c6dc10`, après 1 283 tests dans chacune des CI candidate et main ; la livraison du chat natif reste à qualifier. Le candidat Core est réservé à l'intégration groupée avec T33.
- Le plugin ChatGPT du compte courant sur Lab Sites version 3 a affiché le widget de demande sous CSP et exercé lecture directe, préparation sans envoi et ajout/retrait du contexte. Cette recette ne qualifie pas le chat natif. Original Sites version 4 est publié depuis Core `2738bd0` et Site `a64331b`, avec registre synchronisé et CRM révision 3 conservé ; il ne contient pas ce correctif. Son ancien tour `59dd1fb8` reste `provider_unknown` et non résolu.

## 1er octobre 2026 — PR #86 intégrée et lectures fournisseur dans le chat

- PR #86 est intégrée sur `0b7ba2d73ab5ecde1110a3026f3e3e35f95d28b6` ; CI candidate et main : 1 465 tests et 33 commandes réussis. Les recettes Linux/Cloudflare des corrections décrites ci-dessous restent distinctes de cette qualification du code.
- La recherche Meili native est autorisée et fonctionne, mais ses outils étaient exclus de la projection du chat à cause de leur effet fournisseur déclaré. Le correctif en préparation conserve le moteur commun, les permissions courantes et les lectures GET déclarées et bornées. Aucune nouvelle UI, dépendance SDK ou écriture fournisseur n'est introduite ; le widget réel attend la livraison et sa recette.

## Correctif candidat — refus des lectures facultatives

- Un refus `forbidden` HTTP 403 des lectures facultatives Analytics et Sidebar reste local à cette lecture dans le workspace et le front. Il ne vide plus les onglets autorisés par une revalidation globale en boucle. Les refus de session, les autres refus d'opération et la révocation par une nouvelle projection conservent leurs contrôles. La recette Cloudflare ayant révélé la boucle reste distincte de la future vérification du correctif livré.

## Correctifs candidats — canonical SEO et coordination d'un test

- Le renderer public Pages accepte le canonical HTTP(S) externe déjà autorisé par le module, avec les mêmes refus et l'échappement HTML. Les titre, description, image et retour protégé sont vérifiés sur Linux ; la correction du canonical attend sa recette après livraison.
- Un test du moteur d'opérations observe maintenant une terminaison antérieure à l'entrée dans le handler et libère son attente même en cas d'échec. Les assertions d'annulation, de délai et d'absence d'écriture sont conservées ; le test ciblé passe 12/12. La cause précise du timeout de la CI `8e5d4a4` reste non établie, et cette ancienne CI n'est pas qualifiée.
- Le contrôleur qualité expose les durées les plus longues et prépare deux phases : treize fichiers dont l'isolation a été revue tournent deux par deux, le reste en série. Chaque phase conserve ses compteurs TAP et son résultat ; leur budget total reste de 900 secondes. Aucun test requis, contrôle runtime ou contrôle de provenance n'est retiré.

## Correctif candidat Docker — origines locales configurées

- Les ponts de l'application et de l'opérateur suivent les ports de la configuration locale, avec refus des collisions sur leurs ports réservés. Le sandbox conserve son port configuré et son mapping explicite dans Compose.
- Le propriétaire de l'installation T33 est confirmé sur son volume conservé et les trois D1 sont prêts. La recette HTTP de cette installation a révélé ce défaut de ports ; l'isolation métier et la publication Cloudflare restent à qualifier après livraison du correctif.

## Correctif candidat Stripe 0.3.1 — réception des événements signés

- Le compte de service webhook accède aux trois modèles métier déclarés nécessaires, sans recevoir de droit de lecture du coffre. L'hôte garde la vérification atomique des secrets et termine proprement une erreur de préparation des gardes.
- Le test positif traverse le pont signé jusqu'à la projection D1 ; les refus du jeton limité et les révocations restent vérifiés. Le paiement fictif distant de la version précédente est acquis, mais son webhook historique reste incertain ; la nouvelle version attend sa CI et sa recette après livraison.

## Collecte de clics — candidate Analytics et Catalogue

- Deux boutons existants déclarent des identifiants d'action statiques : Actualiser dans Analytics et ouverture d'une fiche du front Catalogue. Leur collecte reste conditionnée par la politique du contexte, sans contenu métier dans l'événement et sans modification du rendu.
- Catalogue 0.1.3 et les verrous des six compositions concernées sont préparés. Les tests ciblés passent ; la livraison et la recette navigateur de ces nouveaux clics restent ouvertes.

## Correctif d'installation — schémas comportant de nombreux modules

- Les contrôles de vacuité de l'installateur utilisent une conjonction équilibrée. Le profil connecteurs à 114 tables peut être inspecté et installer son premier compte dans D1 sans dépasser la profondeur d'expression du moteur ; les gardes atomiques de schéma, reçu et données sont conservées.
- Les cinq tests d'installation passent sur Linux avec le moteur réel, dont reprise après création du schéma, refus du rejeu et conservation des données étrangères. Cela ne constitue pas encore la recette des ressources T33 réelles ni leur publication Cloudflare.
## 1er octobre 2026 — SDK 1.9 public et Core 9ce856c livré

- PR #84 est intégrée sur `9ce856cb1cbb2f9fa576c5fae0f7b4be09488cb9` ; les CI de la candidate et de main passent 1 454 tests sans omission. Le SDK [1.9.0 public](https://github.com/creezio/Creezio-D1R2/releases/download/sdk-v1.9.0/creezio-sdk-1.9.0.tgz) correspond à cette source : archive SHA-256 `b10cc8ca47bad85d3f22124e0b3da214cea15610330fc650a8c107cba189eb2a`, 88 108 octets, 93 fichiers. Douze consommateurs ont passé 296 tests dans 72 suites, dont quatre déclarées non applicables.
- La même source est active sur Linux et Cloudflare. L'ancien update refusé `cc8a33af` est clôturé par le rejet natif ; le nouvel update `c01a71c4-94f7-4883-9efd-66a64d5aea85` est livré, version Worker `0cba68a9-2e4b-4732-ba47-1bfd334a4587`, registre synchronisé. La vérification distante couvre 101 modules et 72 assets ; les comptes, droits antérieurs, brouillons et fichiers témoins sont conservés. Reçus : `outputs/CREEZIO-PR84-MAIN-QUALIFIED-9CE856C-2026-10-01.json`, `outputs/CREEZIO-SDK19-PUBLIC-RELEASE-2026-10-01.json` et `outputs/CREEZIO-T55-CORE-UPDATE-9ce856cb1cbb2f9fa576c5fae0f7b4be09488cb9-c01a71c4-94f7-4883-9efd-66a64d5aea85-DELIVERY.json`.
- L'interface Meili charge désormais sa source Catalogue dès l'ouverture et après rechargement, sans rafraîchissement manuel ni nouvelle indexation fournisseur. La recette API CRM Linux confirme création, pagination et archivage réversible de contacts témoins, avec conservation des autres fiches. Les widgets Meili, le lien Support vers un message fournisseur, le rendu public des nouveaux champs SEO et les recettes Stripe/T33 conservent leurs critères propres ; ces preuves ne ferment pas leurs lots exhaustifs.

## 1er octobre 2026 — SDK 1.8 public, Linux 7aeac0c et PR #83 intégrée

- [SDK 1.8.0 est public](https://github.com/creezio/Creezio-D1R2/releases/download/sdk-v1.8.0/creezio-sdk-1.8.0.tgz) depuis Core main `7aeac0c295d5c3ce80ef211f8ae4022892e7a19e` : archive Linux attestée SHA-256 `c19f9f520f54cb50cdc306bd2ab0947544e2fb32a70b019a3eb86eb2a2d2d223`, 79 022 octets, 84 fichiers. Dix consommateurs exacts ont passé 60 suites (58 réussies, deux non applicables) et 238 tests. L'asset `602124504` de la release `400563915` est vérifié ; aucune application ne change de SDK sans adoption explicite. Reçus : `outputs/CREEZIO-PR82-LINUX-DELIVERY-SDK18-2026-10-01.json` et `outputs/CREEZIO-SDK18-PUBLIC-RELEASE-2026-10-01.json`.
- L'image Linux de cette source est active avec son volume préservé, son schéma prêt et ses témoins relus. La recette Meili réelle a repris après l'échec historique de la tâche 165 : tâche 166, deux documents reçus avec `primaryKey=id`, nouvel index `ready` révision 9, puis recherche native du produit témoin à 12,99 EUR sous droits courants. Le widget de recherche reste non exercé ; la source Catalogue n'apparaît dans l'interface originale qu'après rafraîchissement manuel, défaut reproduit après rechargement et correctif UI WIP. Voir `outputs/CREEZIO-T28-MEILI-REAL-QUALIFICATION-2026-10-01.json` et [T28](docs/IMPLEMENTATION-T28.md).
- PR #83 intègre les pièces jointes entrantes par squash sur Core main `123980763be202250a32986cfc16342293b9cc31`, arbre `a849536cac0ee86988d0f15dab607ba5c0286b91` ; CI candidate et main 1 447/1 447, run main 36799636434 qualifié. SDK 1.9/Resend 0.2 restent candidats, sans recette Resend réelle. Le correctif distinct de vérification/rejet Cloudflare est WIP et non livré. Le Worker Core actif est `cd2eeb2`, version `38786f88`, déploiement `1647fddb` ; l'update `cc8a33af` de `3d42489` reste `delivery-unknown` révision 10 après l'unique retry refusé `10021`. Les recettes T33, fournisseurs différés et la validation utilisateur T39 restent ouvertes.

## 1er octobre 2026 — PR #82 intégrée et nouvelle preuve Pages Linux

- PR #82 est fusionnée par squash sur Core main `7aeac0c295d5c3ce80ef211f8ae4022892e7a19e`, arbre `53325f6be2f84dc0158693a84fe4f5858ada4337`. Sa CI candidate et la CI main `36793351811` ont chacune passé 1 442/1 442 contrôles ; le Worker local main est vérifié. Les notes ci-dessous sur la PR en brouillon retracent une étape antérieure. SDK 1.8 reste non public ; Linux sert toujours l'image main `3d42489` et l'update Cloudflare Core demeure `delivery-unknown` révision 8 avec l'ancien Worker `cd2eeb2` servi. Reçu : `outputs/CREEZIO-PR82-MAIN-QUALIFIED-7AEAC0C-2026-10-01.json`.
- Sur cette image Linux main `3d42489`, Pages T21 a passé d'une page protégée (HTTP anonyme 404) à un snapshot public (page et image 200, image 202 octets), puis à un snapshot protégé (page et images 404 sans cookie). Le titre et le canonical de repli ont été rendus côté serveur. Les champs SEO éditables description/canonical n'étaient pas renseignés ; Sites et Cloudflare ne sont pas qualifiés. Après révocation, le navigateur affichait encore l'ancien rendu, donc le refus visuel n'est pas prouvé. Reçu : `outputs/CREEZIO-T21-LINUX-PUBLIC-RECIPE-2026-10-01.json`.
- La candidate locale SDK 1.9/Resend 0.2 ajoute au module Messaging la préparation, le staging R2 et la publication atomique des pièces entrantes. Les six suites du module et l'intégration synthétique D1/R2 0/1/50, avec refus des courses au commit et de la configuration révoquée, passent. Aucun fournisseur réel, navigateur ou hébergement n'est qualifié ; le reçu hors dépôt `outputs/CREEZIO-T18-T29-INBOUND-ATTACHMENTS-FREEZE-2026-10-01.json` fixe les fichiers exacts. Ce lot n'est pas inclus dans PR #82.

## 1er octobre 2026 — recettes Linux ciblées et PR #82 en correction

- Sur Core main `3d4248960f4ff56d9fdf5e956abe26d6e202f174`, le workspace a recherché et relu un contact CRM, puis l'a lié à un ticket Support (révision 3→4). Le lien a persisté après rechargement ; les trois messages Support, deux boîtes Messaging et le brouillon à la révision 6 sont conservés. Aucun message réel dans les boîtes n'a permis de qualifier la relation Support→Messaging. Preuve : `outputs/CREEZIO-T18-T20-LINKS-RECIPE-2026-09-30.json`.
- La recette CRM sur la même image Linux a écrit puis retiré la ville du contact (révisions 2→3→4), conservé sa relation d'entreprise et les lectures Support/Messaging, et retrouvé un brouillon non enregistré après navigation entre onglets. La section Contacts est restaurée après rechargement, pas la fiche sélectionnée. Archive/suppression et pagination restent ouvertes. Preuve : `outputs/CREEZIO-T20-CRM-UI-RECIPE-2026-10-01.json`.
- PR #82 reste en brouillon : la CI candidate échoue sur des assertions de composition périmées et un budget runtime en correction. Les correctifs ciblés des tests de schéma (8/8) et de composition runtime (31/31) passent localement ; le contrôle MCP Workerd attend un nouveau build. Aucun gain de taille du bundle n'est établi. SDK 1.8 demeure candidat non public ; aucune nouvelle publication Cloudflare n'est confirmée et l'ancien Worker `cd2eeb2` reste servi sous `delivery-unknown` révision 8.

- Le correctif candidat de `scripts/build/compose-runtime.mjs` partage au build les segments strictement identiques des scripts de widgets d'un même module ; une ancre ambiguë ou absente conserve les ressources sans partage. `tests/runtime/widget-script-sharing.test.mjs` contrôle HTML, ordre, digests et UTF-8 inchangés, ainsi que la conservation sans partage des tags avec attributs ou multiples. La réduction mesurée en mémoire n'est pas une preuve de bundle Linux construit ni de passage du budget runtime.

## 30 septembre 2026 — compléments des modules et SDK 1.8 candidat

- Messaging et Resend ajoutent le gel atomique des pièces sortantes, les reçus signés et la réception explicitement choisie dans une boîte. Les pièces entrantes restent refusées intégralement ; la recette Resend réelle est reportée.
- Analytics collecte les navigations, clics déclarés et refus lorsque l'administrateur active ces catégories. Les réglages sont lus dans la base principale, même lorsque les données métier utilisent un contexte isolé.
- Access expose les commandes natives minimales de service et un jeton HTTP réservé à une session administrateur. Stripe reçoit une permission de webhook dédiée à la machine, avec signature obligatoire. Meili indique explicitement `primaryKey=id` après le refus réel de sa première tâche d'indexation.
- L'opérateur Cloudflare peut proposer une nouvelle tentative explicite sur l'artefact préservé d'une mise à jour principale, après vérification des versions distantes et du reçu D1. Aucune reprise des mises à jour isolées T33 n'est ajoutée.
- Les dix compositions utilisent SDK 1.8 candidat ; SDK 1.7 reste la version publique. Les revues et tests locaux ne constituent pas une recette hébergée ni une publication de ces changements.

## 30 septembre 2026 — PR #81 intégrée, Sidebar et rétention vérifiées sur Linux

- Core main `3d4248960f4ff56d9fdf5e956abe26d6e202f174` passe la CI main 1 428/1 428. L'image Linux `sha256:caff5af853c3670c43cc9d64f4955af10d7b456c79e28bf9dd2fc286864cf523` a adopté le schéma additif sur le volume existant. La Sidebar T21 conserve titre et ordre après rechargement puis confirme le retour aux valeurs d'origine ; la rétention T22 est configurée à 3 650 jours, avec aperçu vide et aucune purge. Le reçu Linux distingue ces deux parcours de toute preuve CRUD T18–T20 ou Cloudflare.
- [SDK 1.7.0 est public](https://github.com/creezio/Creezio-D1R2/releases/download/sdk-v1.7.0/creezio-sdk-1.7.0.tgz) depuis ce main : SHA-256 `469287af6d3c81a9d6a71c003cc950dab2be160b0ee97fdd823ee323c501c403`, 78 537 octets et 84 fichiers. Son archive exacte passe dix consommateurs Linux, 60 suites dont 58 réussies et deux non applicables, 234 tests ; l'asset public a été téléchargé et comparé après publication.
- La mise à jour Cloudflare Core `cc8a33af-84a9-46a7-b927-050348ced5b1` est en `delivery-unknown` révision 8 : ajouts D1 attestés, ancien Worker `cd2eeb2` toujours servi et aucune nouvelle publication confirmée. La recette isolée T33 sur au moins deux couples réels reste ouverte. Les travaux Access/Stripe, Messaging/Resend et Analytics du checkout courant ne font pas partie de PR #81 ; les essais fournisseurs différés et la validation T39 restent ouverts.

## 30 septembre 2026 — PR #80 intégrée, SDK 1.6.0 publié

- Core main `684901c46cff026dc0209f3e2deabbf894826af9` intègre PR #80 après CI candidate et main 1 360/1 360 : ports communs des connecteurs et runtime de stockage isolé. Le Worker Cloudflare applicatif sert toujours la source `cd2eeb2` ; cette intégration n'est pas une publication de l'app.
- [SDK 1.6.0](https://github.com/creezio/Creezio-D1R2/releases/download/sdk-v1.6.0/creezio-sdk-1.6.0.tgz) est public depuis ce main : archive SHA-256 `d1d8dba645f4a710cd8c5a37f9eaabdeb15c6745c08a8bd5922d2fbcf2a53be8`, 78 067 octets, 82 entrées, huit consommateurs, 48 suites et 170 contrôles vérifiés. Son adoption par chaque application reste explicite. SDK 1.7.0 est une archive candidate locale de 78 922 octets et 84 entrées, SHA-256 `3b302ad2fc09e05879e8d624d2975ee3b072d962ba6fa66c99f78293e3eae66c`, qualifiée sur dix consommateurs et 60 suites ; elle n'est pas publique.
- Le checkout courant conserve les tranches non intégrées : installation et cutover T33 testés et revus localement, n8n webhook/widgets, widgets Hermes et rétention Analytics avec revues de code favorables, barre latérale Pages T21 gelée et revue localement. Leur intégration et leurs recettes propres restent distinctes ; aucune recette réelle T33 ou fournisseur reporté n'en découle.
- Une image Linux depuis `684901c` a été construite sans être activée : l'inspection réclame des colonnes dans les tables existantes de brouillon Messaging (`send_intent_id`), de configuration et d'abonnement Stripe (retour Checkout, webhook, annulation), et de ticket Support (liens). Le correctif central borné aux ajouts de colonnes passe ses tests locaux ; l'omission d'index relevée en revue est corrigée et relue sans autre finding moteur. Le raccord de l'installation composée est qualifié localement et revu ; intégration et CI restent nécessaires avant activation ; ces colonnes sont requises, sans migration de module ni DDL forcé. Les données et la source Cloudflare existantes restent sur leurs versions vérifiées.

## En développement — connecteurs et runtime des données isolées

- Les contrats de module déclarent les mutations de connecteurs, les webhooks, les projections de recherche et les livraisons différées dans le journal commun. Le SDK 1.6 correspondant est public ; les compléments de module gardent leurs propres étapes d'intégration et recette.
- Messagerie et le connecteur externe Resend partagent un transport d'envoi avec intention durable, projection du reçu et inspection des résultats incertains sans nouvel envoi automatique.
- Meili ajoute l'indexation et la recherche du Catalogue sous les droits courants. Stripe ajoute Checkout, les abonnements et les événements en mode test ; ces ajouts ne constituent pas encore un parcours de paiement de production.
- Granola et Hermes ajoutent leurs connexions et opérations aux interfaces originales. Hermes conserve les commandes incertaines entre les vues ; aucun service tiers n'est intégré à l'application.
- Le runtime hors Sites route les données, fichiers, fournisseurs et journaux vers le contexte D1/R2 sélectionné. La révocation coordonne les accusés des cibles ; les gardes de composition refusent une ancienne version. Installation et cutover multi-D1 sont testés et revus localement ; l'intégration du checkout et la recette Cloudflare réelle restent ouvertes.
- Les recettes réelles n8n, Granola, Resend et Hermes sont différées par l'utilisateur. Les tests avec transports simulés ne les remplacent pas. Le SDK 1.6 est public séparément ; aucun déploiement applicatif des compléments de ce checkout n'est annoncé.

## En développement — compléments des modules natifs et externes

- Lectures entre contrats publics de modules avec la même identité et les mêmes droits serveur, contrôle de l'opération enfant, budgets et journal D1 commun ; requis pour les relations Support/CRM/Messagerie. Les commandes imbriquées restent indisponibles.
- Support conserve les liens vers les contacts CRM et les messages sous contrôle des droits courants ; Messagerie préserve les brouillons pendant les actions sur les pièces jointes et assainit leur présentation HTML.
- Analytics consulte les métadonnées du journal commun et les endpoints déclarés, avec exports CSV/JSON bornés. Les contenus métier et les secrets ne font pas partie de ces exports.
- Pages ajoute une publication anonyme explicite, son document HTML et ses médias vérifiés. Le rendu provient de la contribution du module sélectionné ; les pages protégées et les brouillons restent exclus.
- La composition isole le renderer HTML des pages dans un artefact ESM vérifié, pour conserver les mêmes composants dans un Worker compilé sous la condition `react-server`.
- L'adaptateur de stockage accepte une configuration statique de ressources séparées hors Sites. PR #80 intègre le routage métier et les gardes d'autorité au runtime ; l'installation distribuée reste un lot distinct, sans isolation réelle annoncée sur Cloudflare.
- Reprise parallèle des compléments T18–T22, T25–T29 et T33 autorisée par l'utilisateur ; les conditions des chantiers différés et le test utilisateur T39 sont conservés.

## État de livraison ciblée — 30 septembre 2026

Core PR #77/main `cd2eeb2` et Lab PR #14/main `1bfdf0f` ont leurs CI main réussies. Les Sites Original et Lab v5 et leurs mises à jour Cloudflare sont publiés avec registre synchronisé ; les lectures natives vérifient les témoins conservés. Meili 0.2.0 lit une page de métadonnées d'index sur fournisseur réel, Stripe 0.2.1 affiche le prix mensuel conservé sur Linux. Sur Lab, la séquence de contexte v5 ne reproduit pas le conflit de v4 ; le plugin APP connecté dans ChatGPT rend la fiche et sa lecture directe. Les limites et preuves sont détaillées dans T16/T27/T28/T38/T39 ; la validation utilisateur attend son test et aucun lot global n'est clos ici.

## Correctif local à livrer — révision d'un contexte widget retiré (T16)

Sur Lab Sites v4, une nouvelle sélection du widget de demandes a été refusée par `conflict` après un retrait antérieur : la lecture avait masqué la révision de la ligne retirée. Le correctif local conserve cette révision avec une valeur nulle pour permettre le remplacement contrôlé, sans réinjecter le contexte retiré dans un tour. Les vérifications locales sont distinctes d'une livraison ; le Site Lab v4 et son plugin ChatGPT restent inchangés.

## En qualification — diagnostic d'index Meili 0.2.0 et lecture Stripe 0.2.1

Meili ajoute une liste d'index paginée réservée à l'administration `manage`, limitée aux métadonnées du compte fournisseur et relue après rotation de configuration. Six suites et l'intégration D1/HTTP/MCP simulée passent ; aucun document, indexation, recherche globale ou appel Meili réel de cette version n'est qualifié. Stripe produits/prix 0.2.0 est intégré par PR #75 et lu sur Linux en mode test (huit produits, un prix de 6 EUR), sans perdre les parcours précédents. Le même code est livré sur Cloudflare par l'update `13ad72e9`, puis une relecture distante a vérifié les témoins conservés après arrêt de Docker ; elle ne qualifie pas de GET Stripe fournisseur distant. Un ajustement 0.2.1 des libellés de prix reste local après 19 tests. REQ-2701/2801 ne sont pas closes.

## En qualification — produits et prix Stripe (T27)

Facturation ajoute les onglets Produits et Prix avec deux lectures API/MCP des projections D1. Le moteur de synchronisation existant lit les produits et les prix actifs/inactifs par trois ressources GET bornées ; deux modèles de données et un modèle de parcours sont ajoutés sans modifier les anciennes tables. Les montants et les relations gardent leur devise, leur précision et leur génération de connexion. Aucun paiement ni modification distante Stripe n'est introduit. La recette ciblée ultérieure sur Linux a vérifié huit produits et un prix de 6 EUR via le fournisseur de test et l'interface, avec l'onglet Prix conservé après rechargement ; les synchronisations exhaustives et paiements restent ouverts.

## En qualification — liste complète des médias Pages (T21)

La lecture d'une page de 50 médias doit compter aussi la lecture préalable de la page propriétaire : le budget du seul traitement `media.list` passe de 50 à 51 unités. La pagination reste limitée à 50 et les contrôles centraux restent inchangés. Ce refus a été détecté pendant la recette Linux de PR #73, après son intégration et sa CI ; aucune page n'a été modifiée par ces lectures refusées.

## En qualification — images privées des pages (T21)

L'éditeur et le front authentifié affichent les images R2 dans les sections existantes. La publication fige jusqu'à cinq références sélectionnées ; modifier ou détacher un média du brouillon laisse la page publiée intacte. Le reset restaure les liens sans recopier les fichiers. Deux modèles D1 et un index sont ajoutés par le générateur central, sans modifier les anciennes tables. Les contrôles locaux couvrent permissions, publication concurrente, aperçu, références exactes et nettoyage des URL Blob ; la recette sur Linux reste à effectuer.

## En qualification — identifiants des outils Catalogue (T25)

Les outils et le guide conversationnel indiquent qu'une recherche accepte un nom ou SKU, puis que la fiche attend l'identifiant interne renvoyé dans `items[].id`. Le test vérifie ces descriptions dans la projection fournisseur, sans modifier les opérations, droits ou données. Les verrous des deux compositions Catalogue et Connecteurs sont régénérés après le dernier changement du module.

## Qualifié sur Linux — images Blob dans le sandbox des widgets (T16/T25)

La politique CSP commune du sandbox autorise les URL `blob:` uniquement pour les images reçues par le composant. Le fichier privé arrivait correctement au navigateur, mais sa règle `img-src` en bloquait l'affichage dans les deux widgets Catalogue. Les directives de scripts, connexions, cadres et les domaines déclarés restent inchangés. Cette correction n'ajoute ni droit, ni API, ni donnée. Core main `7451334` passe 1 285/1 285 tests ; sur Linux, les deux images de widgets sont visibles et décodées en 32 × 32 après actions directes et rechargement, avec déconnexion confirmée. Le même code est livré sur Cloudflare, où les témoins API/D1/R2 sont conservés ; le rendu des images des widgets n'y a pas été vérifié.

## Intégré à la source — images privées dans les widgets Catalogue (T16/T25)

La grille et la fiche Catalogue peuvent lire leurs images liées depuis les widgets app en réutilisant les contrôles D1/R2 existants. Le contrat SDK 1.5 ajoute une lecture d'image réservée au composant dans `_meta` et l'appel d'une opération commune par plusieurs widgets via `widgetCalls`. La limite de 3 Mio concerne uniquement le résultat privé vérifié hôte vers widget ; les autres messages conservent 1 Mio. La PR #68 intègre ces contrats dans la source Core ; le SDK 1.5.0 est public depuis main `b2ae2ef`, avec archive exacte et sept consommateurs vérifiés. Le correctif CSP de l'hôte est intégré séparément par PR #70 ; la recette Linux des images est qualifiée, tandis que leur rendu Cloudflare/Sites et ChatGPT reste ouvert. Catalogue 0.1.2 reste un module du workspace, sans release autonome.

Le suivi T38 est rapproché des livraisons existantes : Sites Original/Lab version 4, Lab Linux puis Cloudflare `7ebf532`, conservation des témoins après arrêt Docker et previews de dépendances refusées. Aucun nouveau déploiement ne découle de cette mise à jour documentaire.

## Publié — statut du contexte de widget retiré (T16)

Après un retrait confirmé, l'hôte Conversations affiche que le contexte est retiré pour les prochains tours. Le service conserve son retrait durable ; un test D1 vérifie qu'un tour démarré après ce retrait capture un snapshot vide. Le parcours Lab Sites version 3 a exercé lecture directe, sélection et contexte, puis préparation sans envoi d'un message ; aucun tour suivant réel n'y a été lancé. Le correctif est intégré par PR #67 et publié sur les deux Sites version 4 ainsi que sur Lab Linux/Cloudflare ; la recette visuelle de ce statut sur ces versions reste distincte.

## En préparation — documentation du repli Sites depuis la source

Le guide Sites distingue l'archive locale du build distant officiel depuis un commit source poussé. Il décrit la preuve d'inventaire source du mode opératoire `remote-source`, le préflight avant déploiement, la vérification du reçu fournisseur et la déclaration sous une même clé, sans assimiler ce digest au Worker compilé. Le suivi T-09 distingue la version sauvée sans archive, le déploiement fournisseur réussi et le registre synchronisé de la recette applicative encore ouverte. Il sépare les anciennes cibles des Sites du compte actuel. T-38 note la mise à jour Cloudflare Lab et une réponse réelle correcte sur 123,45 EUR. Aucun nouveau contrôle produit ni déploiement n'est apporté par cette édition documentaire.

## Unreleased — finalisation des candidates de module

Les guides de développement demandent de contrôler, après la dernière édition d'un fichier déclaré, tous les profils qui sélectionnent le module et leurs archives runtime et validation avant push. Ils renvoient au contrôleur `modules:lock` existant, avec reçu pour les paquets externes. Les indications historiques « avant GO/P0 à construire » sont retirées des guides courants ; aucune règle de fusion ni capacité runtime ne change.

## En qualification — reprise d'un tour Conversations après résultat d'outil

Quand un tour `unknown` récupère une réponse fournisseur connue et ajoute une continuation après un résultat d'outil, le même batch D1 remet le tour `running` et efface `provider_unknown`. Le résultat d'outil rejeté reste visible comme tel. Un test ciblé couvre la transition sans recréer la réponse initiale ; la réponse finale du même tour T61 a ensuite été confirmée sur le Site publié en 938ede5. Le correctif de transition n'y est pas encore déployé.

## En qualification — environnement des archives et preuve Docker (T02/T03)

Les commandes Node des archives de validation reçoivent un environnement limité aux chemins système nécessaires et à un répertoire temporaire propre à l'assemblage ; une sentinelle vérifie l'absence de variables ambiantes chez l'enfant et son descendant, et la gate Support passe avec le SDK public 1.4.1. Ce contrôle ne constitue pas une isolation du système de fichiers ou du réseau. REQ-0302 est reliée à la recette Docker T31 existante, image bâtie depuis les sources et le lockfile puis redémarrage avec D1/R2 conservés ; aucune nouvelle image n'est construite pour cette mise en documentation.

## En qualification — chaîne de trois éditeurs (REQ-3004)

Un hôte de test installe trois archives npm d'origines distinctes et compile la chaîne obligatoire A → B → C. L'intégration D facultative reste absente et seule sa contribution est désactivée. Les refus d'absence, d'origine, de version, de contrat et d'altération sont exercés. Le SDK public 1.4.1 est vérifié dans une qualification locale séparée ; aucun module métier ni service tiers n'est ajouté au produit.

## En qualification — catalogue MCP complet et widgets Analytics

Le démarrage Linux du profil connecteurs avec les widgets de messagerie a révélé un catalogue statique de 18 529 969 octets, supérieur à son plafond de 16 Mio. Avec les deux widgets Analytics, il atteint 19 826 304 octets. Le plafond de cet inventaire compilé passe à 24 Mio ; les limites des requêtes, des ressources HTML individuelles et de profondeur restent identiques. La composition vérifie désormais le vrai catalogue avec le registre d'opérations avant de produire le code, pour refuser un déploiement qui échouerait à ce contrôle au démarrage. La nouvelle recette Linux reste nécessaire.

## En qualification — provenance des sources GPT Sites (T09)

Le préparateur officiel relie le build Core aux sources et au commit Git du Site existant. Il conserve un plan avant copie, vérifie les empreintes et refuse les fichiers inconnus ou ignorés qu'il écraserait. La vérification finale exige un commit propre descendant de la base et produit un reçu distinct ; aucune publication n'est déclenchée depuis l'application. PR #60/main `a0f554c` passe 1 262/1 262 tests. Le parcours réel relie 1 396 fichiers du Core au commit Site `2931d31`, avec une archive de 163 fichiers vérifiée. Cette source n'a pas été publiée ; un nouveau changement de compte GPT rend les deux projets T56 inaccessibles depuis le compte actuel, sans effacer leurs données ni leurs preuves.

## En qualification — deux widgets de lecture Analytics (T22)

La synthèse de sept jours et les pages de cinq événements déclarés sont lisibles sur demande dans deux cartes administrateur. Les segments, périodes, filtres et refus de résultat trop volumineux restent explicites ; sans arguments historiques fiables, la pagination exige de relancer la liste. Aucun collecteur, modèle D1 ou mesure automatique n'est ajouté. Six suites fermées 18/18 avec le SDK public 1.4.1 et intégration D1/HTTP/MCP ciblée 1/1 ; CI finale et recette des cartes dans le chat restent distinctes.

## En qualification — widgets de lecture de la messagerie (T18)

Trois cartes affichent boîtes, messages et brouillons depuis les mêmes données et droits du workspace/front. Les listes proposent des extraits bornés ; la lecture complète reste explicite et le HTML n'est pas exécuté dans le widget. Les six suites du module passent depuis leurs archives avec le SDK 1.4.1 public, ainsi que l'intégration D1/HTTP/MCP ciblée. La PR #59 est intégrée sur `468b101` après 1 258/1 258 tests du candidat. Le contrôle de main et la recette dans le chat restent distincts. Aucun transport e-mail ni schéma supplémentaire n'est ajouté.

## 29 septembre 2026 — Sites du compte courant et packaging T09 intégré

Deux nouvelles installations publiques T56, Original et Lab, sont distinctes des Sites version 5 conservés. Leur publication et leur déclaration au registre sont confirmées. Les lectures natives refusent le MCP anonyme en 401 et exposent les catalogues autorisés par audience ; un témoin synthétique par Site conserve réponse OpenAI, brouillon et pièce R2. Le navigateur admin retrouve ces témoins après rechargement, avec le widget de lecture historique sur Lab. La lecture directe « Actualiser la liste » du widget Lab termine sans tour IA et le widget se remonte prêt après rechargement ; la liste est vide. La sélection d’une demande, un nouveau plugin ChatGPT et le partage des conversations admin avec l’audience app ne sont pas qualifiés.

Le correctif T09 est intégré par PR #58/main `eefb248` avec 1 258/1 258 tests CI. L'export officiel de l'application a produit une archive réelle de 161 fichiers dont chaque taille et empreinte a été vérifiée, avec manifeste d'hébergement et historique DDL central. Ce paquet n'est pas encore publié ; la liaison au commit Git propre au Site reste un complément distinct. Le guide [Installation Sites](docs/INSTALLATION-SITES.md) décrit cette frontière.

## 29 septembre 2026 — widgets du Support intégrés et SDK 1.4.1 public

Quatre cartes distinguent listes et fils de tickets pour les audiences app et admin. Les créations et réponses réutilisent les opérations, droits et clés d’idempotence existants. Le SDK reconnaît ces clés comme noms de champs JSON, y compris `requestKey` ; le binding MCP accepte une union limitée aux schémas de sortie exacts des outils de la carte. PR #57/main `f99a455` passe 1 257/1 257 tests ; SDK 1.4.1 et ses sept consommateurs sont vérifiés et publiés. La mise à jour Linux ne comporte aucun DDL ; sa recette API partage le ticket témoin entre les deux audiences. Deux tours IA ont ensuite rendu les quatre cartes liste/fil dans deux conversations ; une réponse directe admin confirmée a porté le ticket à la révision 3 avec trois messages identiques côté app/admin. Les cartes restent dans l'historique après rechargement, avec leur snapshot initial ; les sessions sont déconnectées. Un schéma d'outil non proposé, le MCP externe et la parité exhaustive restent à qualifier.

## 29 septembre 2026 — nouveaux Sites et mise à jour Cloudflare confirmée

L’original et Lab sont republiés sur le compte GPT courant, dans deux Sites distincts, avec leurs nouveaux comptes natifs et leurs données propres. Le registre confirme les deux publications. Les droits, OpenAI et les recettes natives/API et navigateur sont maintenant qualifiés dans les limites T56 indiquées ci-dessus ; les recettes des anciens Sites restent distinctes.

La source `512a7ff1` est active sur la cible Core Cloudflare existante, avec 30 tables et 30 index ajoutés par le plan additif. Après le correctif PR #56 et ses 1 253 tests, le même update `e11287c4` est confirmé `delivered`, registre synchronisé. La relecture API et le navigateur vérifient les conversations, brouillons, fichiers et droits historiques conservés. Aucun nouvel upload ni appel OpenAI n’a été nécessaire à cette confirmation. Voir [T32](docs/IMPLEMENTATION-T32.md).

## En qualification — widgets de lecture du CRM (T20)

Les listes et fiches des entreprises, contacts et prospects disposent de six widgets MCP Apps typés, avec recherche, lecture et pagination à la demande. Ils utilisent les opérations CRM existantes et leurs droits dans le chat interne comme dans un client MCP compatible. Aucun modèle D1, écran d'administration ou traitement métier n'est remplacé. Les résultats textuels restent disponibles ; la limite actuelle des sorties d'outils du chat interne reste applicable. Voir [T20](docs/IMPLEMENTATION-T20.md) pour les preuves et limites de qualification.

Le catalogue MCP statique inclut le HTML compilé pour chaque audience : le profil complet des connecteurs mesure environ 12 Mo avec ces widgets. Sa borne agrégée passe de 4 à 16 Mio ; les limites des requêtes et de chaque ressource, ainsi que les contrôles d'accès, restent inchangées. Le Worker capture cet index immuable une seule fois ; moteur, authentification et droits sont toujours liés à la requête courante. La CI a mesuré le build à 11 931 616 octets bruts et 2 068 665 gzip ; les deux budgets de taille sont ajustés avec moins de 3 % de marge, sans modifier les plafonds de graphe ou de durée.

## En cours — connexion Meili externe (T28)

Le module optionnel prépare les réglages HTTPS, la clé scellée et un contrôle de connexion borné sur la liste des index, sans retourner leurs données. La PR #53 a passé 1 247/1 247 contrôles ; la recette Linux du code `3b2131c` a confirmé les réglages et affiché la connexion Meili dans l’interface après un contrôle réel. Aucune indexation, recherche Meili, écriture distante ou recherche globale T05 n'est livrée par cette première tranche. Voir [T28](docs/IMPLEMENTATION-T28.md).

## Correctif n8n — origine de connexion (T26)

Le connecteur refuse de déplacer une clé scellée vers une autre origine, y compris quand la connexion est désactivée. Révoquer la clé avant de changer d’instance ; les lectures fournisseur positives restent à qualifier.

## Qualification — marge de durée de l'agrégat (T27)

Le plafond du processus de tests passe de dix à quinze minutes, dans le job CI toujours limité à vingt minutes. Les 1 246 tests du candidat ont réussi en 483 secondes ; le contrôle du main a atteint son dernier test puis sa limite de 600 secondes sans bilan final. Le test Stripe isolé sur Linux s'est terminé avec son bilan complet et sans processus restant. Cette marge ne change ni les délais individuels, ni les suites requises, ni les refus des bilans incomplets ou des preuves périmées. Le contrôle interrompu demeure non qualifié.

## SDK 1.4 — contrat de connecteurs et première lecture Stripe (T27)

Le contrat SDK 1.4 ajoute une origine HTTPS fixe, des en-têtes de protocole constants et des noms de paramètres déclarés aux ressources GET des connecteurs. L’hôte peut relier une lecture distante bornée à une projection D1 qui revérifie atomiquement la configuration, la version de clé et les droits. La première tranche Stripe 0.1.0 lit clients, abonnements et factures par pages bornées, avec clé scellée, génération de connexion et journal de commandes. La recette Linux en mode test a confirmé trois parcours et douze projections ; l’interface de facturation originale a affiché quatre abonnements et quatre factures, avec montants EUR concordants et connexion conservée après rechargement. Aucune mutation Stripe, paiement, webhook ni clôture de REQ-2701 n’en découle. La disponibilité et l’empreinte de l’archive SDK 1.4 se vérifient sur sa release GitHub ; le module n’est pas publié automatiquement.

## SDK 1.3.0 public — images liées du Catalogue (T25/T30)

Le candidat de la PR #48 porte `linkedRead` déclaré et `downloadLinked` sur le transport natif existant ; lecture privée du propriétaire, upload et abandon gardent leurs règles. Il a passé 1 227/1 227 contrôles et la lecture d’image liée a été exercée sur Linux. La PR #49 est intégrée sur main `14f3e504` (CI 1 227/1 227) ; le SDK 1.3 est public, archive de 71 812 octets et SHA-256 `177616cb42288637d6eeaa91f55ffe9fe3d00c9d08e0f806886e40c72833a67d`. Les cinq consommateurs et les téléchargements draft/public sont vérifiés. Aucune application n’est déployée par cette release. Voir [T25](docs/IMPLEMENTATION-T25.md) et [T30](docs/IMPLEMENTATION-T30.md).

## En qualification — outils du chat des modules (T15/T16)

Le chat peut proposer les lectures autorisées au-delà des seize premières, dans les bornes de 128 outils et 64 Kio de définitions. Son diagnostic distingue les omissions par nombre ou taille. Les descriptions de champs déjà présentes dans les schémas de sortie enrichissent le contrat transmis au modèle, sans changer les titres des interfaces ni les données. Droits et opérations restent communs aux API, MCP et widgets ; voir [T15](docs/IMPLEMENTATION-T15.md).

## SDK 1.2.0 publié — journal et contrats de connecteurs (T30)

Le paquet distribue le journal public des commandes de panneau, les descripteurs de connecteurs GET et le type public limité de configuration des secrets. Les exports SDK 1.1 de livraison restent disponibles. Les changements fonctionnels sont intégrés par PR #44/#45 et la distribution par PR #46. L'archive publique est construite depuis main `11be33a2`, contrôlée avec cinq modules consommateurs et vérifiée après téléchargement ; voir [T30](docs/IMPLEMENTATION-T30.md) pour sa provenance. Aucune application installée n'est mise à jour automatiquement.

## En cours — connecteurs externes déclaratifs et n8n (T26)

Le SDK public 1.2 ajoute les descripteurs et le port de connecteur génériques. Les modules déclarent leurs ressources GET et leurs modèles privés de configuration/coffre ; le Worker les compose sans branche spéciale par fournisseur. Le module n8n configure une instance externe et propose la lecture autorisée des workflows/exécutions. Les mutations distantes, callbacks et recettes fournisseur restent ouverts ; aucun n8n n'est embarqué. Voir [T26](docs/IMPLEMENTATION-T26.md).

## En cours — Support, pages, analytics et catalogue (T19/T21/T22/T25)

Trois modules natifs rejoignent la composition du socle et des thèmes : tickets et discussions Support, pages avec brouillons/snapshots publiés et navigation, tableaux Analytics alimentés par les événements déclarés. Les interfaces réutilisent les composants du Creezio original. Le Catalogue est une extension métier optionnelle avec son profil de qualification, ses produits/catégories, son port public et deux widgets liste/fiche. Les schémas sont générés centralement et les suites propres/intégrations rejoignent la CI ; voir les documents de réalisation pour les recettes acquises et les raccords encore ouverts.

## En cours — messagerie partagée et journal SDK (T18/T30)

Un utilisateur autorisé retrouve les mêmes boîtes, brouillons et pièces jointes dans le workspace et le front. Les modèles sont rattachés au principal et au contexte ; les permissions restent distinctes par audience. Le SDK public 1.2 expose un journal de mutation qui conserve la clé avant émission, bloque le nouvel envoi après une issue incertaine et vérifie le statut sans replay. Les archives SDK déjà publiées restent inchangées. Voir [T18](docs/IMPLEMENTATION-T18.md) et [le contrat SDK](sdk/operations/README.md).

## En cours — CRM natif (T20)

Entreprises, contacts et prospects rejoignent les modèles D1 et les opérations API/MCP communes. La prospection reprend le kanban original ; workspace et thèmes front disposent des vues déclarées. Les fiches sont communes aux audiences autorisées dans le même contexte, avec relations protégées, archivage, recherche paginée et révisions d’édition. Voir [T20](docs/IMPLEMENTATION-T20.md) pour les contrôles et les qualifications restantes.

## En cours — messagerie native (T18)

Le webmail du kit original est adapté aux opérations communes et aux données D1/R2 : boîtes personnelles, brouillons, destinataires, pièces jointes privées et classement des messages. API, MCP et interface partagent les droits et les contrôles de concurrence. La composition inclut le module `creezio.messaging` ; son schéma et ses six suites rejoignent la chaîne centrale. L'absence de transport externe est affichée et ne produit aucun envoi simulé. Voir [T18](docs/IMPLEMENTATION-T18.md) pour les résultats et limites de qualification ; ce changement n'est pas encore publié.

## 28 septembre 2026 — vérification des modules Cloudflare volumineux (T32)

La confirmation d'une publication vérifie le base64 des modules sans expression régulière récursive : un module de plusieurs mégaoctets ne provoque plus de dépassement de pile. L'alphabet, le padding, les bits terminaux, les limites de taille et la comparaison exacte des fichiers restent exigés. Cette correction de l'opérateur ne relance ni l'upload ni les opérations applicatives ; la publication Lab a ensuite été vérifiée séparément sur le même artefact et le même transfert.

Core PR #40 est fusionnée sur main `22a0d3f352d930897487dda2200a4ad84824053a` ; Lab PR #7 l'adopte sur main `6e06182d15769a94907c2253b8bfd6a87c26483f`. Les CI main ont réussi 1 185/1 185 et 1 188/1 188 tests, sans omission. L'image opérateur corrigée a été activée sans changer la source de l'artefact. Le transfert Lab `a4ea2615-134b-4831-8582-57ca00dddf96` a vérifié 2 265 lignes D1 et un objet R2, puis envoyé le Worker. La première lecture de confirmation a levé `RangeError` sur un module volumineux ; le plan est alors resté `delivery-unknown` et le journal `prepared`. L'inspection corrigée puis l'unique réconciliation native du même transfert ont confirmé la publication : plan `delivered`, registre `synchronized`, 71 modules et 41 assets vérifiés. Après arrêt Docker, la lecture native a conservé demande, trois tours, fichier R2 exact et ancien tour OpenAI `unknown` sans rejeu ; une nouvelle réponse OpenAI réelle est persistée (77 octets, deux `turn.drive`) ; la lecture navigateur a retrouvé trois widgets historiques après rechargement ; un ancien texte IA affiche cependant `12 345 EUR` contre `123,45 €` dans la demande et les widgets, anomalie de prose à garder ouverte. Voir [T32](docs/IMPLEMENTATION-T32.md).

## En cours — transfert fidèle des historiques incertains (T32)

Le correctif source est intégré sur Core main `0078fc7defc22d27e8caf22ac3b967f36fc30fbc` (PR #39, CI main 1 183/1 183) et adopté par Lab main `949f028dbbe99ab586c02c42c82e51f145379b23` (PR #6, CI 1 186/1 186). Le nouveau transfert a vérifié D1/R2 ; sa publication Cloudflare est confirmée par un reçu distinct, tandis que sa recette applicative reste ouverte. Le premier essai interrompu demeure conservé.

La capture locale vérifie les effets avant de créer ses fichiers. Elle accepte uniquement un ancien tour OpenAI incertain sans reçu fournisseur, avec tentative terminée, claims expirés et identité/journal cohérents, sous le verrou exclusif du runtime arrêté. Les lignes restent inchangées ; le manifeste compte ces historiques. Tout autre effet actif est refusé. Cette correction ne relance aucun appel et ne transforme aucun résultat inconnu en succès ou échec. La publication réelle Lab a ensuite été confirmée ; les autres scénarios de capture restent à qualifier.

## 28 septembre 2026 — conservation des widgets et cycle des plans (T40)

La projection compatible rétablit les anciens widgets après la mise à jour réelle du module Lab 0.1.0 vers 0.1.2. Core PR #38 est intégré ; les deux Sites version 5 et Lab Linux conservent leurs données, messages et fichiers. Le cycle des plans ajoute une confirmation fondée sur le runtime réel, une annulation motivée et un journal durable, sans réécrire les anciens plans. Les anciens plans Lab Sites/Linux sont clôturés par annulation motivée sans confirmation rétroactive. Voir [le suivi T40](docs/IMPLEMENTATION-T40.md).

Le parcours local ajoute `schema:inspect` et `schema:apply` pour appliquer le plan central à une base déjà gérée, sous le verrou existant et après confirmation de son empreinte. Il ne recrée aucun compte et conserve le refus des évolutions incompatibles. La commande a ajouté sur Lab Linux la seule table des issues de plans et conservé le compte ainsi que les données du même volume.

## 28 septembre 2026 — checkpoints du chat administrateur intégrés (T-39)

Les petits fragments du flux OpenAI sont regroupés avant écriture D1, avec flush aux événements de contrôle et à la fin du flux. L'annulation et la reprise gardent le curseur durable ; un accusé de checkpoint perdu n'entraîne pas de doublon. La correction répond à une coupure observée sur le Site A original. Core main `e51928f` a passé 1 163/1 163 tests CI ; sur le Site A publié depuis `cb716aa`, un tour post-correction a réussi en 14 161 ms avec un seul `turn.drive`, sans reprise manuelle, et une réponse persistée de 933 octets. Ce témoin ne qualifie pas la fluidité générale ni la recette complète. Voir la [note T39](docs/IMPLEMENTATION-T39.md).

## En cours — confiance TLS du Docker local (T-38)

L'image Docker installe les certificats CA du système avant de lancer workerd. Le Lab a montré l'échec TLS sans ce bundle, puis une réponse HTTP 401 JSON à un GET `/v1/models` sans clé depuis un Worker éphémère après reconstruction. Le premier tour resté `unknown` sans reçu n'a pas été rejoué. Cette contribution ne qualifie ni l'adoption du module dans le Lab ni son Site B ; voir la [note T38](docs/IMPLEMENTATION-T38.md).

## 28 septembre 2026 — registre navigateur intégré et publié (T-08)

Le registre central propose une page propriétaire générique sur sa propre origine HTTPS. Les lectures de projets et d'installations sont bornées et cloisonnées, sans jeton ; les créations conservent leurs POST et leur CSRF existants. Le navigateur propose le jeton une seule fois au téléchargement et rapproche une réponse perdue par lecture, sans rejouer la création ni tourner le jeton automatiquement. Le callback GitHub redirige les navigations HTML vers cette page et conserve son JSON pour les clients API. Les POST de rotation/révocation reconnaissent maintenant le flux vide du Worker sans accepter de contenu non vide ni affaiblir propriétaire/CSRF. La PR #35 est intégrée, Core main `e51928f` a passé 1 163/1 163 tests CI et le Worker corrigé est publié en version `ba21708c` avec DB et bindings conservés. Les installations Lab ont été créées après autorisation et leurs jetons récupérés par le parcours propriétaire natif, puis stockés dans un coffre DPAPI hors dépôt. Le raccord aux publishers reste ouvert.

## 0.0.1 — en préparation, mise à jour individuelle d'un paquet externe (T38)

Le build peut ajouter au catalogue les métadonnées d'une version externe après vérification de ses trois archives épinglées et de ses exports requis, sans charger son code ni remplacer la version installée. Le gestionnaire existant utilise cette candidate pour son plan de mise à jour. L'adoption explicite peut placer la validation détachée dans un cache adressé par empreinte ; les verrous existants restent lisibles. La version de distribution et d'application passe à `0.0.1` ; la version du contrat Core et des modules natifs reste `0.0.0`, le SDK public reste `1.1.0`. Le starter `module-v0.1.1` est public, tandis que la recette d'adoption et de conservation dans le Lab reste à effectuer. Voir [dépendances et verrous](docs/DEPENDANCES-MODULES.md).

## 28 septembre 2026 — release source initiale `app/v0.0.0` (T36)

Le main `eb97109493b3a945eaa882c216591bc468764014` a passé 1 152/1 152 tests CI. La release source publique [`app/v0.0.0`](https://github.com/creezio/Creezio-D1R2/releases/tag/app/v0.0.0) conserve la version de contrat Core et les modules natifs à `0.0.0`, avec SDK de composition `1.1.0`. Son archive fait 1 532 513 octets, SHA-256 `097a7eb02e5c955a048d014cd120f95672fac5e501c1e960998f13da18a717fb`. Le Site A public a été qualifié sur ce main : API, réponse OpenAI et deux widgets ; la recette complète T36 reste ouverte. Le vrai fork Lab T37 est en cours, et T38 prépare la lecture sans effet d'un paquet module 0.1.1 distinct de la 0.1.0 active. Voir [réalisation et limites T36](docs/IMPLEMENTATION-T36.md).

Le préflight T38 vérifie les archives runtime et validation et leur reçu contre trois empreintes attendues avant d'exposer une candidate au plan de modules ; aucun paquet ni donnée n'est remplacé à cette étape. Dans un checkout neuf, `npm run sdk:build` suit `npm ci --ignore-scripts` avant les commandes locales et Sites ; l'image Docker exécute déjà ce build.

## En cours — publication Cloudflare T32

Pipeline de première publication du Worker/assets et des données D1/R2, relié à l'opérateur local et à la vue d'administration sur `core/t32-cloudflare`. Le module optionnel de livraison possède un transport injecté par l'hôte, un transfert identifié et des suites ciblées ; les nouveaux exports SDK sont publiés dans l’archive immuable `sdk-v1.1.0`. La PR #27 est fusionnée sur main `cca3157ed966e9b6efddf71a920606dac16cd1ff` (arbre `30ce99310513deadaa5371edd0e5a5023cdae03d`). La première publication de l'original et une mise à jour réelle depuis la vue Livraison sont qualifiées sur le compte Cloudflare autorisé : 67 modules et 35 assets vérifiés après l'update, journal livré et registre synchronisé, compte/brouillons/fichiers conservés, réponse OpenAI réelle après rechargement et arrêt Docker propre. La CI Linux du merge d'essai a réussi 1 152/1 152 tests ; le global Windows local reste incomplet après timeout. La démo du starter et les autres reprises restent ouvertes. Voir [réalisation T32](docs/IMPLEMENTATION-T32.md).

Le paquet SDK 1.1.0 ajoute `@creezio/sdk/delivery/context` et `@creezio/sdk/delivery/transport` avec JavaScript ESM et déclarations TypeScript. La PR #28 a été fusionnée sur main `f8dc03c6076109479ad87facedc55234a343dcc4` (arbre `1bb34da8b587f2b8a89b301efda4db8522565f87`, CI 1 152/1 152). Le tag annoté `sdk-v1.1.0` et l’[archive GitHub Release](https://github.com/creezio/Creezio-D1R2/releases/download/sdk-v1.1.0/creezio-sdk-1.1.0.tgz) sont publics : 66 315 octets, SHA-256 `f874f0ed29a41ec45b8f686884b5e2260b9600d9045588174fff8a7fcdd5eeec`. Aucune publication npm n’est prévue.

Qualification Docker poursuivie sur Linux par SSH : arrêt propre et conservation du compte, du brouillon et du fichier vérifiés. Correction de la copie du build entre le conteneur et le volume Docker, avec empreintes, staging borné et restauration du build local. Les tentatives de publication et leurs limites restent détaillées dans la réalisation T32.

Le transport R2 empêche l’ajout implicite de métadonnées de cache par Node lors d’une écriture conditionnelle. La vérification conserve les exigences d’identité du contenu et des métadonnées ; la sonde de publication respecte le refus natif de connexion anonyme.

Le parcours conservateur REQ-3203 est développé dans le pipeline, le journal et le module de livraison, avec artefacts distincts et contrôles ciblés. Sa première recette sur le Worker réel a confirmé la publication, la conservation des témoins D1/R2 et une nouvelle réponse OpenAI ; les autres reprises et la démo possèdent des qualifications séparées à réaliser.

## 27 septembre 2026 — SDK et starter T30 publics

PR #26 fusionnée sur main `e67636635a526daa544ea3573b271e1822f3f4fe`, CI 1 039/1 039. SDK `sdk-v1.0.0` public et starter `module-v0.1.0` public après PR #1 du starter fusionnée sur main `527a1bc1446a529ad6e560e3a25dea13a12001e9`. Démo indépendante vérifiée localement avec API, D1/R2, OpenAI, deux widgets et UI originale ; actions internes des iframes non qualifiées. Le retour OAuth GitHub réel du registre a réussi après correction du transport Worker. Voir [réalisation T30](docs/IMPLEMENTATION-T30.md).

### Détails de la tranche T30

Distribution autonome du SDK public et premier module métier témoin dans le dépôt Creezio-Extension-Starter. Même moteur pour les vues, API, MCP et widgets ; intégration des paquets et qualification indépendante en cours.

Catégories de fichiers avec propriétaire commun aux audiences sur déclaration explicite, sans changer l'isolation des catégories existantes. Installation locale du schéma composé et consommation de paquets avec reçu de validation détaché. Le widget Modules est maintenant vérifié dans ChatGPT avec OAuth natif et CSP activée.

Qualification de l'application indépendante : budget de validation propre à l'ensemble des descripteurs, sans relâcher les bornes individuelles des modules, et actualisation des verrous des compositions distribuées. Le retour OAuth GitHub du registre utilise le transport compatible Worker et refuse les redirections du fournisseur ; la configuration distante et la connexion réelle sont suivies séparément.

Résolution des composants et ports partagés depuis le paquet SDK installé dans l'application indépendante, sans dépendance à un build des sources locales du SDK. Les assets des widgets du starter sont exportés explicitement par son paquet.

Les contrôles agrégés affichent les diagnostics des premiers tests en échec, même quand ils se trouvent hors de la fin du journal. Le TAP complet reste conservé et les critères de réussite restent identiques.

Les outils de lecture à paramètres optionnels conservent leur contrat API dans le chat OpenAI : adaptation explicite du mode fournisseur, sans modifier les entrées ni la validation et les permissions Creezio.

## 27 septembre 2026 — widgets T16

PR #25 intégrée ; main `8736c340`, 1 019 tests locaux et CI réussis. Hôte MCP Apps du chat existant, ressources compilées des modules et comportements message/contexte/direct. Recette locale des widgets de deux modules avec OpenAI réel et reprise d'une mutation après perte de réponse ; qualification Sites et ChatGPT suivie séparément. Périmètre et limites dans [la réalisation T16](docs/IMPLEMENTATION-T16.md).

## 27 septembre 2026 — OpenAI et qualification Sites T15

PR #24 intégrée ; CI candidat/main 993 tests réussis. Module OpenAI relié au chat original et publication du Worker commun sur Sites. Réponses réelles dans le workspace et le front, conservation du compte, du brouillon et de la pièce jointe R2 après mise à jour. Installation opérateur séparée du Worker applicatif ; SQL central généré dans l'enveloppe Drizzle. Le statut statique du catalogue ne confond plus réglage fournisseur inconnu et service absent. Les widgets et la connexion réelle ChatGPT restent à qualifier en T16.

## 27 septembre 2026 — Conversations T14

Priorité de livraison précisée : première app dérivée, module témoin, chat/widgets, déploiement et mise à jour avant les modules non nécessaires. T17–T22 et T26–T29 sont différés sans retrait d'exigence. Le changement de compte ChatGPT autorise une nouvelle cible Sites publique, avec identifiant et provenance conservés par cible.

Module natif Conversations avec historique, recherche, archives, brouillons D1 et pièces jointes privées R2. Le panneau flottant, Chat/Work et le composeur reprennent le Creezio original ; workspace et front utilisent les mêmes opérations HTTP/MCP. Ports de données ordonnés et publication atomique des références de fichiers. PR #23 intégrée, 974 tests locaux/CI réussis et recettes navigateur qualifiées dans le périmètre documenté ; le fournisseur OpenAI et les widgets restent suivis en T15/T16.

## 27 septembre 2026 — Fronts et thèmes T13

Front facultatif avec thèmes standard et ChatGPT-like, registre dynamique de vues/navigation/slots et projection native app. Réemploi des composants Creezio et de la présentation Certivan V5 ; personnalisations sous application/. Client headless sur bindings API/OAuth existants, sans seconde logique métier. PR #22 intégrée ; 953 tests locaux et CI réussis, deux thèmes qualifiés en navigateur local. Recette Sites encore attendue. PR #21 a intégré les documents installés T12 (923 tests locaux/CI et recette navigateur).

## 27 septembre 2026 — Documentation installée T12

PR #20 intégrée, main `037c0a0b` qualifié avec 908 tests locaux et CI. Le lot suivant raccorde README, PRD et changelog de la version installée aux fiches Product Hub et aux mêmes opérations HTTP/MCP administratives. Les révisions locales de travail restent distinctes. Qualification T12 suivie dans docs/TODO.md.

## 27 septembre 2026 — T11 en construction

Le module natif Modules et extensions reprend liste et fiche du Product Hub Creezio. Inventaire vérifié au build, résolution commune, choix explicites, plans acceptés via T06 et état effectif lié à la publication. Les données sont conservées au retrait/désactivation. Les qualifications en cours et limites sont suivies dans docs/TODO.md.

## Non publié

- T-10 en cours : transport MCP officiel séparant admin/app, OAuth natif relié aux comptes existants, consentement original adapté, six modèles privés, plafonds de permissions et gardes fraîches dans les opérations communes. Clients SDK réels et D1 en qualification ; aucune connexion ChatGPT ou Site produit revendiquée par ces seules recettes locales.

- PR #15 intégrée au main `3a4ad091` : tranche interne T-06 (registre, validateurs statiques, exécuteur sous droits natifs, persistance D1, audit et outbox), 723 tests locaux et CI. Les transports et recettes externes restent ouverts.

- PR #16 intégrée au main `56eb0159`, 779 tests locaux et CI : transport HTTP T-06 et client d'opérations ; projection native des vues T-07, SDK de panneaux avec restauration bornée en session, et adaptation de composants de l'interface Creezio originale sous `admin/workspace/`. Recette navigateur locale : deux brouillons restaurés, titres et fil d’Ariane, navigation query-only, ordre/verrou des onglets, portails et retrait après révocation. Une réponse PATCH perdue après commit est retrouvée par lecture de sa clé après reload, sans renvoi. Parité produit complète et qualification hébergée restent ouvertes.

- PR #17 intégrée au main `a8e2a969`, 809 tests locaux et CI : registre central séparé, protocole d'inscription et de déclaration, contrôle de publication avec journal de reprise ; profil Docker local persistant réutilisant le runtime commun. Publication Cloudflare et reprise d'une déclaration acquittée tardivement qualifiées ; installation, redémarrage et sauvegarde/restauration Docker vérifiés sur données synthétiques. Les fournisseurs d'identité du registre nécessitent leur configuration effective ; aucun service central n'est requis pendant le développement local ou l'exécution métier.

- PR #18 intégrée au main `a2f6081f`, 837 tests locaux et CI : interface Rôles & accès reprise du Creezio original, avec Matrice des rôles, Comptes et Journal ; dix opérations déclarées réutilisent les services natifs et la transaction commune T-06. Deltas explicites, journal détaillé paginé et conservation d'une commande en attente avant son émission. Primitives UI publiques et références de champs/export TypeScript correctement distinguées des identifiants de modules. Recette navigateur sur l’artefact corrigé : brouillons conservés pendant une vérification interrompue, reprise de commande après reload sans double écriture, journal et purge au changement d’identité.

- T-06 : compilation statique des schémas d'opérations, registre commun et exécuteur interne sous identité native ; claims, plans métier, résultat, audit et outbox dans un batch D1 protégé. Contrats modifiés et doubles appels ne rejouent pas silencieusement un effet ; un acquittement perdu se réconcilie par lecture. Ports de modules sans SQL, droits implicites ni accès aux champs protégés. Transports métier, approbations, événements et livraison réseau restent à raccorder. Le TODO distingue désormais acquis, reste à faire et chantier actif.

- T-05 : catalogue de modèles composé, SQL central additif avec reçu, ports D1 par module/contexte et gardes fraîches, fichiers privés à mapping explicite et coffre serveur. Les primitives réutilisent les comptes natifs ; aucune opération métier publique ni interface supplémentaire n'est ouverte par cette tranche. Recherche, explorateur et export/restauration restent suivis au backlog.

- T-04 : parcours opérateur d'installation locale explicite, inspection du schéma central et création du premier administrateur avec les services natifs. Aucun compte par défaut, endpoint de provisionnement ou réinitialisation. Configuration locale partagée et exclusion des accès concurrents des commandes officielles ; port du serveur aligné sur son origine.

- T-04 : entrées navigateur natives par audience et SDK de session partagé. Une identité affichée vient d'une lecture de session fraîche ; les mutations et leurs réponses tardives sont coordonnées. Le front peut réutiliser ou remplacer la présentation sans réécrire le backend d'identité. Administration visuelle et recettes hébergées restent distinctes.

- T-04 : transport HTTP natif login/session/logout par audience sélectionnée dans la composition, origine canonique de déploiement, cookies opaques admin/app séparés, contrôles CSRF et corps bornés. GET session ne modifie jamais les cookies, pour qu'une ancienne réponse ne puisse pas effacer une connexion récente. Les services D1 restent communs ; aucune identité GPT, route bootstrap publique ou ouverture implicite des opérations métier. UI, autres transports et recettes navigateur/hébergées restent distincts.

- T-04 : impersonation interne à permission dédiée et credential distinct, acteur réel et sujet conservés, contexte/audience exacts, plafond de droits et durée courte. Aucun droit initial implicite, chaîne, administration des accès ou approbation humaine sous cette identité. Contrats SDK explicites ; transport, interfaces et gardes des futures mutations métier restent à qualifier.

- T-04 : listes administratives paginées des comptes et sessions, suspension/réactivation des comptes humains sans perte de leur état d’inscription, révocation ciblée ou globale. Les lectures revérifient la garde dans leur batch ; les mutations et leur audit restent atomiques, même si l’administrateur révoque sa propre session. Aucun parcours HTTP ou écran ouvert par cette tranche.

- T-04 : comptes de service et tokens API à scopes exacts contexte/audience/permissions ; émission, rotation, révocation et état sous garde administrative fraîche. Résolution machine distincte des sessions humaines, droits actuels en intersection, cibles d’opération copiées avant attente. Transports et interfaces encore à raccorder.

- T-04 : invitations/activations et récupération à usage unique, comptes en attente sans droits implicites, versions de credential et révocation des sessions/capacités après récupération ; émission/révocation réservées à la gestion des accès. Résolveur natif partagé et capture des entrées avant attente. Livraison des liens et transports encore à raccorder.

- T-04 : rôles/contextes/affectations/overrides persistants et droits initiaux explicites ; lecture cohérente et remplacement autorisé du graphe dans D1, protégés par session fraîche, epoch et claim atomique. Les canaux HTTP/MCP et interfaces restent à raccorder.
- T-04 : primitives d'identité, moteur pur de droits, huit modèles access et SQL central ; bootstrap à usage unique, comptes/sessions D1 révocables et admission avant KDF. Contrat/docs/six suites du module présents ; transports de connexion, droits persistants, invitations/reset et interfaces restent en construction.
- Reprise GitHub : PR #1 à #4 intégrées après régularisation Actions, revue technique, CI des candidats et de chaque nouveau main. PR #5 qualifie le refus d'un candidat volontairement invalide ; le test témoin est retiré, sans modifier les contrôles ni le runtime.
- Runtime T-03 : Worker commun, composition statique contrôlée, adaptateurs DB/BUCKET, vue initiale et module témoin de qualification. Opérations protégées fermées jusqu'au raccordement de l'identité native ; aucune publication produit.
- Démarrage de T-01 après GO : contrôleurs documentaires et de gouvernance, tests de refus et empreinte des sources. Workflow candidat sans droits de publication.
- Contrats de widgets : plusieurs types/instances par module et modes message/contexte/direct déclarés par action.

Le CMS n'est pas encore livré. Les protections distantes et les qualifications runtime restent distinctes de ces réalisations locales ; voir [P0](docs/IMPLEMENTATION-P0.md) et [TODO](docs/TODO.md).

## En cours — contrats et dépendances de modules

- Contrat de dépendances commun à toutes les origines : déclarations, résolution/verrou, contributions facultatives, protection des consommateurs et conservation des données.
- Six exigences supplémentaires, critères des stories/lots, guides IA et gabarits de revue alignés ; gestionnaire et recettes hébergées encore à construire.
- Poursuite locale autorisée pendant le blocage GitHub Actions, sans changement des protections de fusion.
