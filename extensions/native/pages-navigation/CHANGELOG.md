# Changelog

## T21 — canonical SEO public (correctif candidat)

Le renderer serveur reprend désormais le canonical HTTP(S) externe ou le chemin local publié, selon les formes déjà admises par `page.save` et le front authentifié. Les URL de protocole hostile, avec identifiants ou commençant par `//` reviennent à l'URL publique de la page ; React échappe l'attribut HTML. La révision source candidate passe de `t21-pages-navigation-v4` à `t21-pages-navigation-v5`, sans changer la version du module `0.0.0` ni prétendre qu'une archive a été publiée. Le verrou de composition et les archives devront être régénérés sur le main qualifié avant livraison.

## T21 — libellés et recette de l’accès public

L’éditeur explique que l’accès sans connexion résulte d’un choix explicite à la publication. Les fichiers joints restent privés ; seules les images utilisées par la version rendue publique sont visibles sans connexion. Sur Linux main `3d42489`, la recette navigateur et HTTP sans cookie a vérifié page et image publiques, puis leur refus après republication protégée. Cette preuve ne qualifie ni Sites ni Cloudflare ; les nouveaux libellés ne faisaient pas partie de cette image Linux.

## T21 — personnalisation de la Sidebar du workspace

Ajoute l'onglet Sidebar issu du menu original, les trois opérations `sidebar.catalog`, `sidebar.resolved` et `sidebar.save`, et un singleton D1 contextuel à révision CAS. Les overrides stockent seulement visibilité, libellé et ordre ; le catalogue compilé fournit routes et droits en lecture seule. Le workspace applique le résultat après sa projection d'accès fraîche. Les entrées retirées de la composition restent dormantes, sans exposer leur route ni réapparaître à l'écran.

## T21 — publication anonyme explicite

`page.publish` accepte `visibility: public` ; le mode absent ou `protected` reste privé. Un marqueur D1 additif garde la révision exposée et est retiré par une republication protégée. L'éditeur relit la visibilité, affiche le lien public, et peut révoquer sans modifier le brouillon. La projection hôte sélectionnée rend les préfabriqués existants en HTML indexable et ne distribue que les images exactes du snapshot, après vérification de la référence, du contexte, de la taille et du SHA-256. La recette locale D1/R2 couvre les refus, la révocation pendant une lecture R2 et la navigation avec plus de cent pages publiques ; la recette Linux main `3d42489` qualifie en plus la page et son image sans cookie sur cet hôte uniquement.

## T21 — lecture complète des médias du brouillon

`media.list` conserve une page maximale de 50 médias ; son budget couvre aussi la lecture de la page parente, ce qui évite un refus `invalid_input` à cette limite.

## T21 — images privées du snapshot publié

Le front authentifié et l'aperçu admin affichent les images R2 déjà liées à une page, dans les préfabriqués existants. Deux modèles D1 additifs figent jusqu'à cinq références citées au moment de `page.publish` ; les ajouts et détachements ultérieurs du brouillon n'altèrent pas la publication. `page.reset` rétablit les liens cités sans copie R2. La lecture privée liée, les gardes de révision, le refus des accès hors publication et le nettoyage des URL Blob sont couverts par les suites ciblées. Aucune route média publique ni lecture anonyme n'est ajoutée.

## 0.0.0 — candidat T21

Ajoute le module natif d'édition de pages, navigation et métadonnées SEO, avec snapshots publiés D1, médias privés R2, vues workspace/front authentifiées et projection API/MCP. Adapte les préfabriqués visuels du landing original. Les routes anonymes et médias publics ont été raccordés dans les tranches suivantes.

Le front connecté compose la navigation publiée dans le slot d'en-tête existant, résout les pages par slug publié et applique temporairement les métadonnées du snapshot actif au document. Le SEO serveur et l'accès anonyme, absents de cette première tranche, ont été ajoutés par la publication anonyme explicite ci-dessus.

Les mutations de pages, navigation et liens de médias utilisent le journal public du SDK. Les résultats incertains conservent leur clé et se vérifient sans réémission. Le statut confirmé rafraîchit les données avant de permettre une nouvelle modification.
