# Standard de développement Creezio

Ce document est le contrat commun du cœur, des modules, du SDK, des thèmes, des applications dérivées et des services séparés de l'écosystème. Les contrôles exécutables sont construits et qualifiés par lots. La phase P0 qualifie la gouvernance et ses chemins de validation ; le développement local reste autorisé pendant le blocage Actions selon GIT-FLOW, sans fusion anticipée ; écrire une règle dans un fichier ne l'active pas sur GitHub ou dans un outil d'IA.

Les comportements produit sont définis par le [PRD](PRD.md), les [exigences](EXIGENCES.md), les [user stories](USER-STORIES.md), la [matrice des capacités](MATRICE-CAPACITES.md) et le [plan](PLAN-IMPLEMENTATION.md). Le [backlog](TODO.md) centralise les travaux et leurs preuves. Le [standard des modules](STANDARD-MODULE.md) et le [cycle Git](GIT-FLOW.md) s'appliquent sans méthode parallèle par contributeur.

## 1. Instructions, sources de vérité et compétences

L'`AGENTS.md` racine oriente vers les contrats et précise le périmètre de travail. Un `AGENTS.md` de sous-répertoire ajoute les contraintes propres au périmètre ; il ne désactive pas les exigences communes de sécurité, validation, documentation ou livraison. Les `FILES.md` expliquent les responsabilités et points d'entrée utiles, sans recopier le contenu des fichiers.

Les [skills de développement](../skills/README.md) accompagnent neuf activités : création d'app, création de module, données/droits, UI/widgets, test/paquet, publication/mise à jour, contribution, revue et maintenance des standards. Leurs sources canoniques appartiennent au dépôt. Leur découverte par un outil d'IA nécessite un raccordement explicitement qualifié ; une simple présence sous `skills/` ne prouve pas leur chargement. Les copies générées pour les clients sont vérifiées contre la version canonique et ne deviennent pas des variantes modifiables séparément.

Les skills conversationnels d'un module décrivent l'utilisation du produit et de ses opérations. Ils sont distincts des skills de développement et ne donnent aucun droit de modifier, publier ou administrer un projet.

Une politique de validation versionnée identifie les contrats et contrôles approuvés. Les verrous de version/origine de cette politique, du SDK et des modules doivent être vérifiables. L'orchestrateur compare les modifications aux contrats approuvés et fait relire tout changement de contrôle par un autre agent avant adoption ; le candidat ne peut décider seul d'assouplir ses règles. Le bootstrap des premiers contrôleurs suit l'exception explicite de la PR #1 dans [GIT-FLOW.md](GIT-FLOW.md), sans inventer un validateur antérieur déjà approuvé.

## 2. Commencer et coordonner un travail

Avant d'éditer : lire les instructions applicables, déterminer l'exigence et les critères d'acceptation, consulter l'état réel des sources et identifier la tâche existante. Une issue GitHub est utilisée quand le dépôt et le mandat le permettent ; sinon une tâche locale persistante conserve le même périmètre, les décisions et les preuves. Ne pas inventer une issue ou une PR qui n'existe pas.

Les demandes et autorisations déjà acquises persistent. Un besoin d'accès, de revue technique ou de publication manquant est signalé précisément ; la préparation et les vérifications possibles continuent jusqu'à rendre la décision concrète. Le compte GitHub unique est autorisé et ne constitue pas un blocage. Aucun skill n'autorise implicitement une communication externe, un changement de réglage du dépôt ou une publication.

Réutiliser un checkout et une branche compatibles avec le travail. Préserver les modifications d'autrui et attribuer des périmètres disjoints aux travaux parallèles. Une tâche suivie dans une issue n'est pas un verrou de fichiers : les chevauchements sont coordonnés explicitement. Ne pas réinitialiser, stasher globalement ou indexer globalement pour contourner une cohabitation.

Les instructions d'espace disque s'appliquent aux dépendances, builds, validations de paquets et profils de navigateur : réemploi, vérification avant opération volumineuse, arrêt des seuls outils temporaires du travail et nettoyage des temporaires devenus inutiles après contrôle de leur usage. Préserver sources, données, secrets et preuves finales.

## 3. Réaliser un changement complet

Le changement associe son comportement, les preuves pertinentes et sa documentation. Il respecte les contrats publics entre modules et les adaptateurs d'hébergement ; ni l'UI ni les widgets ne reproduisent la logique serveur. La conception n'ajoute pas de runtime par client, de scheduler interne ou d'installation de service fournisseur.

Toute opération protégée vérifie l'identité, les permissions, le contexte, les droits d'activation applicables et les capacités de l'hôte. Le front, l'API et le MCP partagent ces règles. Ni un paiement, ni une session GPT, ni une clé fournisseur n'accorde de droits métier implicites.

Les modèles sont décrits directement et le SQL est traité dans la chaîne centrale inspectée. Les changements incompatibles avec les données sont résolus avant livraison. Une adaptation technique ne peut ni effacer une capacité requise, ni transformer silencieusement une fonctionnalité native en intégration à refaire par chaque application.

