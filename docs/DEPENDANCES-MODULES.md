# Dépendances entre modules

Contrat commun aux modules natifs, communs, propres à une application et tiers. Un module peut dépendre d'un module de toute autre origine ; être livré avec Creezio ne dispense pas de déclarer cette relation. Une dépendance n'est ni une copie du module fournisseur ni un nouveau service à héberger. Ce contrat complète le [standard module](STANDARD-MODULE.md) et sa [distribution](EXTENSIONS-THEMES-ECOSYSTEME.md).

## Exemple et distinction des responsabilités

Un module panier utilise un catalogue de produits. Le panier possède ses lignes et ses règles ; le catalogue possède ses produits. Le panier déclare le catalogue comme dépendance obligatoire, sa plage de versions et le contrat public de consultation de produits qu'il consomme. Sans catalogue compatible et actif, le panier ne peut pas être activé. Le module catalogue pourrait lui-même dépendre d'un autre module : toute cette chaîne est contrôlée.

Un comparateur autonome peut, au contraire, proposer une intégration facultative au catalogue. Sans catalogue, il conserve ses comparaisons mais ne propose pas l'action de création d'un produit. Les contributions conditionnelles sont déclarées et testées, y compris au niveau d’une seule action de widget pour conserver ses autres actions, sans appel vers une opération absente ni fausse réussite. Si « ajout au panier » est seulement un widget du module boutique, sa dépendance est portée par le module ou son intégration, sans fabriquer un module par widget.

| Déclaration | Rôle |
|---|---|
| Dépendance de module Creezio | Disponibilité, version, origine et contrats publics requis d'une autre fonctionnalité dans la même application. |
| Bibliothèque npm / peer technique | Construction et exécution du paquet, par exemple React ou le SDK ; ne prouve pas qu'un module métier est installé ou activé. |
| Service externe | Configuration et disponibilité d'un fournisseur comme n8n, Stripe ou Meili ; aucune installation de ce service par Creezio. |
| Capacité d'hébergement | Possibilité réellement fournie par l'adaptateur, indépendante des modules et des droits commerciaux. |
| Permission utilisateur / droit d'édition | Autorisation de l'acteur ou entitlement ; posséder une dépendance ne confère aucun de ces droits. |

## Déclaration canonique et contrats publics

Le manifeste de chaque module décrit ses dépendances avec identifiant qualifié, origine attendue, plage de versions, caractère obligatoire ou facultatif, contrats publics requis avec leur propre plage de versions et contributions concernées. Ces données génèrent la documentation et alimentent le SDK ; pas de deuxième liste métier entretenue à la main dans le plugin GPT ou le thème. Les schémas versionnés du SDK sont la forme exécutable de ce contrat.

- **Obligatoire** : nécessaire à l'activation du module consommateur. Le module fournisseur doit être sélectionné, compatible et actif ; les prérequis de configuration de la fonction doivent être satisfaits. L'installation matérielle d'un paquet ne signifie pas que la fonction est utilisable.
- **Facultative** : le module consommateur a un fonctionnement autonome testé. Les opérations, vues, widgets, outils MCP, événements et projections dépendants appartiennent à une contribution explicitement conditionnelle. L'intégration ne s'active que si son fournisseur et ses contrats sont compatibles et disponibles. Une dépendance déclarée facultative ne peut masquer un appel obligatoire.
- **Transitive** : une dépendance a elle-même des dépendances, résolues avec les mêmes règles. Afficher la chaîne exacte expliquant une absence ou un conflit.

Une référence vers un modèle d'un autre module passe par un contrat public versionné : identités d'objets, schémas exportés, opérations ou événements documentés. Elle ne donne aucun accès direct à ses tables, fichiers R2, composants privés ou secrets. Une référence ne peut pas être rendue facultative simplement pour éviter le validateur : ses contraintes de données et de suppression restent effectives. Une relation obligatoire de données ne doit pas devenir orpheline lors du retrait d'une intégration facultative.

Une seule origine et une seule version effective par identifiant de module dans une composition. Deux consommateurs exigeant des versions incompatibles produisent un conflit explicite ; ne pas installer deux catalogues homonymes pour le contourner. Les cycles du graphe effectif (dépendances obligatoires et intégrations facultatives explicitement activées) sont refusés et leur chaîne est donnée. Deux intégrations facultatives éteintes ne constituent pas un cycle actif ; leur activation future repasse ce contrôle. Un besoin d'interaction réciproque se conçoit via contrats partagés, événements ou un module d'intégration sans cycle, pas avec un ordre de chargement accidentel.

