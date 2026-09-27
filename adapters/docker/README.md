# Docker local (développement et tests)

Cet adaptateur exécute les commandes locales existantes dans un conteneur Node 24. Miniflare/workerd conserve D1 et R2 dans le volume nommé `creezio-local_local-state`, monté sur `/app/.wrangler` ; l'état reste sous `/app/.wrangler/state`. Le montage partage aussi `creezio-local.lock` entre le serveur et l'outil d'installation exécutés dans des conteneurs distincts. L'identité des bindings `DB` et `BUCKET`, leur origine et le verrou de stockage viennent de `scripts/local/config.mjs`. Aucun compte Cloudflare n'est nécessaire.

Depuis la racine du dépôt :

```sh
docker compose -f adapters/docker/compose.yaml build
docker compose -f adapters/docker/compose.yaml run --rm --no-deps --entrypoint node app scripts/local/install.mjs inspect
docker compose -f adapters/docker/compose.yaml run --rm --no-deps --interactive --tty --entrypoint node app scripts/local/install.mjs install
docker compose -f adapters/docker/compose.yaml up -d --no-build
```

Ouvrir `http://127.0.0.1:5173/access/admin`. L'installation interactive demande le premier compte et une confirmation explicite. Aucun mot de passe n'est fourni par image, variable ou argument. Le proxy TCP sur le port interne 5174 transmet HTTP et WebSocket au serveur local qui conserve son origine canonique `127.0.0.1:5173`. Le port publié reste limité au loopback de l'hôte.

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
