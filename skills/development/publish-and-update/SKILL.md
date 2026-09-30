---
name: publish-and-update
description: "Préparer ou exécuter une release, une publication ou une mise à jour Creezio dans le mandat de livraison établi, en préservant données et personnalisations."
---

# Publication et mise à jour

Lire les [règles communes et le mandat courant](../../README.md), le [cycle Git](../../../docs/GIT-FLOW.md), le [stockage et hébergement](../../../docs/STOCKAGE-ET-HEBERGEMENT.md), le [cadre produit](../../../docs/CADRE-PRODUIT-ET-COMMUNAUTE.md) et les critères du [TODO](../../../docs/TODO.md). Vérifier l'outillage et ses preuves sur la révision à livrer ; ce guide ne crée pas d'autorisation de publication.

1. Identifier ce qui est autorisé : release du socle, module, paquet conversationnel, démo ou déploiement d'une app. Un merge, un paquet publié et une app mise à jour sont des états distincts. Respecter les autorisations existantes sans confirmation répétée, mais ne pas étendre un mandat de correction à une livraison.
2. Préparer versions, changelogs et verrous des seuls composants affectés dans la branche de release prévue. Après la dernière édition d'un fichier de module déclaré, appliquer la [finalisation des profils et des deux archives](../test-and-package/SKILL.md#finalisation-dune-candidate-avant-push) avant de figer la candidate. Fixer origine, dépendances, compatibilité, droits nouveaux et personnalisations. Une mise à jour ciblée ne met pas silencieusement à jour les composants non concernés.
3. Après revue indépendante et squash autorisé de la PR de release, relever le nouveau SHA réellement intégré sur main, le vérifier, construire puis tester son archive exacte. Ne pas publier l'ancien build de PR. Sérialiser les releases d'un composant, garder les tags publiés immuables et utiliser une nouvelle version pour un correctif.
4. Vérifier données et SQL généré centralement avant publication. Préserver personnalisations et données de production. La première copie local vers Cloudflare comprend application, D1 et R2 ; une mise à jour ne réimporte pas le jeu local. Un retour au code précédent n'annule ni SQL appliqué ni données modifiées. Dans le parcours local où la compilation arrête le runtime applicatif, terminer la recette UI et confirmer la déconnexion avant `start`. Si la réponse HTTP de `start` est inconnue, relire le même journal et le même plan tant qu'ils progressent, sans renvoyer `start`.

Pour un déploiement Docker existant, conserver l'image précédente par un tag vérifié avant de déplacer `latest` et de recréer le conteneur ; sa simple présence au préflight ne prouve pas sa conservation après livraison. Utiliser les mêmes fichiers Compose pour inspection, adoption et démarrage. Depuis Windows vers Linux, réutiliser le transport du lanceur qualifié ; une entrée de shell doit avoir des fins de ligne LF. Un refus d'usage avant inspection ne justifie ni reconstruction ni retrait de verrou.
5. Sur Sites, la publication est demandée/exécutée/vérifiée dans GPT par le parcours autorisé ; ne pas créer de bouton de publication depuis l'app ni de tâche planifiée implicite. Le parcours local utilise son exécuteur limité et les capacités qualifiées, sans donner un accès général aux systèmes hôtes.
6. Avant une publication officielle, vérifier propriétaire/enregistrement et token de déclaration requis. Une panne de cette vérification suspend la livraison préparée, pas l'app existante. Après succès vérifié, déclarer la version réellement livrée ; une panne de synchronisation reste reprenable et visible. Token de registre, droits premium et autorisation d'assistance sont distincts.

Terminer avec destination, version/SHA, empreinte de l'artefact, résultat de publication et vérifications réelles. Ne clôturer un critère de production qu'après sa preuve. Les apps adoptent une release explicitement ; aucune propagation automatique à tous les forks.

## Dépendances entre modules

Appliquer le [contrat commun](../../../docs/DEPENDANCES-MODULES.md). Comparer graphes avant/après et verrou de composition, y compris consommateurs directs/transitifs. Présenter les dépendances nouvelles, changements d’origine/version, configuration et droits ; appliquer seulement le plan autorisé. Tester refus de mise à jour cassante, désactivation/retrait, puis intégrations facultatives et conservation des données. Ne pas recalculer silencieusement les versions lors du déploiement.