Les modules natifs non désactivables sont identifiés par la politique du socle. Les natifs optionnels suivent le même graphe que les autres. Cette possibilité ne retire aucune des capacités natives demandées à la distribution de référence.

## Composition, résolution et verrou

La composition demandée distingue choix de l'application, activation et intégrations facultatives sélectionnées explicitement. La présence d'un fournisseur ne suffit pas à activer une intégration. Une intégration désactivée peut coexister avec une version incompatible du fournisseur ; ses références restent inaccessibles. Si elle est sélectionnée, une incompatibilité bloque son activation et la composition proposée, sans transformer la fonction en réussite factice. Le résolveur propose les dépendances transitives nécessaires depuis des origines autorisées. L'administrateur ou le mandat explicite de livraison accepte ce plan avant acquisition de nouveaux paquets, droits, configuration ou coût. Les métadonnées d'un tiers ne constituent jamais cette autorisation.

Le verrou de composition enregistre le graphe résolu, versions exactes, origines, références source, intégrités, contrats retenus et états d'intégration, directement ou par leurs empreintes de descripteur et de composition. Les arêtes désignent les nœuds exacts ; le gestionnaire affiche les détails depuis ces déclarations vérifiées. Il complète le verrou npm technique. Le build et la livraison contrôlent que sources, paquets et composition correspondent à ce verrou, sans nouvelle résolution à chaque requête. Les versions hors périmètre sont conservées. Une mise à jour obligatoire du socle ou d'un autre module est exposée dans le plan, jamais appliquée en cachette.

Le développement hors ligne utilise les sources ou artefacts déjà disponibles et vérifiés. Une dépendance non disponible bloque la préparation concernée avec diagnostic ; pas de téléchargement arbitraire ou de paquet homonyme de remplacement. Le retrait d'un paquet d'un catalogue n'arrête pas une version déjà déployée ; il peut empêcher une reconstruction future sans archive vérifiée. Le registre central ne devient pas une dépendance réseau de chaque opération métier.

Pour prévisualiser une mise à jour depuis des archives externes, l'outillage lit en mémoire le runtime, la validation détachée et leur reçu avec les trois SHA-256 attendus. Il vérifie les inventaires, l'identité, la provenance et une version strictement supérieure, puis fournit une entrée candidate au résolveur ; cette lecture n'installe aucun fichier et ne change ni composition, ni verrou, ni données. Les chemins candidats du verrou sont dérivés des empreintes vérifiées sous `.creezio/module-artifacts/<moduleId>/` pour le runtime et la validation ; les chemins déclarés par le reçu ne désignent jamais une destination d'écriture. Le plan recalcule ensuite compatibilité SDK/Core, dépendances et impacts. Après acceptation explicite, l'installation des archives versionnées et le nouveau verrou doivent être vérifiés sur leurs octets réels en conservant l'ancienne version pour retour arrière. Un plan prêt ne vaut ni installation ni publication.

Le build de l'application courante peut déclarer une candidate externe dans `configuration/module-inventory.json` sous `externalPackages`, avec `moduleId`, `packageName`, `version` et trois objets `runtime`, `validation`, `receipt` portant chacun un chemin local `.creezio/packages/` et son `integrity` SHA-256. Le build relit ces fichiers bornés et refait le préflight avant d'ajouter les seules métadonnées au catalogue ; le code de la nouvelle version n'est pas chargé. Pour générer le verrou après installation explicite du nouveau paquet, `modules:lock` accepte `--validation-receipt moduleId=chemin --cache-validation moduleId --write` : la validation déjà vérifiée est placée dans le cache adressé par empreinte. Sans `--cache-validation`, les verrous existants continuent de désigner le chemin du reçu ; le contrôle ultérieur d'un verrou canonique conserve son choix sans ce drapeau.

Lors de l'adoption de la version candidate, retirer sa déclaration `externalPackages` dans le même changement que la composition et le verrou, ou la remplacer par une candidate de version supérieure. Une déclaration qui vise la version désormais installée est refusée au build : le catalogue des mises à jour ne présente que des versions strictement supérieures à la version courante.

## Opérations du gestionnaire de modules

