# T21 — acquis et restant

## Implémenté localement

- Contrats pages, navigation, média privé, permissions admin/app, API/MCP et skill éditorial.
- Brouillon/preview/snapshot publié/reset explicite avec concurrence par révision.
- Éditeur workspace et vue front authentifiée reprenant les préfabriqués et styles du landing original.
- Navigation éditoriale publiée composée dans le slot standard du thème, lecture du slug publié et métadonnées du document connecté. Les liens externes et routes des autres modules restent leurs destinations.
- Six suites du module et intégration D1 ciblée exercées sur ce candidat ; recette navigateur/hébergement du nouveau raccord encore à faire.

## À raccorder et qualifier

- Lecture HTTP anonyme bornée des snapshots publiés, sélection du contexte/site, cache et invalidation publics. La résolution du slug authentifié est acquise.
- Route publique contrôlée des médias, représentation stable des références d'image et SEO serveur indexable. Le document du front connecté ne remplace pas ce dernier.
- Port de catalogue sidebar workspace versionné pour préserver les overrides du `packages/nav` original sans importer ses tables privées.
- Recette navigateur du workspace/front, API/MCP, deux Sites publics et vérification du changement de navigation sur hébergement.
- Gestion des conflits de slug, édition multiacteur, médias partagés entre administrateurs et restauration après interruption à éprouver sur hôte réel.

Aucun lot T21 complet ni publication publique n'est revendiqué par les seuls contrôles locaux.
