# PRD — T28, connexion Meili uniquement

Un administrateur autorisé enregistre une origine HTTPS canonique et une clé Meili par contexte, active la connexion et demande explicitement une vérification. La configuration D1 porte une révision CAS ; le coffre scelle la clé et sa version. Le serveur limite l’egress à une ressource GET construite par le descripteur, sans URL, méthode ou en-tête choisis par le client. Une révocation invalide la clé et bloque les nouvelles lectures.

Le contrôle de connexion ne publie que `{authenticated,status}` : connecté, clé distante refusée, ou erreur explicite du moteur. Une page vide est un succès d’authentification de cette route, pas une preuve d’indexation. Les permissions `meili.manage` et `meili.read` sont séparées ; seuls les administrateurs opèrent le module, les tokens machine respectent la même portée. Les mutations utilisent le journal SDK, persistent la clé de demande avant l’envoi et ne rejouent pas une issue inconnue.

L’interface reprend les réglages de recherche de Creezio originale, affiche clairement « indexation non raccordée » et conserve son état pendant un rafraîchissement de session transitoire. Aucun raccourci de recherche globale T05, document, facette, résultat Meili ou bouton « Réindexer » actif n’est fourni.

Critères de cette tranche : contrats et six suites du module, intégration D1/coffre/API/MCP avec egress simulé, refus de révision obsolète et de clé révoquée, absence de fuite de secret ou métadonnée d’index, archive fermée contre SDK 1.4+ public vérifié, et recette fournisseur bornée séparée. Les écritures et tâches asynchrones Meili, reconstruction et recherche contextuelle restent ouvertes dans REQ-2801 ; T05 demeure reportée.
