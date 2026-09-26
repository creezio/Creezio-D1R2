# Cycle Git, revue et livraison

Cette méthode est commune au cœur, aux modules, aux applications et aux services séparés. Elle définit les contrôles à mettre en place et à qualifier en P0 ; elle ne prétend pas que les protections GitHub, workflows, hooks ou comptes nécessaires sont déjà actifs. Voir le [standard de développement](DEVELOPMENT-STANDARD.md).

## 1. Branches et références

`main` contient le travail intégré. Elle n'implique ni publication de chaque commit ni déploiement automatique. Le flux est unique : branche de travail issue de `main`, PR vers `main`, revue technique par un autre agent sur la révision finale et intégration **squash**. Le compte GitHub `creezio` est conservé : une seconde identité GitHub et une App de contrôle dédiée ne sont pas des prérequis.

| Référence | Usage |
|---|---|
| `module/<module-id>/<work-id>-<sujet>` | Changement centré sur un module. |
| `core/<work-id>-<sujet>` | Cœur, SDK, adaptateur ou changement transversal. |
| `docs/<work-id>-<sujet>` | Documentation et contrats sans réalisation runtime. |
| `release/<release-id>` | Préparation des versions, changelogs, références et verrous à publier. |
| `main` | Intégration stable, protégée par le processus une fois P0 qualifiée. |

L'identifiant de travail renvoie à une issue ou une tâche réellement enregistrée. Les branches sont courtes et supprimées après vérification de l'intégration et de l'absence de travail restant. Il n'y a pas de branche `develop`, de branche personnelle permanente ou de succession de PR fondées sur des branches non intégrées. Une demande large est divisée en travaux cohérents et liés.

`release/*` est une **branche de travail**, pas une seconde branche stable : les commits de préparation y sont poussés dans le mandat de travail, puis une PR revue la fait entrer dans `main`. Les restrictions empêchant tout commit sans PR ciblent `main` et les références publiées ; elles ne doivent pas rendre ce parcours de préparation impossible.

