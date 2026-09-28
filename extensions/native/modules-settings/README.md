# Modules et configuration

Module natif de catalogue, dépendances et changements de composition. L’administration reprend les vues du Creezio original. Chaque action utilise les opérations communes et un droit explicite ; le choix d’une interface ne confère aucun accès.

Un plan accepté reste en attente de publication. L'administrateur confirme sa publication seulement si la composition et le verrou réellement embarqués dans le Worker correspondent tous deux à la cible. Cette confirmation devient un événement durable. Si la cible n'est plus celle du Worker, il peut annuler le plan en attente avec un motif conservé, puis préparer un nouveau plan depuis la baseline courante. Une divergence après clôture est montrée avant acceptation et exige une reconnaissance explicite. Aucun JavaScript distant n’est téléchargé à chaud, aucune donnée n’est supprimée par une désactivation.

Les plans acceptés avant ce cycle ne deviennent pas rétroactivement « effectifs » sans confirmation native. Si leur runtime a depuis changé, l'annulation motivée conserve l'ancien plan et ses preuves externes ; elle ne prétend pas que sa publication passée n'a jamais eu lieu. Le nouveau cycle doit être prouvé par un plan préparé et confirmé sous le contrat actuel.

Les fiches présentent README, PRD et changelog embarqués avec cette version, consultables aussi par API et MCP avec les mêmes droits. Le journal de l'application et les futures révisions de travail sont distincts du changelog de l'éditeur.

Le contrat et les limites sont dans [le PRD](prd.md) et le travail restant dans [TODO](TODO.md).

T16 ajoute une fiche de module en widget MCP Apps, réservée à l'audience administrateur. Elle réutilise l'opération `catalog.detail` en lecture seule et ses droits existants. La liste et la fiche Product Hub restent l'interface d'administration principale.
