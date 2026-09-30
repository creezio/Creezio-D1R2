# PRD — T28, projection Catalogue Meili

Un administrateur configure une instance Meilisearch externe par contexte. Les secrets restent dans le coffre ; les routes, méthodes, paramètres et corps distants sont fixés par le descripteur serveur. `meili.manage` autorise la configuration et l’indexation ; `meili.search` autorise la recherche. Le Catalogue fournit les produits sous `catalog.view`, y compris lors de la reconstruction et de la relecture des hits.

La reconstruction et la synchronisation progressent par pages et lots bornés, avec état durable avant émission. Une tâche fournisseur 202 n’est pas une confirmation d’indexation : seules ses informations de succès correspondant à l’index et au type attendus font avancer le curseur. Une issue inconnue bloque le nouvel envoi jusqu’à inspection ou abandon explicite. La génération active reste disponible pendant une reconstruction.

Le POST de documents déclare `primaryKey=id` dans l’URL construite par l’hôte. Chaque document projeté garde son `id` explicite ; d’autres champs dont le nom finit par `id` ne participent pas au choix de la clé primaire de l’index.

Les réponses de recherche renvoient uniquement les produits repassés par le modèle propriétaire. Les comptes et facettes sont calculés sur la page visible. Aucun agrégat global filtré n’est promis. La recherche globale T05 n’est pas ajoutée par T28.

Qualification : six suites locales, validation du paquet contre SDK 1.6.0 une fois son dist rafraîchi, intégration D1/composition et recette avec fournisseur externe séparées. Aucun identifiant réel n’est nécessaire pour exécuter les tests locaux.
