# Changelog Meili

## 0.3.0 — candidat source, projection Catalogue

Déclaration `catalog-products` facultative, index contextuel à générations, lots durables de 13 documents, émissions 202 et réconciliation de tâches, synchronisation incrémentale, abandon explicite d’une émission incertaine, relecture autorisée des hits avant restitution. Port public `meili.index@1.0.0`, commandes d’administration et recherche API/MCP.

Correction du POST de documents : `primaryKey=id` est fixé dans le descripteur et l’URL construite par le port hôte. La première tâche fournisseur réelle, 165, avait échoué avec `index_primary_key_multiple_candidates_found` et n’avait indexé aucun des deux documents reçus. La recette réelle du 1er octobre (`CREEZIO-T28-MEILI-REAL-QUALIFICATION-2026-10-01.json`, hors dépôt) confirme ensuite la tâche 166, deux documents, une génération `ready` révision 9 et une recherche API native autorisée. Le widget de recherche n’a pas été exercé.

Correction locale du premier chargement admin : `index.read` attend désormais une lecture de configuration acceptée ; le rafraîchissement et une rotation de configuration relisent l’index avec une sélection de source valide. La recette réelle ci-dessus avait reproduit « Aucune source » avant un rafraîchissement manuel ; elle ne qualifie pas encore l’interface corrigée. Test UI d’ordre de résolution asynchrone ajouté.

## 0.2.0 — candidat source, diagnostic des index

Lecture admin paginée des métadonnées d’index via le port GET déclaré, 20 entrées par page, droit `meili.manage`, vérification de configuration après l’appel, projection expurgée et section de diagnostic dans la carte de réglages originale. Aucune recherche de documents, indexation, écriture fournisseur ou recherche globale T05. La recette fournisseur de cette nouvelle lecture reste à qualifier séparément.

## 0.1.0 — candidat source, connexion externe

Configuration contextuelle et clé scellée, révisions CAS, lecture bornée d’authentification par GET `/indexes?limit=1`, sorties expurgées et vue de réglages issue de l’application originale. Cette source n’est ni un paquet publié ni une indexation ou recherche Meili livrée. REQ-2801 et T05 restent ouverts selon leurs périmètres respectifs.