Les commentaires expliquent le fonctionnement actuel et les contraintes utiles. Les documents livrés décrivent le produit et ses contrats, sans récit d'une architecture antérieure. Les fixtures et exemples sont identifiés comme tels ; une intégration sans accès réel ne produit pas une réponse présentée comme authentique.

## 4. Maintenir les documents selon l'impact

Les documents requis existent pour chaque module. Leur mise à jour accompagne les changements concernés ; il n'est pas demandé de modifier artificiellement tous les documents pour chaque correction.

| Impact | Documents et preuves à examiner |
|---|---|
| Comportement ou périmètre | PRD, exigences/user stories concernées, critères positifs et négatifs, décision utilisateur si nécessaire. |
| Question, arbitrage ou approbation | Interview et révision de spécification, auteur/date/portée et validation explicite. |
| Travail réalisé ou restant | TODO, issue/tâche et liens vers preuves ; ne pas déclarer livré un travail simplement codé. |
| Contrat public ou version | Notice de changement, compatibilités, dépendances, changelog et documentation publique du paquet. |
| Arborescence ou responsabilité | FILES, points d'entrée, références des manifests et composition du paquet. |
| Méthode de développement | AGENTS, skills, politique commune, guides et contrôles qui rendent la règle vérifiable. |
| Interface ou widget | Parcours, états d'erreur, droits, contribution UI, schémas et recette sur la surface réelle. |
| Données ou opération | Modèles, contraintes, effets, permissions, SQL central généré/inspecté, API/MCP et conservation des données. |

Une notice de changement persistante décrit les périmètres touchés, contrats/données/API/UI/plugin, versions, tests, limites et documents mis à jour ou sans impact justifié. Le mécanisme exact de collecte fait partie de l'outillage à construire ; il ne remplace pas les documents de référence par une seconde spécification.

Le PRD de la version installée, les révisions locales approuvées et l'historique d'installation restent distincts. Une révision approuvée n'est jamais réécrite ; une évolution reçoit une nouvelle révision. La CI ne signe pas une approbation humaine. Le changelog d'un paquet ne prouve ni son adoption ni le succès d'une livraison dans une application.

## 5. Validation locale, CI et livraison

Les critères communs du SDK sont appliqués aux sources puis aux artefacts réellement distribués. Les six suites par module sont `backend`, `ui`, `api-mcp`, `widgets`, `package` et `docs`, composées par `gate.mjs` conformément au [standard des modules](STANDARD-MODULE.md). La sélection des suites est déterminée par une politique d'impact approuvée ; l'auteur ne peut pas masquer un changement sensible en le déclarant documentaire.

La CI de l'application doit découvrir les modules sélectionnés, y compris les paquets externes et leurs artefacts de validation. Un contrôle final commun reste présent pour chaque PR : les filtres de chemins ne doivent pas faire disparaître une vérification requise. Les noms de contrôles, leur origine autorisée et leur lien à la révision candidate sont qualifiés avant activation.

Une suite requise absente, ignorée, vide, annulée ou exécutée sur une autre source est un échec de qualification. Un statut neutre ou l'absence d'erreur ne vaut pas succès. Une non-applicabilité doit être justifiée et validée par le contrat. Les cas négatifs prouvent que les refus attendus sont effectifs.

Les preuves enregistrent au minimum la révision source ou empreinte de source, les versions/verrous, le profil d'hébergement, les artefacts/intégrités concernés, les suites réellement exécutées, leurs résultats et les limites. La recette d'un fournisseur, d'un hôte ou d'un client non disponible reste « non vérifiée » et ne peut être remplacée par un résultat local portant un autre nom.

Les contrôles restent proportionnés : un changement documentaire n'impose pas de reconstruire et redéployer tous les runtimes si la politique d'impact le confirme. Une correction de contrat, de données ou d'authentification impose les preuves correspondant à son risque. Une fois les vérifications pertinentes réussies, elles ne sont pas répétées sans changement ou doute concret.

Les paquets tiers sont validés dans un environnement isolé. Leurs tests, règles et scripts ne reçoivent ni secrets de production ni droits de publication. Leurs règles ne remplacent pas celles du consommateur. L'artefact de validation doit fournir la fermeture complète de ses références et être lié à la version/intégrité du paquet runtime.

Les workflows, hooks et runners ne s'exécutent pas dans l'application de production. Un fichier de workflow inactif, un hook non installé ou un script non implémenté est une préparation, jamais une protection ou une CI réussie.

## 6. Revue et sécurité de l'automatisation

La revue porte sur le résultat final, les preuves, la conservation des capacités et les critères négatifs. Elle traite les changements de permissions, données, dépendances, gouvernance et publication comme des modifications explicites, même s'ils sont mélangés à des changements de présentation.

