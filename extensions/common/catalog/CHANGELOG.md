# Changelog

## Non publié — libellé des images privées

Le libellé de l’éditeur décrit la lecture privée déjà disponible aux utilisateurs autorisés pour les produits publiés, dans le front et les widgets app, avec cinq liens au plus. Aucun droit, fichier ou comportement ne change.

## 0.1.3 — témoin de clic front pour T22 (candidat non publié)

La carte produit authentifiée expose l’identifiant statique `catalog.product.open` pour la collecte optionnelle Analytics. Le même identifiant vaut pour toutes les cartes, sans SKU, ID, nom ni prix. Aucun comportement Catalogue, modèle, droit, opération ou port public ne change ; l’activation Analytics reste une décision administrative séparée. La recette navigateur hébergée de ce clic est ouverte.

## Non publié — identifiant des outils Catalogue

Les schémas et le guide conversationnel précisent qu'une recherche accepte un nom ou SKU, tandis que `product.get.id` attend l'ID interne renvoyé par `product.search.items[].id`. Cette clarification répond au témoin T25 où un SKU passé à `product.get` donnait `not_found` ; les opérations, droits et données restent inchangés.

## 0.1.2 — images privées dans les widgets app

Les cartes liste/fiche chargent à la demande une première image visible ou une galerie de cinq liens maximum. `media.list` reste un seul outil partagé et les octets liés sont remis uniquement au composant par le pont privé du SDK `^1.5.0` candidat ; le contenu modèle reste textuel et neutre. Les widgets admin restent textuels. Aucune mutation, table SQL, URL publique ou modification du port `catalog.products@1.0.0`.

## 0.1.1 — images liées du front authentifié

Lecture binaire contrôlée des images de produits publiés dans la grille et la fiche, via le transport fichier commun et SDK `^1.3.0`. Le port métier `catalog.products@1.0.0` et les modèles SQL restent identiques ; seuls les droits de lecture protégée du fichier et du modèle de métadonnées évoluent. Les objets R2 privés et la voie propriétaire sont conservés.

## 0.1.0 — T25 catalogue commun

Produits/catégories D1, images R2 privées, prix minor/devise, port de lecture versionné, UI workspace/front, outils MCP et widgets liste/fiche. Fonctionnalités WinHub propres au B2B laissées à leurs modules consommateurs.
