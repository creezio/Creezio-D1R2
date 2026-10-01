# T21 — acquis et restant

## Implémenté localement

- Contrats pages, navigation, média privé, permissions admin/app, API/MCP et skill éditorial.
- Brouillon/preview/snapshot publié/reset explicite avec concurrence par révision.
- Éditeur workspace et vue front authentifiée reprenant les préfabriqués et styles du landing original.
- Navigation éditoriale publiée composée dans le slot standard du thème, lecture du slug publié et métadonnées du document connecté. Les liens externes et routes des autres modules restent leurs destinations.
- Images R2 privées liées au snapshot publié : sélection de cinq images distinctes au plus, aperçu admin, lecture front authentifiée, conservation après changement du brouillon et restauration des liens lors de `page.reset`. Deux modèles D1 portent le marqueur de publication et les références publiées ; la route anonyme sélectionne uniquement les images d'un snapshot explicitement public.
- Sélection publique explicite à chaque publication, statut relu avant édition et révocation par republication protégée ; projection hôte bornée en contexte, HTML serveur et images exactes du snapshot. La nouvelle route ne rend pas publics les objets R2 eux-mêmes.
- Sidebar du workspace : catalogue hôte compilé en lecture seule, overrides contextuels D1 à révision CAS, projection admin/app selon droits frais, onglet original Source/Lien/Permission en lecture seule et Visible/Libellé/Ordre/Défaut éditables.
- Six suites du module et intégration D1 ciblée exercées sur ce candidat. Sur Linux main `3d42489`, le navigateur et les lectures HTTP sans cookie ont confirmé la page et l’image publiques, puis leur révocation par republication protégée ; les nouveaux libellés de l’éditeur restent à déployer.

## À raccorder et qualifier

- Qualifier l’accès public, l’image et la révocation sur Sites et Cloudflare ; la recette Linux main `3d42489` ne couvre que cet hôte.
- Étendre la recette des droits de la Sidebar à une autre identité et qualifier API/MCP ainsi que la navigation sur les hébergements visés. La Sidebar a déjà été adoptée et exercée sur Linux main `3d42489`.
- Vérifier deux Sites publics et le changement de navigation sur hébergement.
- Gestion des conflits de slug, édition multiacteur, médias partagés entre administrateurs et restauration après interruption à éprouver sur hôte réel.

L’adoption du schéma et la publication anonyme sont qualifiées sur le Linux main `3d42489`, pas sur Sites ou Cloudflare.