**Bootstrap autorisé le 26 septembre 2026 :** étendre la [PR #1](https://github.com/creezio/Creezio-D1R2/pull/1) de cadrage au P0 sur sa branche actuelle, avec nouveaux commits, description et preuves actualisées. Cette exception initiale au découpage documentation/implémentation évite une série de PR dépendantes ; elle n'autorise ni push direct sur `main`, ni fusion sans CI et revue technique. Les premiers contrôleurs sont examinés et testés sur leurs cas positifs/négatifs avant adoption, sans prétendre disposer d'une version approuvée antérieure qui n'existe pas encore. Après son squash, les travaux suivants repartent du nouveau `main` vérifié.

## 2. Préparer un changement

1. Lire les instructions, les contrats, l'exigence et la tâche ; définir résultat attendu, critères négatifs et preuves.
2. Vérifier le dépôt, le remote, la branche courante, les modifications présentes et les droits. Ne jamais déduire le remote d'un simple nom de dossier.
3. Réutiliser la branche correspondant déjà au travail ou partir de `origin/main` actualisé. Préserver les modifications non committées et le travail d'autres personnes ; coordonner les chevauchements ou utiliser un checkout disponible approprié.
4. Réaliser code, contrôles et documents selon l'impact. Les changements d'un module commun appartiennent à son périmètre amont, sans copie locale servant à éviter son contrat ou sa maintenance.

Ne pas utiliser de remise à zéro, de stash global ou d'indexation globale pour nettoyer le travail d'autrui. Ne pas créer un nouveau checkout ou une installation de dépendances par défaut.

## 3. Commits, push et PR

Indexer les chemins concernés, relire le diff indexé et produire des commits traçables. Le format des messages est `<type>(<scope>): <résultat>`, avec la tâche liée dans le corps quand nécessaire. Le scope identifie le cœur, le module ou le périmètre documentaire. Les messages ne contiennent ni secret ni donnée client.

Le push vise seulement la branche de travail sur le remote vérifié et dans le mandat existant. Ne pas pousser directement `main`, utiliser `--no-verify`, sauter les contrôles, forcer le push ou réécrire l'historique publié. Les corrections après publication de la branche sont de nouveaux commits. Les opérations locales non publiées restent soumises à la préservation des changements présents.

Une branche correspond à une PR, créée en brouillon tant que le changement n'est pas prêt. Sa description est tenue à jour et décrit le problème, le comportement final, la tâche, les contrats/données/UI affectés, les preuves réellement exécutées, les limites et les éventuels changements de gouvernance. Elle ne conserve pas un ancien périmètre devenu faux.

Une autorisation de travailler n'est pas une autorisation générale de communiquer ou publier ailleurs. Les autorisations déjà données sont réutilisées ; ne pas demander une nouvelle approbation à chaque push lorsqu'elles couvrent l'action. En l'absence de mandat nécessaire, terminer la préparation et indiquer l'acte précis restant à autoriser.

## 4. Actualisation et revue technique

La PR doit être à jour avec `main`. Si `main` avance, fusionner `origin/main` dans la branche de travail, résoudre les conflits en préservant les comportements requis et utiliser un commit de synchronisation explicite, par exemple `chore(sync): intégrer main`. Ne pas rebaser une branche publiée et ne pas forcer son push. Cette méthode ne dépend pas d'une merge queue.

Les contrôles pertinents sont réexécutés sur le candidat actualisé. La revue porte sur son contenu final et sa composition avec `main`, pas seulement sur une ancienne tête de branche. Une modification pertinente ou un conflit résolu après revue exige une nouvelle revue du périmètre affecté ; l'orchestrateur n'utilise pas une conclusion devenue caduque.

Un autre agent que celui qui réalise la modification effectue la revue technique. Il identifie le SHA final, sa base, le périmètre, les preuves examinées, les défauts et sa conclusion. Ce résultat est conservé hors du commit source ou dans un artefact rattaché à cette révision, afin que son enregistrement ne modifie pas le code revu. Le même compte GitHub peut pousser et fusionner ; aucune auto-approbation GitHub n'est fabriquée et aucune deuxième identité n'est exigée. Une revue humaine peut compléter la revue technique.

La revue vérifie critères d'acceptation, cas négatifs, conservation des données et des interactions, qualité des preuves, portée des droits et changements des contrôles eux-mêmes. Les discussions doivent être résolues. `CODEOWNERS` peut orienter la revue, mais ne prouve ni une approbation ni une protection effective.

Avant fusion, l'orchestrateur rapproche PR, tête/base et éventuel commit de test fusionné, run/attempt, fichier de workflow réellement exécuté, contrôleurs et résultats. Il relit spécifiquement toute modification du workflow ou de ses validateurs contre les contrats approuvés. Un check homonyme ou déclaré par GitHub Actions ne remplace pas cette vérification : la protection GitHub ne certifie pas l'identité du fichier de workflow. L'absence de preuve, un résultat périmé ou un défaut non résolu empêche la fusion par l'orchestrateur ; ce contrôle de procédure n'est pas présenté comme une protection GitHub automatique.

## 5. Intégration dans main

Un mainteneur autorisé intègre la PR par le mécanisme **squash de GitHub**, une fois les contrôles requis et la revue finale satisfaits. Le titre du commit squash suit le format de commit commun et résume le résultat. Ne pas faire un merge local suivi d'un push de `main`, choisir un autre mode d'intégration ou utiliser un bypass pour gagner du temps.

Après intégration, relire la nouvelle révision réelle de `main` et vérifier les contrôles attendus sur cette révision. Une PR verte ne prouve pas à elle seule que l'état intégré est vérifié. Identifier le commit résultant et les tâches couvertes.

Supprimer la branche seulement après avoir vérifié que tout son travail est intégré et qu'aucune modification, PR ou activité restante n'en dépend. Une fusion squash change les identifiants de commit : un simple test d'ascendance ne suffit pas à décider de la suppression. Ne pas retirer un checkout utilisé par une autre activité.

Le travail suivant repart du `main` vérifié. Une issue exigeant une mise en production n'est pas automatiquement close à la seule fusion ; la déclaration de réalisation suit ses véritables critères.

## 6. Préparer et publier une version

Après intégration et vérification des changements fonctionnels, créer une branche `release/<release-id>` depuis le `main` actuel. Elle prépare seulement versions, changelogs, documentation de livraison et verrous nécessaires. Une nouvelle fonctionnalité découverte à ce stade passe par sa propre branche de travail.

Cette préparation suit la même PR à jour, la même revue technique et le même squash vers `main`. **Le squash produit une nouvelle révision de `main`.** Construire et tester l'artefact publiable depuis cette révision finale, avec ses versions et verrous définitifs. Ne pas publier l'ancien build de la PR, même si son diff paraît identique.

Les contrôles associent commit source, profil, dépendances, contenu assemblé, intégrité de l'artefact et résultats. Le candidat testé est celui qui est publié. Si une étape de publication impose une reconstruction, son identité/contenu doit être revérifié et les preuves nécessaires rétablies avant annonce de réussite. Les préparations d'une même version de composant sont sérialisées pour éviter collisions et doubles publications.

Les versions et tags sont indépendants :

- `core/vX.Y.Z` pour le cœur ;
- `module/<module-id>/vX.Y.Z` pour un module ;
- `app/vX.Y.Z` pour une application ;
- `registry/vX.Y.Z` pour le service de registre.

Ces formats désignent des catégories, pas des versions déjà publiées. Les tags et artefacts publiés sont immuables et reliés au commit source final. Ne pas déplacer un tag pour corriger une livraison : publier une nouvelle version après le parcours de correction. La politique protège ces références sans interdire aux responsables autorisés de créer une nouvelle référence conforme.

Le mandat de publication précise cible, composant, version et environnement. Fusion, publication du paquet et déploiement d'une application sont trois actes distincts. Une release disponible n'est pas automatiquement installée dans les dérivés.

## 7. Livraison de l'application

Le profil d'hébergement détermine le mécanisme de livraison, pas la logique métier. Sur Sites, l'utilisateur ou une tâche GPT explicitement configurée demande la publication dans GPT. Il n'y a pas de publication Sites déclenchée par le back-office. Depuis Docker local, le module de livraison passe par un exécuteur autorisé et limité.

Avant les effets de production, vérifier l'inscription requise au registre, les droits de publication, l'artefact final et le SQL central inspecté. Une panne à cette étape suspend la livraison et préserve l'application courante. Le SQL compatible s'applique avant le code qui en dépend ; son application est immuable et un retour au code précédent n'annule pas la base. Vérifier la compatibilité du retour de code prévu.

Après publication, vérifier l'application réelle, ses données, fichiers, droits et version. La déclaration au registre indique le résultat réel ; son échec est reprenable sans transformer une livraison réussie en état mensonger. Aucune clé fournisseur ni donnée métier n'est envoyée au registre.

## 8. Protections à activer et qualifier

La cible de gouvernance comprend PR obligatoire vers `main`, contrôle Actions requis et à jour, discussions résolues, branche à jour et squash seul. Elle n'impose pas d'approbation GitHub par un autre compte : la revue technique liée au SHA est vérifiée par l'orchestrateur. Les pushes forcés et suppressions des références protégées sont interdits. Aucun bypass n'est utilisé pour fusionner ; les secrets de publication ne sont pas accessibles aux tests du candidat.

Les contrats approuvés guident le contrôle et la revue des validateurs. Après le bootstrap, leur évolution est comparée à la révision précédemment approuvée avant adoption ; le candidat ne décide pas seul de retirer ses contrôles. Le résultat agrégé refuse une suite requise absente, annulée, ignorée ou non exécutée ; les filtres de chemins ne doivent pas soustraire la PR au contrôle requis. Le check Actions fournit une preuve d'exécution, sans constituer un service externe de décision de fusion.

Les workflows de PR utilisent des permissions en lecture et n'exposent pas de secrets de production au code du candidat. Les workflows privilégiés ne chargent pas arbitrairement les scripts d'une PR non approuvée. Les réglages réellement disponibles, leur portée et les garanties sur les tags sont vérifiés dans le dépôt concerné ; un fork n'hérite pas nécessairement des réglages de sa source. Le [fonctionnement des status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/troubleshooting-rules) explique pourquoi leur nom ne lie pas la preuve à un workflow précis ; ne pas promettre cette garantie pour le dépôt personnel.

La phase P0 consigne l'état distant observé, active les mesures autorisées et démontre acceptation d'un candidat conforme ainsi que refus d'un candidat invalide. Des fichiers de configuration, exemples de workflow et hooks inactifs ne prouvent aucune protection. Toute impossibilité effective reste visible ; elle n'est pas masquée par une promesse ou un compte rendu vert.

## 9. Parcours sans GitHub

Une application peut être créée depuis une release précise sans compte GitHub. Conserver origine, version, intégrité et modifications locales sans prétendre qu'il s'agit d'un fork GitHub. Un rattachement ultérieur à un dépôt est possible et doit préserver cette provenance.

Si Git local est disponible, garder les mêmes branches de travail et la traçabilité des commits ; l'intégration locale contrôlée n'est pas présentée comme une PR GitHub. Sans Git, enregistrer l'empreinte de source, les changements, décisions, révisions et artefacts dans le dossier de travail. Ne pas créer de dépôt distant implicitement.

Les contrats, tests pertinents, revue technique par un autre agent, identité des artefacts et mandat de publication restent requis dans le profil local ou Sites. Les contrôles propres à GitHub sont explicitement non applicables, pas artificiellement réussis. Cette voie doit pouvoir produire une livraison vérifiée sans fabriquer d'issue, de PR, d'approbation distante ou de protection active.
