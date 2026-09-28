# T19 — Support natif

Le module `creezio.support` conserve les vues de tickets et de discussion du Creezio original. Deux modèles D1 décrivent tickets et messages ; les opérations communes alimentent workspace, front, HTTP et MCP. Un utilisateur applicatif voit ses propres demandes ; un agent muni du droit d'administration du support gère la file du contexte. Ce droit métier ne donne pas les pouvoirs d'administration système.

Les réponses, statuts et attributions utilisent la révision du ticket. La lecture des messages est paginée ; un brouillon reste associé à son ticket et une réponse tardive ne vide pas une nouvelle saisie. Le journal public du SDK conserve la clé avant émission, puis permet une lecture de statut sans réexécuter la commande. La restauration attend la session vérifiée ; une panne transitoire conserve le brouillon masqué, un changement réel d'identité ou de contexte le purge.

Les six suites du module passent 18 contrôles, dont une justification explicite de l'absence de widget visuel : les outils de discussion restent textuels. Une intégration sur D1 réel vérifie partage autorisé, demandeur distinct, jeton machine, statuts, révisions et pagination des messages. Ces preuves ne remplacent pas la recette navigateur, le MCP hébergé ou la parité exhaustive.

Le module ne prétend pas envoyer d'email. Les relations aux contacts, à la messagerie et aux tâches nécessitent des contrats intermodules publics ; les raccords Work restent reportés avec T17. Aucun accès aux tables privées d'un autre module n'est introduit. La composition du socle et des thèmes est en intégration ; aucune nouvelle publication hébergée n'est attestée ici.
