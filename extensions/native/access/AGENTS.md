# Développer le module access

Appliquer les [instructions du dépôt](../../../AGENTS.md) et le [standard](../../../docs/STANDARD-MODULE.md). Travail rattaché à T-04 et REQ-0401/REQ-0402 ; OAuth complet demeure T-10.

Modifier les modèles actuels dans `module/models.json`, puis régénérer explicitement le manifeste et le SQL central ; ne pas écrire de scripts de transformation SQL dans ce module. Tous les champs d'identité restent protégés et privés ; aucun port public de stockage n'est fourni.

Préserver les six suites, le PRD de travail, les décisions et le changelog. La tranche de stockage n'autorise ni un faux écran de connexion ni une exposition anonyme du provisionnement. Le marqueur d'installation consommée ne disparaît jamais lors de la suppression d'un compte. Aucun cookie, header GPT ou email déclaré ne donne de rôle.

Le bootstrap initialise ses lignes de droits au même claim que le compte, sans fallback propriétaire ni wildcard. Les affectations et exceptions de compte doivent conserver la FK composite vers leur membership compte/contexte/audience. Les modifications du graphe passent par la garde fraîche de session et d'epoch et l'audit atomique du cœur ; aucun write direct d'une contribution UI ou d'un plugin. Conserver les contextes existants, désactiver explicitement ceux qui le permettent et maintenir actif le contexte application. Les modèles privés ne constituent pas une API CRUD publique.
