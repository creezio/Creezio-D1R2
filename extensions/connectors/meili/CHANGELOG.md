# Changelog Meili

## 0.3.0 — candidat source, projection Catalogue

Déclaration `catalog-products` facultative, index contextuel à générations, lots durables de 13 documents, émissions 202 et réconciliation de tâches, synchronisation incrémentale, abandon explicite d’une émission incertaine, relecture autorisée des hits avant restitution. Port public `meili.index@1.0.0`, commandes d’administration et recherche API/MCP. Recette fournisseur des nouveaux chemins et composition finale à qualifier.

## 0.2.0 — candidat source, diagnostic des index

Lecture admin paginée des métadonnées d’index via le port GET déclaré, 20 entrées par page, droit `meili.manage`, vérification de configuration après l’appel, projection expurgée et section de diagnostic dans la carte de réglages originale. Aucune recherche de documents, indexation, écriture fournisseur ou recherche globale T05. La recette fournisseur de cette nouvelle lecture reste à qualifier séparément.

## 0.1.0 — candidat source, connexion externe

Configuration contextuelle et clé scellée, révisions CAS, lecture bornée d’authentification par GET `/indexes?limit=1`, sorties expurgées et vue de réglages issue de l’application originale. Cette source n’est ni un paquet publié ni une indexation ou recherche Meili livrée. REQ-2801 et T05 restent ouverts selon leurs périmètres respectifs.
