# Raccords restants

- Lecture liée d’image publiée pour le front app authentifié : le transport fichier commun et `catalog.view` contrôlent produit, lien, contexte et référence avant/après R2. Restent ouverts l’accès anonyme éventuel, les widgets binaires externes, le redimensionnement et une recette hébergée de cache/révocation ; aucune URL publique n’est délivrée.
- Qualification réelle dans le workspace/front, chat interne et ChatGPT externe des deux widgets, avec plusieurs instances, outil absent, révocation et rechargement. Tests locaux ne prouvent pas cette compatibilité externe.
- Exemple consommateur installé déclarant dépendance obligatoire `creezio.catalog` et contrat `catalog.products@1.0.0` ; absence, désactivation et version incompatible doivent bloquer l’activation du consommateur, sans purge du catalogue.
- Import/export CSV éventuel et règles de prix/TVA/stock propres à une application après mandat séparé. Aucun fournisseur ni extension WinHub n’est installé.
