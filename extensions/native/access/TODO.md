# État access

Tranche d'impersonation interne en construction, contrôle final à relier au checkpoint source.

- Identité D1, claim d'installation, sessions et admission : tranche de stockage qualifiée localement et intégrée ; les recettes hébergées restent distinctes.
- Seize modèles d'identité/ACL, seed au même claim, résolution fraîche et modification du graphe : tranche qualifiée localement et intégrée ; voir [T-04](../../../docs/IMPLEMENTATION-T04.md) pour les preuves exactes.
- Dix-septième modèle `account_capabilities` et services internes d'invitation, activation/reset, émission/révocation : tranche qualifiée localement et intégrée. Aucun rôle ou session accordé par la capacité ; parcours hébergés distincts.
- Modèles privés `api_credentials` et `api_credential_scopes`, parseur de tuples strict, services machine et SQL central : tranche qualifiée localement et intégrée ; parcours hébergés distincts.
- Comptes de service, jetons API, rotation sans élargissement et résolution de droits machine : qualifiés avec le cœur. Aucun compte humain ni rôle automatique.
- Administration humaine : tranche qualifiée localement et intégrée. État du compte conservé, auto-désactivation refusée, auto-révocation explicite permise ; les transports restent distincts.
- Impersonation : deux modèles privés, purpose/credential distincts, provenance typée, permission native réservée et refus purs implémentés ; services et recettes D1 en qualification. Aucune session personnelle de la cible ni grant bootstrap. Résultats finaux à rattacher au checkpoint du lot.
- Remise des capacités par e-mail, vérification d'adresse, interface d'impersonation et purge d'état privé au changement d'identité : à construire.
- Routes de connexion, cookies sécurisés, interfaces et purge de session : à construire. Avant exposition publique, qualifier une admission amont selon une provenance fiable de l'hôte ; le seul plafond global de KDF peut être saturé par un client et ne protège pas à lui seul la disponibilité des autres utilisateurs.
- API/MCP/widgets et recette hébergée : à raccorder puis qualifier ; OAuth dépend de T-10.
- Distribution du paquet : à qualifier en T-30 ; pas d'archive installable revendiquée ici.

Les six suites ne transforment pas les surfaces explicitement absentes en fonctionnalités livrées.
