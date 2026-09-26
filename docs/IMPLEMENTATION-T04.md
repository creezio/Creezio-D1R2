# T-04 — Identités et droits natifs

Travail sur `core/t04-identity`, depuis le runtime T-03 accepté `4d97e9e`. Le lot [T-04](TODO.md#T-04) reste **en cours** : fondations, persistance D1 et services de comptes sont présents ; HTTP, droits persistants et interfaces restent à construire. [REQ-0401](EXIGENCES.md#REQ-0401), [REQ-0402](EXIGENCES.md#REQ-0402) et [REQ-0403](EXIGENCES.md#REQ-0403) restent partiellement ou non qualifiées selon leurs parcours.

## Tranches et critères

- Fondations : tokens opaques, dérivation des mots de passe compatible, moteur de décision pur ; tests positifs et refus, exécution workerd, revue indépendante.
- Persistance : modèles du module natif access, génération SQL centrale et journal inspectable, adaptateur D1 paramétré. Ce prérequis de [T-05](TODO.md#T-05) est avancé avec T-04 ; fichiers, recherche, coffre et modèles métier restent T-05. Aucun SQL de transformation dans un module, aucune base produit en mémoire.
- Comptes : installation du premier administrateur autorisée explicitement, comptes actifs/inactifs, sessions révocables, activation/reset et invitations à usage unique, identités machine limitées.
- Autorisations effectives : résolution fraîche depuis D1, droits au commit, impersonation contrôlée et auditée, raccordement aux opérations communes. Le protocole OAuth/MCP complet reste [T-10](TODO.md#T-10).
- Interfaces : connexion native, état de session et gestion des accès, purge lors du changement d'identité, six suites du module access puis recettes Sites/Cloudflare.

## Fondations présentes

`core/identity/tokens.ts` émet 256 bits aléatoires via Web Crypto. Session, token API, invitation, activation, reset et installation ont des formats séparés. Seule l'empreinte liée à cet usage est destinée au stockage ; le secret est délivré au destinataire prévu, sans journalisation. Versions inconnues, mauvaise longueur, encodage non canonique et utilisation dans un autre canal sont refusés.

`core/authorization` évalue un état **déjà résolu par le serveur**, jamais les champs d'une requête client. L'acteur, le credential, les rôles, le contexte, l'audience et la politique de l'opération se recoupent ; le jeton ne crée pas de droit absent du compte. Le moteur n'a ni cache ni I/O et ne prétend pas authentifier son entrée.

Les ajustements suivent l'ordre défauts/héritage, overrides du rôle, agrégation des rôles, puis overrides du compte. Un compte peut recevoir une exception autorisée au rôle ; les limites d'audience, de contexte, d'acteur et de portée du credential restent impératives. Les conflits au même niveau et les graphes incomplets/cycliques échouent de manière déterministe. Une session humaine ou une délégation OAuth humaine peut être éligible à confirmer ; un token d'automatisation ne remplace pas la validation humaine. Cette décision n'est jamais un reçu d'approbation.

## Qualification cryptographique

La sonde protégée de Sites a refusé **PBKDF2-HMAC-SHA256 à 600 000 itérations** le 26 septembre 2026 : `NotSupportedError`, plafond annoncé de 100 000. Source de sonde `54b5d6950434674dca684686d7ec83ab037e720a`, version 6 ; aucune entrée secrète ou libre, aucun compte créé, appel sans accès applicatif refusé 401. Le [rapport Sites](QUALIFICATION-SITES.md) conserve cette distinction entre simulateur et hôte.

La comparaison bornée avec `@noble/hashes@2.4.0` est exécutée localement puis sur Sites version 7, source de sonde `890b2a7aa9d378c107c3207e53f2c3c6329d4f8e`. Scrypt N=32768/r=8/p=3 et Argon2id m=19456 KiB/t=2/p=1 produisent les mêmes empreintes dans les deux environnements. Scrypt est comparé à Node crypto ; le vecteur Argon2id du RFC 9106 §5.3 est aussi vérifié. La requête anonyme reçoit 401, un profil inconnu 400. Aucun compte n'est créé.

Le profil retenu par `core/identity/password.ts` est **Argon2id v19, 19 MiB, deux passes, parallélisme 1**, avec sel aléatoire de 16 octets et sortie de 32 octets. Il suit le seuil documenté par [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Le format PHC est strict : versions, coûts faibles ou énormes, encodages non canoniques et entrées de plus de 1 024 octets UTF-8 sont refusés avant calcul. Aucun repli PBKDF2 faible, aucune transformation silencieuse du mot de passe. La politique de création appartient au service de comptes décrit ci-dessous : elle impose désormais la longueur minimale et la borne UTF-8, sans modifier le mot de passe.

Le calcul est synchrone et bloque son isolate ; un timeout JavaScript ne le préempte pas. L'horloge figée durant le CPU sur l'hôte rend inadaptée une promesse d'interruptibilité fondée sur les fonctions async de cette bibliothèque. Les buffers KDF déclarés (19 MiB pour Argon2id) ne mesurent pas le heap total du CMS. Les durées de sonde depuis le poste incluent réseau et démarrage : 2 536 ms pour Argon2id, 1 030 ms pour scrypt sur cet appel unique, sans conclusion comparative de CPU. Les tests locaux ne constituent pas une charge de production ou un p99.

Le [README de la bibliothèque verrouillée](https://github.com/paulmillr/noble-hashes/blob/2.4.0/README.md#security) décrit la portée de ses audits ; il ne faut pas annoncer l'Argon2id de cette version comme couvert par l'audit historique. Vecteurs, revue et tests d'intégration se complètent, sans certifier une implémentation cryptographique. Le parcours complet et le compte Cloudflare personnel restent à qualifier.

## Garanties restantes à construire

Un batch D1 est atomique mais un UPDATE sans ligne modifiée n'annule pas ses autres requêtes. La consommation des capacités bootstrap/reset/invitation et tous leurs effets doivent dépendre d'une même revendication unique dans le batch. La création d'une session après le calcul cryptographique doit recontrôler l'état et la version du compte.

Une décision pure ou un contrôle avant lecture ne remplace pas la garde fraîche au commit. Les droits/credentials et l'écriture concernée doivent être revalidés dans le même stockage transactionnel. Aucun batch ne promet une transaction entre deux D1, R2 et un fournisseur externe ; ces cas restent des protocoles d'opérations à qualifier dans leurs lots.

Le dispatcher protège toujours ses routes par refus. Les services de comptes décrits ci-dessous n'ont pas encore de transport HTTP, cookie ni interface. Les harnais de qualification et leurs données synthétiques n'entrent pas dans le Worker produit. L'impersonation, les rôles persistants et leurs mutations protégées restent à construire.

## Contrôles et impact

`npm run test:identity` exécute les tests ciblés ; la suite identity est requise par l'agrégateur, et son absence ne peut réduire silencieusement la couverture. Les preuves finales se rattachent à une révision et aux artefacts exacts hors du commit source. Une qualification de primitive sur la sonde ne qualifie pas le futur parcours de connexion complet.

Le harnais local workerd exécute aussi les **vraies primitives du cœur** : création PHC, vérification correcte/incorrecte, refus d'un coût modifié, émission et empreinte de token, décision positive puis refus sur un instantané serveur désactivé. Il vérifie le graphe sans imports Node et ferme son runtime en fin de test. Aucun stockage de comptes factice ni middleware de connexion n'est présenté comme qualifié.

PRD, exigences et stories inchangés : il s'agit d'implémenter les capacités approuvées. TODO, repères de fichiers, changelog et contrôleurs reflètent la tranche effective. Le module access possède maintenant son contrat, ses docs et ses six suites ; ses surfaces absentes sont contrôlées et restent explicitement incomplètes.

## Persistance et services de comptes

Le [module natif access](../extensions/native/access/README.md) possède huit modèles privés : principals, human_accounts, password_credentials, sessions, bootstrap, authorization_state, access_audit et auth_throttles. Tous leurs champs sont protégés. `module/models.json` est canonique ; `npm run data:access` régénère explicitement le manifeste et [le SQL central](../data/schema/access.sql). `npm run check:data` refuse toute dérive de ces artefacts sans réécriture. Le [générateur](../scripts/data/README.md) impose clés, types stockés, contraintes et relations prises en charge ; son inspection D1 en lecture seule refuse les définitions absentes, différentes ou supplémentaires. Il ne répare rien et ne constitue pas encore le journal d'évolution de T-05.

`core/identity/d1-store.ts` utilise uniquement des requêtes paramétrées et des batches D1. Le provisionnement est une action du responsable qui détient le binding ; aucun compte par défaut, endpoint anonyme ou effet de démarrage. La capacité bootstrap est opaque, limitée dans le temps et stockée sous empreinte. L'acquisition d'un nonce unique conditionne tous les effets : compte, credential, repère d'installation et audit. Un échec tardif annule le batch ; une acquisition à zéro ne produit aucun de ces effets. Un challenge expiré peut être explicitement remplacé avant consommation ; le marqueur consommé ferme durablement ce parcours. Le premier compte est désigné pour l'installation, sans owner fallback ni droit implicite tant que les rôles ne sont pas construits.

`core/identity/accounts.ts` applique le protocole natif : identifiant ASCII de 3 à 254 caractères, casse normalisée, mot de passe d'au moins 15 points de code et au plus 1 024 octets UTF-8. Le mot de passe n'est ni rogné ni normalisé ; une liste de mots de passe compromis n'est pas encore intégrée. Une fenêtre D1 limite les essais globaux et par identifiant pseudonymisé avant calcul. Le sixième essai sur un même identifiant dans la minute est refusé, même si le mot de passe est correct. Pour un compte absent, un vérificateur synthétique réalise le même coût KDF ; cela ne promet pas un temps réseau constant. La purge retire au maximum 32 fenêtres expirées par admission, sans scheduler.

Après vérification cryptographique, l'insertion de session recontrôle le compte, son identifiant, les versions, le PHC exact et l'expiration avec l'heure D1. Le token n'est retourné qu'après insertion et lecture fraîche réussies. Seule son empreinte est conservée ; la projection de session n'inclut ni digest ni PHC. Les audiences admin/app sont distinctes ; l'authentification sur une audience ne donne aucun droit de module. Déconnexion, statut désactivé, expiration ou version modifiée invalident les lectures suivantes. Le snapshot de session n'est pas une autorisation au commit.

Les tests indépendants utilisent de vrais D1 Miniflare : concurrence bootstrap, UPDATE zéro, rollback sur contrainte tardive, modifications entre KDF et émission, révocation, expiration, throttling concurrent, purge bornée et conservation après redémarrage. Le service est aussi exercé de bout en bout dans un harnais interne (provisionnement, bootstrap, login, logout), sans route produit ni cookie. Les six suites du module sont exécutées par l'agrégat ; backend/package/docs contrôlent modèles et sources, UI/API-MCP/widgets prouvent leur absence dans cette tranche. Les parcours correspondants restent à implémenter puis à qualifier sur Sites et Cloudflare.
