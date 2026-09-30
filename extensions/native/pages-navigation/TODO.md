# T21 — acquis et restant

## Implémenté localement

- Contrats pages, navigation, média privé, permissions admin/app, API/MCP et skill éditorial.
- Brouillon/preview/snapshot publié/reset explicite avec concurrence par révision.
- Éditeur workspace et vue front authentifiée reprenant les préfabriqués et styles du landing original.
- Navigation éditoriale publiée composée dans le slot standard du thème, lecture du slug publié et métadonnées du document connecté. Les liens externes et routes des autres modules restent leurs destinations.
- Images R2 privées liées au snapshot publié : sélection de cinq images distinctes au plus, aperçu admin, lecture front authentifiée, conservation après changement du brouillon et restauration des liens lors de `page.reset`. Deux modèles D1 portent le marqueur de publication et les références publiées ; la route anonyme sélectionne uniquement les images d'un snapshot explicitement public.
- Sélection publique explicite à chaque publication, statut relu avant édition et révocation par republication protégée ; projection hôte bornée en contexte, HTML serveur et images exactes du snapshot. La nouvelle route ne rend pas publics les objets R2 eux-mêmes.
- Six suites du module et intégration D1 ciblée exercées sur ce candidat ; recette navigateur/hébergement du nouveau raccord encore à faire.

## À raccorder et qualifier

- Adoption de l'additif D1 `public_page`, raccord de la projection générée au Worker, puis recette réelle sur l'hôte cible. Le test local D1/R2 vérifie déjà l'accès anonyme, les images, les révisions, la révocation et `no-store`.
- Port de catalogue sidebar workspace versionné pour préserver les overrides du `packages/nav` original sans importer ses tables privées.
- Recette navigateur du workspace/front, API/MCP, deux Sites publics et vérification du changement de navigation sur hébergement.
- Gestion des conflits de slug, édition multiacteur, médias partagés entre administrateurs et restauration après interruption à éprouver sur hôte réel.

Les contrôles locaux ne qualifient ni l'adoption du schéma sur une cible existante ni une publication hébergée.
