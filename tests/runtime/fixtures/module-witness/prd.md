# PRD du module témoin

Objectif : vérifier qu'une composition explicite transporte une déclaration de module jusqu'à un handler serveur et un composant React réels.

Critères : GET /api/modules/example.witness/status retourne module, version et status ; /witness rend le composant déclaré ; la route protégée est refusée par le dispatch T-03. Absence du module dans la composition implique absence des imports et des routes.

Critères négatifs : verrou différent, référence absente, dépendance obligatoire manquante, collision, fichier non déclaré et chemin lié/hors périmètre bloquent la compilation. Le handler public ne consulte aucun stockage ni secret. Aucun statut d'authentification ou de stockage n'est simulé.

Le PRD est celui de la version source 1.0.0. Il ne prouve aucune installation ou publication.
