# Changelog

## Préparation SDK 1.2.0 — journal et contrats de connecteurs (T30)

Le paquet distribue le journal public des commandes de panneau, les descripteurs de connecteurs GET et le type public limité de configuration des secrets. Les exports SDK 1.1 de livraison restent disponibles. Les changements fonctionnels sont intégrés par PR #44/#45 ; cette préparation fixe leurs documents de distribution, sans nouvelle fonctionnalité, changement de données ni adoption automatique par une app. Le paquet final sera construit depuis le main de la PR de release, puis son téléchargement sera vérifié avant publication. Voir [T30](docs/IMPLEMENTATION-T30.md).

## En cours — connecteurs externes déclaratifs et n8n (T26)

Le SDK candidat 1.2 ajoute les descripteurs et le port de connecteur génériques. Les modules déclarent leurs ressources GET et leurs modèles privés de configuration/coffre ; le Worker les compose sans branche spéciale par fournisseur. Le module n8n configure une instance externe et propose la lecture autorisée des workflows/exécutions. Les mutations distantes, callbacks et recettes fournisseur restent ouverts ; aucun n8n n'est embarqué. Voir [T26](docs/IMPLEMENTATION-T26.md).

## En cours — Support, pages, analytics et catalogue (T19/T21/T22/T25)

Trois modules natifs rejoignent la composition du socle et des thèmes : tickets et discussions Support, pages avec brouillons/snapshots publiés et navigation, tableaux Analytics alimentés par les événements déclarés. Les interfaces réutilisent les composants du Creezio original. Le Catalogue est une extension métier optionnelle avec son profil de qualification, ses produits/catégories, son port public et deux widgets liste/fiche. Les schémas sont générés centralement et les suites propres/intégrations rejoignent la CI ; voir les documents de réalisation pour les recettes acquises et les raccords encore ouverts.

## En cours — messagerie partagée et journal SDK (T18/T30)

Un utilisateur autorisé retrouve les mêmes boîtes, brouillons et pièces jointes dans le workspace et le front. Les modèles sont rattachés au principal et au contexte ; les permissions restent distinctes par audience. Le SDK candidat 1.2 expose un journal de mutation qui conserve la clé avant émission, bloque le nouvel envoi après une issue incertaine et vérifie le statut sans replay. Les archives SDK déjà publiées restent inchangées. Voir [T18](docs/IMPLEMENTATION-T18.md) et [le contrat SDK](sdk/operations/README.md).

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
