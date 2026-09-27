# PRD — Modules et configuration

## Besoin

T-11, US-11, REQ-1101 à REQ-1106 : composer une application à partir de modules natifs, communs, métier ou tiers, avec graphe exact, contrats publics et changements explicites. L’administrateur voit ce qui est disponible, présent, actif, configuré et en attente de publication.

## Parcours

Consulter le catalogue et une fiche ; comprendre dépend de / utilisé par, versions, origines et contributions facultatives ; préparer un choix d’installation, update, activation, désactivation ou retrait ; examiner les impacts ; accepter un plan avec une révision et une clé idempotente. Relire ensuite le résultat ou le journal après une réponse perdue.

Ajouter ou activer demande de choisir administration, utilisateurs, les deux interfaces ou headless. Le plan expose ce choix, les dépendances ajoutées et les contributions facultatives désactivées ; aucune permission n'est attribuée par cette sélection. Un plan sans changement ne peut pas être accepté. Modules dépend d'Access : l'authentification ne peut pas être retirée en conservant ce gestionnaire actif.

## Garanties

Le résolveur commun part d’un inventaire compilé vérifié, jamais du graphe envoyé par le navigateur. Origines, versions et contrats sont contrôlés ; les modules hors périmètre restent identiques. Refuser rupture de dépendance, origine substituée, cycle, configuration manquante, plan trop gros, base périmée ou seconde acceptation concurrente. Retrait et désactivation conservent données et historique ; aucune purge dans ce module.

Le catalogue distingue la configuration de composition et celle qu'un fournisseur administre au runtime. Un réglage obligatoire ordinaire absent de la composition est « Configuration manquante » ; un réglage obligatoire associé à `provider` et absent de la composition reste « Configuration inconnue / Fonctionnement non vérifié », faute d'état runtime autorisé dans l'inventaire statique. Cette projection ne lit pas les données privées d'un autre module et ne bloque pas ses opérations ; l'état réel se consulte par le parcours autorisé du fournisseur.

Les modèles privés head/plans/journal sont écrits via les plans du SDK dans le batch commun T06. Une permission dédiée creezio.modules-settings:manage s’applique aux comptes humains et délégations OAuth autorisées, dans l’audience admin et le contexte application. Aucune permission owner implicite.

## Interface et publication

Conserver les composants de liste/fiche Product Hub avec navigation SDK et états de panneau. Les docs de version installée sont distinctes des futurs PRD éditables et du Kanban métier T23. Le plan accepté ne devient effectif que lorsque le Worker publié embarque les digests cibles. Sites attend une publication demandée dans GPT ; Docker/Cloudflare utilisent leurs adaptateurs de livraison, sans architecture métier différente.

## Documentation installée

T-12, US-12, REQ-1201/1202 : lire README, PRD et changelog de la version réellement embarquée depuis la fiche, les API ou le MCP administrateur. Les trois documents proviennent des mêmes octets vérifiés que l'archive runtime sélectionnée. Les documents de développement et les versions candidates non sélectionnées ne sont jamais exposés. La visibilité déclarée ne remplace pas les droits d'accès.

La liste fournit version, révision source, intégrité runtime et empreinte du document. La lecture est bornée à 64 Kio par document, par blocs UTF-8 de 16 Kio. Un changement d'intégrité entre deux lectures impose une nouvelle liste ; aucune concaténation de versions. Le client vérifie la taille et l'empreinte du document complet, puis l'affiche comme texte échappé dans les cartes PRD/Documents/Changelog originales. Erreurs et révocations retirent le contenu devenu non autorisé. Aucun filesystem ou appel GitHub n'est nécessaire au runtime.

Changelog éditeur, journal des installations et révisions locales de travail restent distincts. T23 réalisera l'édition et la validation humaine du PRD de travail ; consulter un document installé n'en crée pas une révision approuvée.

## Validation T11 et T12

Six suites du module, graphe transitif multiéditeur et optional autonome ; tests D1 du premier accept concurrent et du CAS suivant ; garde fraîche révoquée ; API/MCP et reprise idempotente ; recette navigateur sur le vrai Worker. T30 qualifie séparément distribution externe complète, et T32 le publisher.

## Widget de fiche T16

Le widget administrateur `module-detail` rend la sortie de l'opération de lecture `catalog.detail` dans un hôte MCP Apps. Son bouton de relecture appelle le même outil MCP, sans écriture ni tour IA. Il conserve les droits `manage`, l'audience `admin`, un texte de repli MCP et une ressource HTML compilée et versionnée. L'interface Product Hub existante et ses opérations de plan restent inchangées. La recette multi-module et ChatGPT réel appartient à T16 ; les tests du module valident les contrats locaux.
