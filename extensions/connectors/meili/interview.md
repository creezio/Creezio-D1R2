# Décisions et points ouverts

- L’utilisateur veut un connecteur Meili externe, avec URL et clé saisies dans Creezio ; aucun Meili embarqué ni maintenance par l’application.
- Première tranche T28 : configuration versionnée, coffre, contrôle GET `/indexes?limit=1` sans métadonnée d’index en sortie et réglages inspirés de l’UI originale. Elle ne fournit pas d’indexation ni de recherche Meili.
- Tranche 0.2.0 : diagnostic admin des index, GET paginé, métadonnées seules et aucune lecture de documents ; l’UI conserve la carte originale.
- Un accès existant autorisé a répondu HTTP 200 à un unique GET direct borné le 29 septembre ; le reçu expurgé ne qualifie pas l’intégration du module.
- La recherche native globale T05 est reportée par l’utilisateur. Expliquer son raccord et obtenir la validation propre avant de l’aborder ; `product.search` du Catalogue reste autonome.
- À réaliser séparément pour REQ-2801 : indexation/suppression par tâches asynchrones, génération contextuelle, reprise après résultat inconnu, reconstruction, filtres d’autorisations et recettes de recherche avec Meili réel.