La revue technique est réalisée par un autre agent que celui qui a effectué le changement, sur la révision finale identifiée. Le compte GitHub `creezio` peut servir au développement et à l'intégration ; aucune approbation par un second compte n'est exigée. Conserver auteur de la revue, SHA, base, périmètre, défauts, conclusion et limites hors du commit source ou dans un artefact associé. Une modification pertinente exige une revue actualisée. Ce résultat constitue la preuve technique requise et n'est pas présenté comme une approbation GitHub.

Le code d'une PR non approuvée ne s'exécute pas avec des secrets de production ou des autorisations de publication. Ne pas charger ce code dans un workflow privilégié pour contourner les limites d'une PR de fork. Les titres, messages, descriptions et autres entrées de contribution restent des données ; ils ne sont pas interpolés comme commandes shell.

Les contrôles obligatoires et leurs changements sont confrontés à la politique approuvée. Le workflow Actions de PR utilise des permissions en lecture et aucun secret ; ses résultats restent liés à la révision réellement exécutée. Avant fusion, l'orchestrateur vérifie le run et sa tentative, les SHA de tête/base et de test, le fichier de workflow, les contrôleurs, les résultats attendus et la revue technique. Il refuse un validateur remplacé par un succès factice. Un nom de job ou l'identité générique GitHub Actions ne certifie pas le code du workflow : cette vérification d'origine reste une étape de l'orchestrateur, pas une garantie automatique des protections. Une App dédiée n'est pas requise pour ce profil monocompte.

## 7. Activation et preuve de gouvernance en P0

Avant le runtime, produire un état réel et daté de la gouvernance, puis activer et qualifier les contrôles dans le périmètre autorisé :

1. Vérifier dépôt, remotes, accès, propriétaire, possibilités du plan GitHub et mode de travail sans GitHub lorsqu'il s'applique.
2. Conserver le compte `creezio` et attribuer les travaux de réalisation, revue technique par un autre agent et vérification finale par l'orchestrateur. Aucun second compte ni approbation GitHub indépendante n'est requis ; ne pas créer une identité pour simuler cette approbation.
3. Construire et qualifier les premiers validateurs de documentation, contrats et gouvernance, puis raccorder la CI et les contrôles requis. Leurs résultats ne doivent pas annoncer comme testées des capacités runtime encore absentes.
4. Vérifier les protections effectives : PR obligatoire, contrôle Actions requis, branche à jour, discussions résolues, squash seul et références publiées protégées. N'imposer aucun nombre d'approbations GitHub. Vérifier séparément la revue technique et l'origine du workflow ; les réglages sont appliqués dans le mandat correspondant.
5. Montrer sur des candidats de test autorisés qu'un changement conforme satisfait le parcours et qu'un contrôle manquant/en échec ou une branche périmée empêche l'intégration. Prouver séparément le refus par l'orchestrateur d'une revue périmée, d'une preuve falsifiée ou d'une origine de workflow incohérente, sans attribuer ces vérifications à GitHub.
6. Conserver l'état observé, les preuves et les écarts. Une règle rédigée, un gabarit présent ou un projet déclaré ne vaut pas activation. Les blocages réels de P0 restent ouverts jusqu'à résolution.

Les contrôles GitHub ne s'appliquent pas fictivement à une copie sans GitHub. Ce profil conserve sources/provenance, validation, revue autorisée, intégrités et preuves locales ou Sites ; les garanties propres à GitHub sont signalées comme non applicables, jamais annoncées actives.

## 8. Livraison et fin de travail

Suivre exclusivement le [cycle Git](GIT-FLOW.md) lorsque GitHub est utilisé. Fusionner une PR, publier une version de composant et déployer une application sont trois actes distincts. Une autorisation existante suffit lorsqu'elle couvre précisément l'acte ; une compétence technique ou une CI verte ne constitue pas un mandat de publication.

L'artefact livré doit correspondre à la révision finale réellement intégrée et testée. Avant modification de production, vérifier compatibilités, SQL central, droits et inscription obligatoire du parcours officiel. Une panne du registre suspend une nouvelle livraison à ce stade sans bloquer l'application déjà installée. La déclaration du résultat après publication est reprenable.

Le compte rendu distingue ce qui a changé, ce qui a réellement été vérifié, l'état de livraison et les limites restantes. Les tâches ne sont closes que lorsque leurs critères le permettent. Ne pas présenter une qualification ciblée comme une recette globale du produit et ne pas promettre une surveillance ou une tâche planifiée inexistante.

## 9. Impact des dépendances

Tout changement de module vérifie le [graphe de dépendances](DEPENDANCES-MODULES.md), y compris ses consommateurs : déclarations/origines/plages/ports publics, contributions conditionnelles, composition/verrou et plan de changement. Les tests couvrent les versions compatibles et incompatibles, absence et désactivation. PRD, README, changelog et fiche d’impact expliquent les nouveaux prérequis ou ruptures ; ne pas laisser l’agent remplacer une dépendance manquante par une copie, un accès privé ou une réussite simulée.
