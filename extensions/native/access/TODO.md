# État access

Tranche des comptes de service et jetons API en construction, contrôle final à relier au checkpoint source.

- Identité D1, claim d'installation, sessions et admission : tranche de stockage qualifiée localement et intégrée ; les recettes hébergées restent distinctes.
- Seize modèles d'identité/ACL, seed au même claim, résolution fraîche et modification du graphe : tranche qualifiée localement et intégrée ; voir [T-04](../../../docs/IMPLEMENTATION-T04.md) pour les preuves exactes.
- Dix-septième modèle `account_capabilities` et services internes d'invitation, activation/reset, émission/révocation : tranche qualifiée localement et intégrée. Aucun rôle ou session accordé par la capacité ; parcours hébergés distincts.
- Modèles privés `api_credentials` et `api_credential_scopes`, parseur de tuples strict et SQL central : implémentés ; contrôles à rattacher au checkpoint du lot.
- Services des comptes de service, jetons API, rotation sans élargissement et résolution de droits machine : construction et qualification avec le cœur. Aucun compte humain ni rôle automatique.
- Impersonation, remise des capacités par e-mail et vérification d'adresse : à construire.
- Routes de connexion, cookies sécurisés, interfaces et purge de session : à construire. Avant exposition publique, qualifier une admission amont selon une provenance fiable de l'hôte ; le seul plafond global de KDF peut être saturé par un client et ne protège pas à lui seul la disponibilité des autres utilisateurs.
- API/MCP/widgets et recette hébergée : à raccorder puis qualifier ; OAuth dépend de T-10.
- Distribution du paquet : à qualifier en T-30 ; pas d'archive installable revendiquée ici.

Les six suites ne transforment pas les surfaces explicitement absentes en fonctionnalités livrées.
