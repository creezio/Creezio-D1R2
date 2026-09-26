---
name: publish-and-update
description: "Préparer ou exécuter une release, une publication ou une mise à jour Creezio dans le mandat de livraison établi, en préservant données et personnalisations."
---

# Publication et mise à jour

Lire les [règles communes et la phase autorisée](../../README.md), le [cycle Git](../../../docs/GIT-FLOW.md), le [stockage et hébergement](../../../docs/STOCKAGE-ET-HEBERGEMENT.md), le [cadre produit](../../../docs/CADRE-PRODUIT-ET-COMMUNAUTE.md) et les critères du [TODO](../../../docs/TODO.md). Avant le GO, préparer le parcours et les preuves attendues ; aucune livraison applicative n'est lancée. Vérifier ensuite que l'outillage requis par le jalon est réellement disponible et qualifié.

1. Identifier ce qui est autorisé : release du socle, module, paquet conversationnel, démo ou déploiement d'une app. Un merge, un paquet publié et une app mise à jour sont des états distincts. Respecter les autorisations existantes sans confirmation répétée, mais ne pas étendre un mandat de correction à une livraison.
2. Préparer versions, changelogs et verrous des seuls composants affectés dans la branche de release prévue. Fixer origine, dépendances, compatibilité, droits nouveaux et personnalisations. Une mise à jour ciblée ne met pas silencieusement à jour les composants non concernés.
3. Après revue indépendante et squash autorisé de la PR de release, relever le nouveau SHA réellement intégré sur main, le vérifier, construire puis tester son archive exacte. Ne pas publier l'ancien build de PR. Sérialiser les releases d'un composant, garder les tags publiés immuables et utiliser une nouvelle version pour un correctif.
4. Vérifier données et SQL généré centralement avant publication. Préserver personnalisations et données de production. La première copie local vers Cloudflare comprend application, D1 et R2 ; une mise à jour ne réimporte pas le jeu local. Un retour au code précédent n'annule ni SQL appliqué ni données modifiées.
5. Sur Sites, la publication est demandée/exécutée/vérifiée dans GPT par le parcours autorisé ; ne pas créer de bouton de publication depuis l'app ni de tâche planifiée implicite. Le parcours local utilise son exécuteur limité et les capacités qualifiées, sans donner un accès général aux systèmes hôtes.
6. Avant une publication officielle, vérifier propriétaire/enregistrement et token de déclaration requis. Une panne de cette vérification suspend la livraison préparée, pas l'app existante. Après succès vérifié, déclarer la version réellement livrée ; une panne de synchronisation reste reprenable et visible. Token de registre, droits premium et autorisation d'assistance sont distincts.

Terminer avec destination, version/SHA, empreinte de l'artefact, résultat de publication et vérifications réelles. Ne clôturer un critère de production qu'après sa preuve. Les apps adoptent une release explicitement ; aucune propagation automatique à tous les forks.
