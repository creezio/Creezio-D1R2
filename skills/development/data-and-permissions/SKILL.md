---
name: data-and-permissions
description: "Faire évoluer les modèles D1, fichiers R2, relations, opérations, indexation ou permissions d'un module Creezio sans dupliquer les règles entre canaux."
---

# Données et autorisations

Lire les [règles communes et la phase autorisée](../../README.md), le [standard de module](../../../docs/STANDARD-MODULE.md), les [exigences](../../../docs/EXIGENCES.md) et le contrat concerné. Avant le GO, préciser modèles, invariants et cas de recette ; aucun accès aux données de production n'en découle.

1. Identifier le propriétaire de chaque entité, les champs éditables, calculés et snapshots, les relations et règles de suppression. Définir les fichiers R2 et leurs métadonnées D1 avec la même politique d'accès. Une clé d'objet ou un nom de base fourni par le client ne donne pas accès à la ressource.
2. Faire résoudre l'acteur et le contexte par le serveur. Déclarer une opération canonique avec entrées/sorties, erreurs, permissions, audiences, approbations et conditions de concurrence. Les chemins UI, API, MCP et widget l'utilisent sans fabriquer une session utilisateur pour une identité machine.
3. Contrôler les droits aux lectures et à l'écriture effective, y compris relations intermodules, fichiers, recherches, compteurs et facettes. Séparer capacité d'hébergement, droit premium éventuel et permission applicative ; aucun paiement ou token valide ne remplace les autres contrôles ou une validation humaine requise.
4. Déclarer projections/index, tri et pagination sur l'ensemble autorisé. Prévoir suppression, reconstruction et reprises bornées pour l'adaptateur de recherche natif ou Meili configuré. Ne pas ajouter une intégration Meili particulière dans chaque application.
5. Prévoir conflits de version, idempotence et effets externes incertains. Une nouvelle tentative ne doit pas répéter un effet déjà produit ; la reprise vient d'une requête autorisée ou d'un service externe, sans ordonnanceur caché.
6. Décrire le modèle actuel et l'évolution compatible. La chaîne centrale génère et inspecte le SQL ; aucun script de conversion n'est ajouté au module. Bloquer une évolution destructive non résolue et conserver les données lors d'une mise à jour.

Dans les lots applicatifs autorisés après P0, une fois l'outillage requis livré et qualifié, éprouver cas autorisés/interdits, changements de session, accès croisés, références supprimées, réponses périmées et conflits par les canaux affectés. Maintenir PRD/décisions, fiche d'impact et suites concernées ; distinguer tests locaux et intégration réellement exercée. Voir [stockage et hébergement](../../../docs/STOCKAGE-ET-HEBERGEMENT.md) pour les garanties propres à chaque cible.

## Dépendances entre modules

Appliquer le [contrat commun](../../../docs/DEPENDANCES-MODULES.md). Relier les références intermodules à des contrats publics déclarés et versionnés. Dépendre d’un catalogue ne donne accès ni à ses tables privées ni aux données d’un autre contexte. Vérifier les relations persistantes avant désactivation/retrait ; une intégration facultative ne peut laisser de référence obligatoire orpheline. Tester la garde d’exécution et les plans concurrents.
