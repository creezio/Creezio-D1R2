---
name: create-module
description: "Créer ou modifier un module Creezio natif, métier commun ou spécifique en maintenant son contrat complet, sa documentation et ses tests."
---

# Créer ou modifier un module

Lire les [règles communes et la phase autorisée](../../README.md), le [standard de module](../../../docs/STANDARD-MODULE.md), les [exigences](../../../docs/EXIGENCES.md), puis les AGENTS, PRD, décisions et dépendances du périmètre. Avant le GO, rédiger le contrat et les recettes ; ne pas créer un faux module exécutable.

1. Définir propriétaire, identifiant qualifié, origine, versions et dépendances publiques. Un natif, une extension d'application et un paquet tiers suivent le même contrat. Une fonctionnalité commune absente se propose au dépôt propriétaire ; ne pas la copier dans un autre module pour éviter son contrat.
2. Déclarer ensemble modèles D1, fichiers R2 éventuels, relations, opérations, permissions, configuration, événements et projections de recherche. Le module possède ses règles métier ; API et MCP dérivent des mêmes opérations. Il peut n'avoir aucune table ou aucun fichier propre si sa fonction n'en exige pas.
3. Déclarer les contributions workspace/front et la partie plugin conversationnel : outils exposés, skills utilisateur et widgets. Distinguer pouvoirs administratifs et métier, sans déduire les permissions du choix de l'interface. Un module reste utilisable par ses API et écrans lorsque son exposition conversationnelle est désactivée.
4. Utiliser les SDK communs pour le stockage, la navigation, les conversations et les fournisseurs. Aucun moteur n8n/Meili/Hermes hébergé dans le module, aucun scheduler natif, aucune seconde logique métier par hébergement. Les services externes nécessaires sont configurés explicitement.
5. Maintenir README, AGENTS, FILES, PRD/interview/décisions, TODO, changelog et fiche d'impact selon le [standard de développement](../../../docs/DEVELOPMENT-STANDARD.md). Préparer les six suites du module selon ses capacités ; après P0, les raccorder aux contrôles communs réellement disponibles. Une suite sans objet doit être justifiée, jamais remplacée par un succès vide.
6. Pour une distribution externe, séparer paquet installable, plugin conversationnel et démo consommant le même module. Vérifier l'archive produite dans une app hôte sans résolution cachée vers le checkout du développeur, puis sa mise à jour et la conservation des données.

Livrer le contrat cohérent et ses preuves, avec les parties encore non implémentées ou non qualifiées. Les scripts SQL de transformation ne sont pas un livrable du module ; l'évolution des modèles relève de la chaîne centrale.
