# Changelog

## Non publié — statut des réglages fournisseur

Le Product Hub ne déduit plus « Configuration manquante / Indisponible » d'un réglage fournisseur obligatoire absent de la composition. Son état reste non vérifié tant qu'aucun état runtime autorisé n'est fourni ; les réglages ordinaires obligatoires absents restent signalés comme manquants.

## Non publié — précision des erreurs

Les contrats de lecture de fiche, plan et documentation déclarent explicitement `not_found`, déjà retourné par le service. Aucun changement de données ou de droits.

## Non publié — T12

Lecture des documents de version installée dans les cartes PRD/Documents/Changelog du Product Hub, ainsi que par les API et outils MCP communs. Les octets sont liés à l'archive runtime verrouillée ; lecture bornée et vérification d'intégrité, sans accès au filesystem ou à GitHub au runtime. Documents de développement, historique d'installation et PRD de travail restent séparés. Qualification en cours.

## Non publié — T11

Catalogue de modules, graphe de dépendances, plans explicites et journal des acceptations. Réemploi des vues originales Product Hub avec SDK workspace et opérations communes. Modèles actuels sans script SQL de transformation ; conservation des données lors des changements. Qualification en cours.

Les titres et diagnostics Unicode suivent leurs limites contractuelles de bout en bout. Les titres complets sont préservés ; seuls les libellés d'onglet et de fil d'Ariane sont abrégés pour respecter le SDK workspace.