| Action | Vérification et résultat |
|---|---|
| Installer | Présenter dépendances directes/transitives, versions, origines, permissions, configuration, capacités et modules déjà présents. Refuser la composition invalide avant d'appliquer des changements de données ou de publier. |
| Activer | Recontrôler la composition courante et les fournisseurs requis ; activer dans l'ordre des dépendances. Une intention d'activation n'est pas un succès d'exécution. |
| Mettre à jour | Comparer ancienne et nouvelle composition, contrôler aussi les consommateurs et leurs contrats ; accepter une version compatible, refuser une rupture ou proposer un ensemble explicite de changements compatibles. |
| Désactiver | Afficher les dépendants directs et transitifs. Refuser de laisser un dépendant obligatoire actif ; proposer éventuellement leur désactivation groupée, sans l'exécuter implicitement. Retirer toutes les contributions concernées, dans le serveur et les interfaces. |
| Désinstaller | Appliquer les mêmes contrôles, y compris relations persistantes, ressources et obligations de données. Conserver données et historique par défaut ; leur purge est une opération séparée explicitement autorisée, jamais une cascade de suppression implicite. |

Ces contrôles sont communs à l'écran d'administration, l'API, MCP, la CLI et la chaîne de livraison. Le serveur revérifie droits, révision du graphe et préconditions au moment de l'action ; deux opérations concurrentes ne peuvent accepter chacune une composition devenue périmée. Des jetons ou appels directs ne permettent pas de contourner ces contrôles.

Un fournisseur temporairement indisponible ne désinstalle rien. La fonction dépendante retourne un état contrôlé ; le reste de l'application reste utilisable. Si le runtime détecte une incohérence de composition malgré les contrôles de publication, il refuse les opérations concernées et produit un diagnostic. Les widgets historiques et clients headless ne continuent pas à appeler une contribution devenue interdite : le serveur reste l'autorité.

## Interface et diagnostics

La fiche d'un module montre **« dépend de »** et **« utilisé par »**, versions et origines, relations directes/transitives, intégrations facultatives actives ou indisponibles, configuration manquante et motifs de refus. Le plan de changement distingue ajouts, mises à jour, désactivations et modules inchangés. Un exemple de diagnostic est : « Panier nécessite Catalogue >=2 <3 ; Catalogue 1.8 est sélectionné ».

Le SDK fournit les diagnostics structurés aux différentes interfaces. Les catalogues MCP admin et applicatif sont recalculés selon contributions et droits, sans exposer les diagnostics système aux utilisateurs non autorisés. Les messages d'erreur ne divulguent pas de secret ni de métadonnée d'un paquet privé inaccessible.

## Recettes et suivi

Le cas de référence comporte trois éditeurs et une chaîne panier → catalogue → module tiers. Couvrir : résolution compatible, absence à chaque niveau, mauvaise origine, conflit de versions, contrat public absent, cycle, désactivation et retrait refusés, update compatible et incompatible, conservation des données, accès API/MCP direct et widget historique. Le comparateur autonome prouve qu'une intégration facultative absente ou désactivée retire seulement ses contributions ; sa réactivation rétablit celles-ci après validation.

Le starter fournit un exemple autonome et une intégration déclarée ; la recette package utilise les véritables archives de plusieurs éditeurs, sans checkout voisin. Les suites backend/ui/api-mcp/widgets/package/docs couvrent chacune leurs conséquences. Les mêmes règles s'appliquent sur Sites, Docker local et Cloudflare ; elles ne créent pas de D1/R2 supplémentaire sur Sites.

Traçabilité : [REQ-0204](EXIGENCES.md#REQ-0204), [REQ-1104](EXIGENCES.md#REQ-1104), [REQ-1105](EXIGENCES.md#REQ-1105), [REQ-1106](EXIGENCES.md#REQ-1106), [REQ-3004](EXIGENCES.md#REQ-3004), [REQ-3803](EXIGENCES.md#REQ-3803). T-02 construit les contrats et validations statiques ; T-11 le résolveur et cycle de vie réel ; T-13/T-16 les contributions dynamiques ; T-30 les archives et le starter ; T-38 la recette de mise à jour dans le fork. Le témoin T30 de trois éditeurs installe réellement trois archives de test dans un hôte léger et compile leur composition ; il ne constitue pas une installation de trois modules métier publiés ni une recette de mise à jour de données.
