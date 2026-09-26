---
name: ui-and-widgets
description: "Développer les vues workspace/front et les widgets conversationnels d'un module Creezio à partir de ses opérations et des composants communs."
---

# Interfaces et widgets

Lire les [règles communes et la phase autorisée](../../README.md), le [standard de module](../../../docs/STANDARD-MODULE.md), les [parcours](../../../docs/USER-STORIES.md) et le [contrat conversationnel](../../../docs/COMPATIBILITE-CHATGPT.md). Avant le GO, préparer contributions, états et recettes, sans annoncer une interface fonctionnelle.

1. Réutiliser les composants et mécanismes déjà qualifiés. Les vues workspace utilisent le SDK de panneaux : identité, URL locale, historique, activité et invalidation. Aucun contexte privé Next/Vinext dans un module, aucune réécriture du chat standard pour un métier. Les raccordements à l'hôte restent dans son adaptateur.
2. Déclarer routes, navigation, droits, exports et emplacements dans le registre UI. Les thèmes compatibles composent les vues permises automatiquement ; un front headless libre ne reçoit pas de modification implicite. Le workspace peut servir un opérateur métier sans lui donner les pouvoirs administratifs.
3. Déclarer plusieurs types/instances de widgets et le mode de chaque action selon [le contrat des interactions](../../../docs/INTERACTIONS-WIDGETS.md) : message proposé/envoyé volontairement, contexte du prochain tour sans tour LLM ni mutation, ou traitement direct. Combiner les modes si utile, sans repli silencieux changeant l'effet. Les opérations métier effectives utilisent les mêmes services depuis écran, front et widget. Vérifier les droits côté serveur à chaque opération métier ; le rendu ou le masquage d'un bouton n'est pas une autorisation. Le widget affiche des données validées, jamais du code produit par le modèle.
4. Distinguer schéma du widget, révision interactive, snapshot d'un message et version actuelle de l'objet. Prévoir états chargement/vide/erreur, action répétée, objet modifié ou supprimé, module désactivé et reprise de conversation. Les anciens messages ne sont pas réécrits à chaque mutation.
5. Conserver brouillons, filtres, scroll et historique pendant les bascules de panneaux ; neutraliser les portails inactifs. Purger les caches devenus interdits lors d'une révocation ou d'un changement d'identité. Une mutation externe ne doit pas écraser silencieusement une saisie.
6. Préparer la ressource MCP Apps et ses audiences depuis le contrat du module. Les skills conversationnels guident les utilisateurs ; ils ne remplacent pas ces guides de développement. Distinguer rendu dans Creezio, test du pont et recette réelle dans ChatGPT.

Après P0 et le GO applicable, exécuter composants, parcours navigateur et intégration hôte selon l'impact. Vérifier plusieurs widgets d'un même module, leurs trois modes dans Creezio/GPT, contexte remplacé/retiré, hôte sans capacité et timeout sans doublon. Vérifier aussi deux fiches distinctes, navigation rapide, brouillon, portail, refus au clic et historique du widget. Conserver versions, révision et limites dans les preuves ; aucun résultat mocké ne qualifie l'hébergement ou ChatGPT.
