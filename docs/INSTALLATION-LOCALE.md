# Installer le premier compte local

Ce parcours initialise explicitement une installation locale neuve. Il fonctionne hors ligne, sans compte Cloudflare ni fournisseur externe. Le développement local reste distinct de la publication officielle et de son enregistrement Creezio.

Avec Node 24 et les dépendances verrouillées déjà installées :

1. Arrêter le serveur local de cette installation.
2. Exécuter `npm run access:inspect` pour connaître l'état de sa base.
3. Exécuter `npm run access:install` dans un terminal interactif. Vérifier la cible et l'empreinte du schéma affichées, saisir le compte et le mot de passe, puis confirmer la création proposée.
4. Lancer `npm run dev` et ouvrir l'entrée native `/access/admin`. Pour le build courant, utiliser `npm run build` puis `npm start`.

Il n'existe aucun compte ou mot de passe par défaut. Le mot de passe est saisi sans affichage, conservé seulement pendant l'opération, jamais accepté en argument, variable d'environnement ou fichier. Le service natif impose au moins 15 points de code et au plus 1 024 octets UTF-8 ; une saisie trop longue est refusée, pas tronquée. L'installation ne connecte pas automatiquement le compte et ne vérifie pas une adresse email.

## Une même cible locale

Les commandes partagent la configuration locale, le binding `DB`, son identifiant et le chemin `.wrangler/state/v3/d1`. Le bucket local garde également son identité commune ; cette installation n'écrit aucun objet R2. Le couple logique doit concorder avec `.openai/hosting.json`.

L'origine par défaut est `http://127.0.0.1:5173`. Pour choisir un autre port local, définir `CREEZIO_APP_ORIGIN` avec une origine HTTP canonique sur `127.0.0.1` ; les commandes officielles utilisent son port. Un build créé pour une autre origine est refusé par `npm start` : le reconstruire avec la configuration souhaitée. Aucun repli silencieux vers une autre base ou un compte Cloudflare.

Les commandes officielles de développement, démarrage et installation prennent un verrou commun avant d'ouvrir le stockage. Le verrou reste détenu jusqu'à la fermeture du moteur. Il ne constitue pas un verrou système contre une invocation manuelle de Wrangler ou un autre outil SQL : fermer également ces outils avant d'installer.

Si la composition contient des widgets, `dev` et `start` lancent également leur relais statique dans le même processus de pilotage, sur `http://127.0.0.1:5175` par défaut. Cette origine doit rester distincte de celle de l'application ; `CREEZIO_WIDGET_SANDBOX_ORIGIN` permet de choisir un autre port loopback avant le build. Le relais reçoit uniquement les profils de ressources compilés, sans données persistantes ni identifiants applicatifs, et s'arrête avec le serveur. Un port indisponible bloque le démarrage sans changer de cible en silence.

Un verrou laissé après un arrêt brutal n'est jamais effacé automatiquement. Examiner son propriétaire et vérifier qu'aucun processus n'utilise encore cette installation avant de retirer ce seul fichier de verrou. Ne jamais supprimer `.wrangler/state` pour résoudre un verrou. Les liens et jonctions sur les chemins du stockage sont refusés.

## États et reprise

L'inspection ne modifie ni schéma ni données applicatives ; l'ouverture de Miniflare et le verrou peuvent créer leurs fichiers techniques locaux. L'absence des seules tables Access ne suffit pas à déclarer une base neuve : une base étrangère, partielle ou divergente est refusée.

La création du schéma courant et celle du compte sont deux étapes distinctes. Le SQL central doit correspondre aux modèles approuvés ; il n'y a ni `IF NOT EXISTS` masquant une dérive, ni réparation implicite, ni transformation d'une autre architecture. Un arrêt après la première étape peut donc laisser un schéma conforme sans compte.

La création du premier administrateur réutilise les services natifs. Ils n'attribuent que le droit initial explicite de gestion des accès, sans wildcard ou droit d'impersonation. Une capacité de création encore vivante ne peut pas être remplacée ; si le processus l'a perdue, attendre son expiration puis relancer explicitement. Le marqueur consommé ferme définitivement l'installation, même si les droits du compte ont ensuite été modifiés. Une relance ne remplace ni compte ni mot de passe.

Une erreur de réponse ne prouve pas qu'aucune écriture n'a eu lieu. L'outil distingue son résultat de l'état observé et ne réessaie pas automatiquement une mutation. Si l'état ne peut pas être établi, conserver la base et refaire une inspection ; aucune suppression compensatoire.

## Portée

L'outil est réservé au responsable qui possède déjà le stockage du déploiement. Miniflare utilise un proxy local pour D1 ; son entrée HTTP de l'outil répond toujours 404, sans route de provisionnement. Aucun handler de test n'est ajouté au Worker applicatif et aucun serveur ne reste nécessaire après la commande.

Les adaptateurs Sites et Cloudflare devront qualifier le même protocole avec leurs accès de déploiement. Ce parcours local ne les annonce pas disponibles. L'administration des comptes suivants, les invitations, les opérations métier et le workspace conservent leurs tâches dans le [backlog](TODO.md) et l'[état T-04](IMPLEMENTATION-T04.md).
