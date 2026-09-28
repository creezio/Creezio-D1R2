# Registre central Creezio

Ce Worker séparé appartient au mainteneur Creezio. Chaque application utilise le [protocole public](../../sdk/registry/types.ts) et son token d'installation pour déclarer ses publications ; elle n'héberge pas une copie du registre. Le registre ne reçoit aucune donnée métier, conversation ou clé fournisseur.

## Installation du service

Créer un D1 dédié et définir `CLOUDFLARE_ACCOUNT_ID`, `CREEZIO_REGISTRY_DATABASE_ID`, `CREEZIO_REGISTRY_WORKER_NAME` et `CREEZIO_REGISTRY_ORIGIN` (origine HTTPS canonique sans slash final). `CLOUDFLARE_API_TOKEN` reste dans l'environnement de l'opérateur, jamais dans les fichiers versionnés ni dans le Worker. Le compte doit autoriser la gestion du Worker et de ce D1.

1. `npm run registry:build` compile le service indépendant dans `.quality/registry/worker.mjs` et calcule son empreinte.
2. `npm run registry:configure` écrit la configuration sans secret dans `.creezio/registry/wrangler.json`.
3. `npm run registry:operator -- inspect`, puis `initialize` uniquement sur le D1 vide dédié. Aucune réparation automatique d'une base existante.
4. `node node_modules/wrangler/bin/wrangler.js deploy --config .creezio/registry/wrangler.json` publie le registre. Ce bootstrap du service central est indépendant du contrôle de publication des applications.
5. Avec `CREEZIO_REGISTRY_MAINTAINER_EMAIL` explicite, `npm run registry:operator -- bootstrap` crée une seule identité d'opérateur et un accès de quinze minutes. Capturer sa sortie JSON directement dans un coffre local privé : elle contient un secret. Ce bootstrap n'atteste pas une vérification email et n'est pas exposé par HTTP.

L'opérateur authentifié peut créer le projet puis son installation avec le cookie propriétaire, l'origine exacte et `X-Creezio-Request: 1`. Le token d'installation retourné une fois est distinct de la session propriétaire. Rotation et révocation sont limitées aux projets du propriétaire ; leurs POST exigent zéro octet de contenu, même si le Worker expose un flux vide non nul.

Le parcours navigateur du registre est servi par ce Worker à `/`, sur la même origine HTTPS que l'API. Le propriétaire vérifié y retrouve ses projets, puis les installations d'un projet ; une liste est bornée à 100 entrées et signale explicitement si l'inventaire est incomplet. Le navigateur conserve le cookie `HttpOnly` sans l'exposer au script. Les POST de création réutilisent l'origine exacte et l'en-tête CSRF ; le jeton rendu une fois par création ou rotation est proposé au téléchargement en mémoire, sans stockage navigateur ni affichage. Après une réponse perdue, l'écran relit les identifiants avant/après et bloque les cas absents ou ambigus : il ne rejoue jamais un POST et ne fait pas de rotation automatique. Une rotation volontaire invalide l'ancien jeton. La page ne remplace pas le contrôle de publication de l'application.

Pour l'inscription publique, configurer `GITHUB_CLIENT_ID` et le secret Worker `GITHUB_CLIENT_SECRET`, avec le callback `${REGISTRY_ORIGIN}/v1/owners/github/callback`, ou un binding `EMAIL_DELIVERY` vers un transport explicitement configuré. Sans fournisseur, le parcours correspondant répond `configuration_unavailable` ; aucun propriétaire n'est vérifié artificiellement. Ces paramètres ne donnent aucun accès d'assistance au code des apps.

Le callback GitHub renvoie toujours le JSON existant aux clients API. Pour une navigation de navigateur avec `Accept: text/html`, il pose le même cookie et redirige vers `/` sans placer de secret dans l'URL. L'URL source d'un projet est une URL HTTPS canonique, par exemple celle de son dépôt ; le registre ne stocke pas de données métier ni de clé fournisseur.

## Publication des applications

Le [client](../../core/registry/client.ts) reste côté serveur. La [gate](../../core/registry/publication.ts) appelle le publisher seulement après un contrôle valide et un enregistrement durable de la tentative. Une livraison déjà réalisée mais non déclarée est réconciliée sans republier. Le [journal fichier](../../core/registry/file-journal.ts) sert aux adaptateurs Node locaux ; il n'entre dans aucun Worker. Une tentative interrompue à résultat inconnu exige l'inspection de la livraison avant confirmation. Le développement local et les requêtes métier ne dépendent pas de ce service.

Les endpoints de déclaration enregistrent une déclaration authentifiée, pas une preuve indépendante que l'URL appartient au propriétaire. La vérification effective de la livraison relève de chaque publisher officiel Sites/Cloudflare, avec son reçu et l'empreinte de l'artefact.

Contrôles : `npm run test:registry` et `npm run typecheck`. [Portée et preuves T-08](../../docs/IMPLEMENTATION-T08.md). Le déploiement utilise la [configuration Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/) et les batches paramétrés de l'[API D1](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/).
