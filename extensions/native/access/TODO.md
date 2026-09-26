# État access

Tranche des droits persistants en construction, contrôle final à relier au checkpoint source.

- Identité D1, claim d'installation, sessions et admission : tranche de stockage qualifiée localement et intégrée ; les recettes hébergées restent distinctes.
- Seize modèles privés, relations ACL et seed de droits au même claim : implémentés ; contrôle final du lot en cours.
- Résolution fraîche des droits, garde de session/epoch au commit, mutations du graphe et audit atomique : construction et qualification avec le cœur d'autorisation ; voir [T-04](../../../docs/IMPLEMENTATION-T04.md) pour les preuves exactes.
- Invitations, activation/reset, machines et impersonation : à construire.
- Routes de connexion, cookies sécurisés, interfaces et purge de session : à construire. Avant exposition publique, qualifier une admission amont selon une provenance fiable de l'hôte ; le seul plafond global de KDF peut être saturé par un client et ne protège pas à lui seul la disponibilité des autres utilisateurs.
- API/MCP/widgets et recette hébergée : à raccorder puis qualifier ; OAuth dépend de T-10.
- Distribution du paquet : à qualifier en T-30 ; pas d'archive installable revendiquée ici.

Les six suites ne transforment pas les surfaces explicitement absentes en fonctionnalités livrées.
