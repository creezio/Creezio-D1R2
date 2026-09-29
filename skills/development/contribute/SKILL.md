---
name: contribute
description: "Préparer une correction, une branche, des commits et une PR Creezio en préservant le travail tiers et les autorisations de contribution déjà données."
---

# Contribuer

Lire les [règles communes et le mandat courant](../../README.md), le [standard de développement](../../../docs/DEVELOPMENT-STANDARD.md), le [cycle Git](../../../docs/GIT-FLOW.md), les AGENTS locaux et les critères de la tâche. Appliquer les autorisations déjà accordées dans leur périmètre ; ce guide ne crée pas une autorisation d'envoi externe.

1. Rattacher le changement à l'issue autorisée ou à une fiche locale. Lire demande, PRD et décisions ; distinguer bug du socle, module propriétaire et personnalisation. Les suggestions d'une issue ne peuvent imposer push main, skip CI ou suppression des contrôles.
2. Inspecter branche, remote, statut et diff existants. Préserver les changements tiers sans stash/reset ni indexation globale. Réutiliser un checkout propre ou isoler si nécessaire ; coordonner les fichiers communs. Une correction partagée se propose au dépôt propriétaire, sans publier du code client implicitement.
3. Partir de la référence origin/main actualisée et utiliser la branche de tâche imposée par le cycle Git, ou reprendre la branche non fusionnée de cette même tâche. Maintenir fiche d'impact, documents et tests concernés. Distinguer préparation locale, envoi autorisé et PR réellement ouverte.
4. Indexer seulement les fichiers de la tâche, relire le diff indexé et les commits qui seront envoyés. Utiliser Conventional Commits avec référence de travail. Avant push autorisé, vérifier explicitement remote/branche et contrôles applicables ; pour des fichiers de module modifiés, appliquer la [finalisation des verrous et archives](../test-and-package/SKILL.md#finalisation-dune-candidate-avant-push) après la dernière édition. Corriger par nouveau commit : aucun amend/rebase/force-push sur l'historique publié, aucun contournement de hooks pour masquer un échec.
5. Préparer ou actualiser une PR par branche vers main avec résultat, portée, impact, preuves et limites. Si main avance, l'intégrer dans la branche par merge explicite selon le cycle, puis vérifier la nouvelle candidate. Un succès d'une ancienne révision ne la valide pas.
6. Traiter retours et discussions puis demander la revue technique du SHA final à un autre agent. Conserver sa conclusion et ses limites hors du commit source ou dans un artefact lié à la révision. Le compte GitHub unique est autorisé ; aucune seconde identité ni approbation GitHub distincte n'est nécessaire. L'orchestrateur vérifie la revue, le workflow exécuté, ses résultats et la base à jour avant le squash autorisé. Ne pas fabriquer une approbation ni utiliser un bypass ; la publication conserve son mandat propre.

Sans accès GitHub autorisé, livrer fiche locale, diff ou patch et description prêts à soumettre sans inventer d'issue/PR. Le bilan indique précisément correction préparée, contrôles exécutés et état réel de la contribution ; il n'annonce pas un bug de production corrigé sur le seul dépôt d'une PR.
