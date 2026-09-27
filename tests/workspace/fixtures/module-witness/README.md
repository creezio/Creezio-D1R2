# Module témoin du workspace

Version source 1.0.0. Ce module est sélectionné seulement par `configuration/composition.workspace-witness.json`, avec le module natif access. Le démarrage standard ne le sélectionne pas.

Deux fiches synthétiques `alpha` et `beta` exercent la conservation de brouillons indépendants. La vue déclarée `/witness/{id}` lit et renomme par les bindings API `record-read` et `record-rename`, via le moteur d'opérations et ses permissions natives. Le modèle possède `id`, `title`, `revision` et des champs protégés du contexte. La mutation utilise une clé d'idempotence et une comparaison de révision ; une réponse incertaine ne déclenche aucun nouvel envoi automatique.

Le schéma `panel-state` borne l'état restaurable de chaque panneau à un titre de brouillon, son titre et sa révision de départ ; la sous-vue active est conservée séparément par le workspace. Une recharge retrouve le brouillon de la fiche correspondante. Une relecture garde un brouillon modifié si la révision serveur a changé, affiche un conflit et exige de choisir explicitement entre rebaser le brouillon ou adopter la version serveur. Si la réponse d'une mutation est perdue, la fixture conserve sa clé de requête dans l'état du panneau et consulte son statut par cette clé lorsque l'identifiant d'exécution manque ; elle ne renvoie pas la mutation. Ce module est une fixture synthétique de contrat et de navigation, pas un module produit natif.

Les vues publient au shell leurs métadonnées de présentation par panneau : titre distinct pour Alpha et Bêta, et fil d'Ariane interne de la fiche vers le workspace témoin. Ces métadonnées ne donnent aucun droit et ne sont pas conservées avec le brouillon.

Le harnais peut appeler `tests/workspace/fixtures/seed.mjs` avec un DataPort déjà autorisé dans une base synthétique isolée. Le module ne sème aucune base au démarrage. Aucun compte, secret, archive publiée, widget, chat ou fournisseur externe n'est livré avec la fixture. Les archives à empreinte nulle du lock sont des placeholders de test.

Exécuter `node gate.mjs` ici pour les six suites contractuelles. Le navigateur local, le Worker et Sites exigent leurs recettes distinctes avant toute qualification du produit.
