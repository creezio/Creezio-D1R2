# Docker local (développement et tests)

Cet adaptateur exécute les commandes locales existantes dans un conteneur Node 24. Miniflare/workerd conserve D1 et R2 dans le volume nommé `creezio-local_local-state`, monté sur `/app/.wrangler` ; l'état reste sous `/app/.wrangler/state`. Le montage partage aussi `creezio-local.lock` entre le serveur et l'outil d'installation exécutés dans des conteneurs distincts. L'identité des bindings `DB` et `BUCKET`, leur origine et le verrou de stockage viennent de `scripts/local/config.mjs`. Aucun compte Cloudflare n'est nécessaire.

Depuis la racine du dépôt :

```sh
node adapters/docker/build.mjs
docker compose -f adapters/docker/compose.yaml run --rm --no-deps --entrypoint node app scripts/local/install.mjs inspect
docker compose -f adapters/docker/compose.yaml run --rm --no-deps --interactive --tty --entrypoint node app scripts/local/install.mjs install
docker compose -f adapters/docker/compose.yaml up -d --no-build
```

Ouvrir `http://127.0.0.1:5173/access/admin`. L'installation interactive demande le premier compte et une confirmation explicite. Aucun mot de passe n'est fourni par image, variable ou argument. Le proxy TCP sur le port interne 5174 transmet HTTP et WebSocket au serveur local qui conserve son origine canonique `127.0.0.1:5173`. Le port publié reste limité au loopback de l'hôte.

Le lanceur de build exige un checkout Git propre, exporte dans `.creezio/docker-source.json` l'identité du commit, de l'arbre et l'inventaire des octets source, puis construit l'image sans y copier `.git`. Le manifeste du workspace SDK est présent avant `npm ci` ; le SDK est compilé dans l'image avant l'installation ou le démarrage applicatif. L'image vérifie le manifeste source avant de démarrer ; les lectures de provenance dans le conteneur revérifient les fichiers. Un `docker compose build` direct avec un manifeste absent ou périmé échoue. Le dossier `.creezio` entier ne passe pas dans l'image : seul ce manifeste est inclus.

`docker compose stop app` envoie `SIGUSR2` au lanceur Node : celui-ci ferme le Worker, le relais et le verrou du volume avant de sortir. Le `SIGTERM` ordinaire est réservé à Miniflare, dont le gestionnaire termine immédiatement le processus sans attendre cette libération. Conserver `stop_signal: SIGUSR2` et la période de grâce de 45 secondes lors d'une adaptation de ce profil.

Les widgets utilisent une seconde origine d'affichage, `http://127.0.0.1:5175`, publiée uniquement sur le loopback hôte. Le relais statique démarre et s'arrête dans le même conteneur avec le serveur ; il ne possède ni D1, ni R2, ni session, ni clé fournisseur. Il n'ajoute aucune instance métier ni service tiers à maintenir.

L'opérateur local de livraison, lorsqu'il est activé, garde son origine canonique `http://127.0.0.1:5176`. Un second pont TCP interne sur 5177 expose uniquement ce service au loopback de l'hôte ; ni le port de Miniflare ni celui de l'opérateur ne deviennent publics sur l'interface réseau du conteneur.

Le build Cloudflare naît dans le système de fichiers du conteneur, tandis que son artefact durable se trouve dans le volume `.wrangler`. L'opérateur copie les seuls fichiers du Worker et des assets dans un staging borné du volume, vérifie leurs empreintes, puis publie ce staging par renommage sur ce même volume. Un staging du même transfert peut être repris ; un artefact partiel ou étranger est refusé pour inspection plutôt qu'écrasé. L'ancien build local est restauré après publication vérifiée.

Pour vérifier la persistance, installer un compte synthétique avec la commande ci-dessus, puis arrêter le service et écrire un objet R2 synthétique via le même binding local et le même verrou :

```sh
docker compose -f adapters/docker/compose.yaml stop app
docker compose -f adapters/docker/compose.yaml run --rm --no-deps --entrypoint node app adapters/docker/storage-probe.mjs write
docker compose -f adapters/docker/compose.yaml up -d --no-build
```

La sonde exige que D1 soit `initialized`, écrit seulement la clé `qualification/t31/synthetic-object.txt` et vérifie ses octets et son SHA-256. Elle ne remplace pas un test d'autorisation par l'API applicative. Arrêter puis recréer **le conteneur seulement** :

```sh
docker compose -f adapters/docker/compose.yaml stop app
docker compose -f adapters/docker/compose.yaml up -d --no-build --force-recreate
```

Vérifier ensuite la connexion du compte et, service arrêté, relire D1/R2 avec `storage-probe.mjs read`. Comparer les empreintes d'un export du volume pris à l'arrêt. `docker compose down` conserve le volume ; `down --volumes` le détruirait. L'image contient les sources au moment de sa construction : après un changement de code, reconstruire l'image, puis recréer le conteneur sans toucher au volume. Ne jamais lancer l'inspection, l'installation ou la sonde pendant que le serveur utilise ce même volume ; le verrou local refuserait cet accès concurrent.

Diagnostic en lecture seule : `docker info`, `docker compose -f adapters/docker/compose.yaml config`, `docker compose -f adapters/docker/compose.yaml ps`, `docker compose -f adapters/docker/compose.yaml logs app` et `docker volume inspect creezio-local_local-state`. En cas de daemon indisponible, ne pas démarrer de service utilisateur implicitement. Un état `local_busy` demande de vérifier le processus propriétaire ; ne pas supprimer le verrou ou le volume pour forcer le démarrage.

Ce profil est réservé au développement/test local. Il ne publie rien sur Cloudflare et n'inclut ni ordonnanceur ni service tiers. La recette réelle du 27 septembre 2026 a vérifié l'installation, D1/R2, le redémarrage, la recréation et la restauration du volume ; son rapport conserve les empreintes et les limites de qualification.

## Hôte Linux distant

Les mêmes commandes fonctionnent sur un serveur Linux avec Docker et Compose ; Docker Desktop sur le poste client n’est pas nécessaire. Définir `COMPOSE_PROJECT_NAME` à un nom propre à cette application avant le build et les commandes Compose pour isoler son image, son conteneur et son volume. Les ports restent en loopback sur le serveur. Depuis le poste client, ouvrir un tunnel SSH vers les trois origines :

```sh
ssh -N -L 5173:127.0.0.1:5173 -L 5175:127.0.0.1:5175 -L 5176:127.0.0.1:5176 user@host
```

Vérifier que ces ports sont disponibles aux deux extrémités. Accéder ensuite aux mêmes adresses locales dans le navigateur ; fermer ce tunnel à la fin de la recette. Ne modifier ni les volumes ni les services déjà présents sur le serveur.
