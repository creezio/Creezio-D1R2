# T21 — acquis et restant

## Implémenté localement

- Contrats pages, navigation, média privé, permissions admin/app, API/MCP et skill éditorial.
- Brouillon/preview/snapshot publié/reset explicite avec concurrence par révision.
- Éditeur workspace et vue front authentifiée reprenant les préfabriqués et styles du landing original.
- Navigation éditoriale publiée composée dans le slot standard du thème, lecture du slug publié et métadonnées du document connecté. Les liens externes et routes des autres modules restent leurs destinations.
- Images R2 privées liées au snapshot publié : sélection de cinq images distinctes au plus, aperçu admin, lecture front authentifiée, conservation après changement du brouillon et restauration des liens lors de `page.reset`. Deux nouveaux modèles D1 additifs portent le marqueur et les références publiées ; aucun média n'est rendu public.
- Six suites du module et intégration D1 ciblée exercées sur ce candidat ; recette navigateur/hébergement du nouveau raccord encore à faire.

## À raccorder et qualifier

- Lecture HTTP anonyme bornée des snapshots publiés, sélection du contexte/site, cache et invalidation publics. La résolution du slug authentifié est acquise.
- Route publique contrôlée des médias et SEO serveur indexable. Les références privées publiées et le document du front connecté ne remplacent pas ces ports.
- Port de catalogue sidebar workspace versionné pour préserver les overrides du `packages/nav` original sans importer ses tables privées.
- Recette navigateur du workspace/front, API/MCP, deux Sites publics et vérification du changement de navigation sur hébergement.
- Gestion des conflits de slug, édition multiacteur, médias partagés entre administrateurs et restauration après interruption à éprouver sur hôte réel.

Aucun lot T21 complet ni publication publique n'est revendiqué par les seuls contrôles locaux.
