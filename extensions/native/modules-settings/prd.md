# PRD — Modules et configuration

## Besoin

T-11, US-11, REQ-1101 à REQ-1106 : composer une application à partir de modules natifs, communs, métier ou tiers, avec graphe exact, contrats publics et changements explicites. L’administrateur voit ce qui est disponible, présent, actif, configuré et en attente de publication.

## Parcours

Consulter le catalogue et une fiche ; comprendre dépend de / utilisé par, versions, origines et contributions facultatives ; préparer un choix d’installation, update, activation, désactivation ou retrait ; examiner les impacts ; accepter un plan avec une révision et une clé idempotente. Relire ensuite le résultat ou le journal après une réponse perdue.

Ajouter ou activer demande de choisir administration, utilisateurs, les deux interfaces ou headless. Le plan expose ce choix, les dépendances ajoutées et les contributions facultatives désactivées ; aucune permission n'est attribuée par cette sélection. Un plan sans changement ne peut pas être accepté. Modules dépend d'Access : l'authentification ne peut pas être retirée en conservant ce gestionnaire actif.

## Garanties

Le résolveur commun part d’un inventaire compilé vérifié, jamais du graphe envoyé par le navigateur. Origines, versions et contrats sont contrôlés ; les modules hors périmètre restent identiques. Refuser rupture de dépendance, origine substituée, cycle, configuration manquante, plan trop gros, base périmée ou seconde acceptation concurrente. Retrait et désactivation conservent données et historique ; aucune purge dans ce module.

Les modèles privés head/plans/journal sont écrits via les plans du SDK dans le batch commun T06. Une permission dédiée creezio.modules-settings:manage s’applique aux comptes humains et délégations OAuth autorisées, dans l’audience admin et le contexte application. Aucune permission owner implicite.

## Interface et publication

Conserver les composants de liste/fiche Product Hub avec navigation SDK et états de panneau. Les docs de version installée sont distinctes des futurs PRD éditables et du Kanban métier T23. Le plan accepté ne devient effectif que lorsque le Worker publié embarque les digests cibles. Sites attend une publication demandée dans GPT ; Docker/Cloudflare utilisent leurs adaptateurs de livraison, sans architecture métier différente.

## Validation

Six suites du module, graphe transitif multiéditeur et optional autonome ; tests D1 du premier accept concurrent et du CAS suivant ; garde fraîche révoquée ; API/MCP et reprise idempotente ; recette navigateur sur le vrai Worker. T30 qualifie séparément distribution externe complète, et T32 le publisher.
