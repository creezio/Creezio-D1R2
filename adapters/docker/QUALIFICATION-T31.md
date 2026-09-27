# Recette T31 — Docker local réel

Exécutée le 27 septembre 2026 sur le candidat T31 et le runtime issu de `56eb0159e6651df0f774b77146e16da51a0e2c36`. Docker Desktop 4.90.0 et moteur Linux 29.7.2. Installation, connexion HTTP, D1/R2, verrou concurrent, redémarrage, recréation et restauration ont été vérifiés. L'image testée ne qualifie pas les sources T08 en cours d'écriture, sans import dans le Worker applicatif. Le rapport de preuve `CREEZIO-T31-DOCKER-RECETTE-2026-09-27.md` est conservé hors dépôt.

## Préconditions

1. Utiliser un checkout propre au candidat T31 à qualifier avant fusion ; conserver le candidat T07 séparé.
2. Vérifier que Docker Desktop fonctionne, que `docker info` répond et qu'il reste au moins 20 Gio libres avant le build et tout export de volume.
3. Vérifier qu'aucune application de l'utilisateur n'occupe le port hôte `127.0.0.1:5173` ni le volume `creezio-local_local-state`.
4. Utiliser le même `configuration/composition.json`, le même lock et les bindings `DB`/`BUCKET` pour le build, l'installation et le lancement. Aucun compte Cloudflare ni service tiers.

## Parcours positif

1. Depuis la racine du checkout, valider `docker compose -f adapters/docker/compose.yaml config`, puis construire une fois l'image. Relever son ID et l'espace disque utilisé.
2. Exécuter `scripts/local/install.mjs inspect` dans le service `app` arrêté : état `fresh` attendu sur un volume neuf. Exécuter ensuite `install` en terminal interactif avec un compte synthétique et confirmer la cible affichée. Une seconde inspection doit répondre `initialized`; un second `install` doit être refusé sans modifier le compte.
3. Démarrer `app` et vérifier le front et `/access/admin` à `http://127.0.0.1:5173`, la connexion native, puis une écriture et lecture D1 autorisées. À l'arrêt, créer un objet R2 témoin avec `storage-probe.mjs write` via le binding réel et le verrou local, le relire et noter ses octets/empreinte. Vérifier qu'une session sans cookie ne lit pas les données d'identité. L'autorisation de fichiers par API applicative reste une qualification distincte quand cette route sera disponible.
4. Arrêter le service. Le conteneur ne doit plus tenir le volume. Redémarrer sans reconstruire l'image, puis recréer uniquement le conteneur avec `--force-recreate` sans `--volumes`. Vérifier de nouveau le compte, les données D1, l'objet R2 et ses octets/empreinte.
5. À l'arrêt, exporter le volume complet `.wrangler` vers un emplacement temporaire maîtrisé, relever l'empreinte de l'archive, puis restaurer dans un **nouveau volume de recette**. Démarrer la même image avec ce volume restauré, à la même origine et avec le premier service arrêté ; vérifier le compte, D1 et R2. Retirer le volume de recette et l'export temporaire après validation et après avoir vérifié qu'aucun conteneur ne les utilise. Préserver le volume original.

## Cas négatifs et diagnostics

- Démarrer `inspect` ou `install` pendant que `app` détient le volume doit échouer `local_busy` grâce au verrou partagé sous `/app/.wrangler/creezio-local.lock` ; aucun second moteur ne doit ouvrir D1.
- Un montage absent, non accessible au compte `node`, un port déjà pris ou un daemon indisponible doit échouer clairement, sans bascule vers une base temporaire ni Cloudflare.
- Un build pour une origine différente doit être refusé par le contrôle de configuration au démarrage ; aucune réinitialisation du volume n'est une réparation acceptable.
- Après toute erreur de réponse pendant installation/écriture, inspecter l'état persistant avant une nouvelle action. Ne pas répéter automatiquement une mutation incertaine.

## Preuves à conserver

SHA du checkout, ID d'image, version Docker, sortie de `compose config`, états inspectés avant/après, réponses HTTP expurgées, empreintes de l'objet et de l'archive, résultat du redémarrage/recréation/restauration, cas négatifs, espace libre avant/après et nettoyage des seuls temporaires de recette. Ne jamais archiver les secrets, tokens, mots de passe, base réelle ou volume utilisateur dans le rapport.
