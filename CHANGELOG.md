# Changelog

## En cours — publication Cloudflare T32

Pipeline de première publication du Worker/assets et des données D1/R2, relié à l'opérateur local et à la vue d'administration sur `core/t32-cloudflare`. Le module optionnel de livraison possède un transport injecté par l'hôte, un transfert identifié et des suites ciblées ; les nouveaux exports SDK sont une candidate **1.1.0 non publiée**, distincte de `sdk-v1.0.0`. La PR #27 est ouverte en brouillon. La première publication de l'original et une mise à jour réelle depuis la vue Livraison sont qualifiées sur le compte Cloudflare autorisé : 67 modules et 35 assets vérifiés après l'update, journal livré et registre synchronisé, compte/brouillons/fichiers conservés, réponse OpenAI réelle après rechargement et arrêt Docker propre. La CI Linux du merge d'essai a réussi 1 152/1 152 tests ; le global Windows local reste incomplet après timeout. La démo du starter, la release SDK 1.1.0 depuis main et l'intégration restent ouvertes. Voir [réalisation T32](docs/IMPLEMENTATION-T32.md).

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
