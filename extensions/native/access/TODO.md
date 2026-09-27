# État access

Fondations et installation opérateur intégrées ; base actuelle main `a8e2a969`, 809 contrôles locaux/CI. Tranche active `core/t04-access-workspace` : port des trois écrans originaux et raccordement aux opérations T-06, en construction et qualification.

- Matrice des rôles, comptes avec rôles/contextes/audiences conservés, journal détaillé paginé : port depuis le Creezio original en cours.
- Opérations natives, effets D1 et résultat T-06 dans le même batch ; conflits et reprise par clé sans double mutation : qualification en cours.
- Brouillons préservés, révocation, commande incertaine après reload et comparaison de l'interface originale : recette navigateur à réaliser sur l'artefact final.

- Identité D1, claim d'installation, sessions et admission : tranche de stockage qualifiée localement et intégrée ; les recettes hébergées restent distinctes.
- Seize modèles d'identité/ACL, seed au même claim, résolution fraîche et modification du graphe : tranche qualifiée localement et intégrée ; voir [T-04](../../../docs/IMPLEMENTATION-T04.md) pour les preuves exactes.
- Dix-septième modèle `account_capabilities` et services internes d'invitation, activation/reset, émission/révocation : tranche qualifiée localement et intégrée. Aucun rôle ou session accordé par la capacité ; parcours hébergés distincts.
- Modèles privés `api_credentials` et `api_credential_scopes`, parseur de tuples strict, services machine et SQL central : tranche qualifiée localement et intégrée ; parcours hébergés distincts.
- Comptes de service, jetons API, rotation sans élargissement et résolution de droits machine : qualifiés avec le cœur. Aucun compte humain ni rôle automatique.
- Administration humaine : tranche qualifiée localement et intégrée. État du compte conservé, auto-désactivation refusée, auto-révocation explicite permise ; les transports restent distincts.
- Impersonation : tranche interne qualifiée localement et intégrée ; deux modèles privés, purpose/credential distincts, provenance typée, permission native réservée et refus purs. Aucune session personnelle de la cible ni grant bootstrap. Les transports et interfaces restent distincts.
- Remise des capacités par e-mail, vérification d'adresse, interface d'impersonation et purge d'état privé au changement d'identité : à construire.
- Transport login/session/logout et cookies distincts admin/app : tranche locale qualifiée et intégrée par PR #11, activation explicite par composition/audience ; aucun bootstrap HTTP. Une provenance réseau fiable reste indisponible sur les hôtes actuellement qualifiés : ne pas la déduire d'un header. Les limites D1 bornent le KDF mais ne garantissent pas l'équité entre visiteurs ; recette navigateur/Sites à construire avant annonce d'une connexion hébergée.
- Entrées de connexion natives et SDK de session partagé : qualifiés localement et intégrés ; administration visuelle en construction dans le lot actif, interface d'impersonation à construire.
- Installation opérateur : inspection explicite, schéma central neuf et premier compte avec services existants intégrés par PR #13 et qualifiés localement. Aucun endpoint public, compte au démarrage, secret en arguments ou réinitialisation. La création du schéma et du compte restent deux étapes distinctes ; profils hébergés à qualifier séparément.
- API administratives en construction dans le lot actif ; MCP/widgets et recette hébergée à raccorder puis qualifier, OAuth dépend de T-10.
- Distribution du paquet : à qualifier en T-30 ; pas d'archive installable revendiquée ici.

Les six suites ne transforment pas les surfaces explicitement absentes en fonctionnalités livrées.
