# Backlog de réalisation
Révision 40 — 28 septembre 2026. **Release initiale de l’original publiée ; jalon première app en cours.** La révision fonctionnelle Core `0078fc7defc22d27e8caf22ac3b967f36fc30fbc` (PR #39) porte le correctif conservateur T32 (CI main 1 183/1 183). La révision fonctionnelle Lab `949f028dbbe99ab586c02c42c82e51f145379b23` (PR #6) a passé 1 186/1 186 tests CI et adopte ce code sans changer son front, son SDK 1.1.0 ni son module d'achat 0.1.2. Original et Lab servent la version 5 de leurs deux Sites publics, avec registre synchronisé. Les anciens widgets, brouillon, demandes et fichiers Lab sont conservés après mise à jour ; une lecture de widget historique APP réussit, la même route ADMIN avec le seul cookie APP refuse en 401, puis la session APP reste valide. Le MCP applicatif a réellement lu `get/list` dans ChatGPT. Les anciens plans Sites/Linux sont annulés avec journal explicite, sans confirmation rétroactive. La première capture Cloudflare Lab a refusé un tour inconnu sans reçu fournisseur, avant import ou publication ; le transfert distinct a vérifié 2 265 lignes D1 et un objet R2 ; sa publication du même artefact est confirmée (71 modules, 41 assets, registre synchronisé). Après arrêt Docker, les données et l'ancien tour incertain ont été relus sur Cloudflare ; une nouvelle réponse OpenAI réelle est persistée ; le navigateur confirme trois widgets historiques après rechargement, mais un ancien texte IA surestime un montant par cent. Aucun lot partiel n’est déclaré entièrement vérifié.

## Jalon prioritaire : première app utilisable

T-14/T-15, le SDK et le paquet témoin sont consommables. Les anciens widgets sont rétablis et le cycle durable est intégré ; la priorité est de terminer la recette applicative Cloudflare de Lab, dont la publication et la conservation native de l'historique incertain sont confirmées. Les Sites A/B version 5, les lectures MCP ChatGPT et le refus d'audience du widget natif sont déjà prouvés dans leur périmètre. La recette ciblée T-39 et le retour utilisateur suivent ; les lots différés gardent leurs exigences.

Après ce jalon, avancer d'abord les parties indépendantes de T-18 à T-22, T-25 à T-29 et T-33, puis les parties indépendantes de T-36/T-39 et leurs recettes propres ; compléter T-36/T-39 exhaustifs après les lots dont ils dépendent. T-17 Work est dans le dernier bloc, suivi de T-23/T-24 et des raccords dépendants. T-23/T-24 exigent un plan expliqué et une validation explicite préalable. T-34 premium et T-35 accompagnement avec accès au code exigent aussi une validation explicite future ; reconstruction WinHub/TempoFlow interdite avant un tel accord. Les compléments T-04/T-05/T-06/T-10 hors première app sont reportés, à expliquer en détail avant reprise. L'ancien GO est restreint par ces priorités du 28 septembre ; les exigences et preuves futures demeurent.

## Avancement lisible

Le statut global d'un lot couvre tous ses critères, parfois plusieurs étapes du développement. Il ne signifie pas que tous les lots ouverts sont travaillés simultanément. Le tableau suivant distingue les acquis du travail restant, sans changer les exigences.

| Lot | Acquis intégrés et testés | Reste à faire | Activité actuelle |
|---|---|---|---|
| T-01 — Gouvernance | Branches/PR, protections GitHub, revue indépendante, CI et refus d'un candidat invalide | Qualification des futurs parcours de release et de publication | Suivi transversal ; fondations acquises |
| T-02 — Contrats | Schémas, validateurs, dépendances et verrous ; cas valides et invalides | Intégration complète des vrais modules et paquets tiers en T-11/T-30 | Fondations acquises |
| T-03 — Runtime | Worker commun, composition, build, démarrage local, persistance et budgets | Qualification du workspace/front complets au fil de leur construction | Fondations acquises |
| T-04 — Comptes et droits | Comptes, sessions, rôles, tokens machine, impersonation, connexion/installation et écrans Access originaux locaux | Autres parcours d'administration, remise des liens, OAuth et recettes hébergées | Raccordement OAuth avec T-10 |
| T-05 — Données | Compilation SQL centrale, accès D1 protégé, fichiers R2 et coffre | Explorateur, recherche, export/restauration, évolutions de modèles restantes et recettes hébergées | Fondations acquises ; autres fonctions à construire |
| T-06 — Opérations | Registre/exécuteur intégrés PR #15 ; bindings HTTP et suivi par clé PR #16 | Événements, approbations, interopérations et autres transports | Fondations disponibles ; compléments au backlog |
| T-07 — Workspace | Composants originaux adaptés ; panneaux observés sur A/B et vues métier sur B, avec conservation ciblée après mise à jour Lab | Autres modules et comportements workspace non exercés sur Sites | Tranche locale et Sites A/B qualifiée dans ce périmètre |
| T-08 — Registre central | Registre publié ; propriétaire vérifié, projet Lab et installations Sites/Cloudflare créés ; jetons chiffrés ; publication Sites Lab synchronisée | Parcours email et autres raccords | Sites et Cloudflare Lab déclarés |
| T-09 — Sites | Original A et Lab B version 5 publiés ; anciens widgets, brouillons et D1/R2 conservés | Recettes complémentaires au-delà du témoin | Deux Sites et mise à jour ciblée qualifiés |
| T-10 — MCP/OAuth | Catalogues admin/app distincts ; admin ChatGPT qualifié historiquement ; MCP app Lab 0.1.2 connecté, carte/liste et modes direct/contexte/message exercés | Approbations et parcours de refus hébergés ; limite du picker documentée en T40 | Recette MCP app réalisée dans ce périmètre |
| T-11 — Modules | Catalogue, dépendances, plans D1, UI originale et adoption 0.1.2 ; cycle durable intégré ; anciens plans clôturés honnêtement | Autres recettes du cycle de modules | Tranche ciblée intégrée et qualifiée |
| T-12 — Documentation | PR #21 : README/PRD/changelog exacts, UI/API/MCP et recettes locales/CI, 923 tests | Recettes hébergées transversales ; édition des PRD de travail en T-23 | Documents installés vérifiés localement |
| T-13 — Fronts et thèmes | PR #22 : deux thèmes, projection native app, headless et CI ; front Lab ChatGPT-like et vues du module 0.1.2 conservés sur Site B version 5 | Autres profils et interactions de thèmes/fronts | Tranche locale et Site B qualifiée dans ce périmètre |
| T-14 — Conversations | PR #23 : chat original, historique, brouillons D1, fichiers R2, autorisations ; recette Sites avec T15 | Enrichissement widgets et autres compléments | Livrable local et Sites disponible |
| T-15 — OpenAI | PR #24 intégrée ; réponses réelles locales/Sites A/B, front/workspace ; reprise et arrêt locaux ; témoin Site A post-correction | Autres modèles, fournisseurs et voix non exercés | Première tranche locale et Sites qualifiée |
| T-16 — Widgets | Trois modes exercés dans Linux Lab et ChatGPT ; anciens widgets conservés sur B ; lecture native APP 200 et refus ADMIN 401 avec cookie APP | Interactions restantes et approbations | Régression historique et frontière d'audience qualifiées dans ce périmètre |
| T-30 — SDK/starter | SDK `sdk-v1.1.0` et starter `module-v0.1.2` publics ; démo locale, module réel 0.1.2 sur Site B et widgets de lecture dans ChatGPT ; actions Linux par Tab/Return | Démo Cloudflare et autres critères du lot ; clic pointeur iframe non observé | Distribution et adoption du témoin qualifiées, lot incomplet |
| T-31 — Docker local | Persistance, redémarrage/restauration ; évolution centrale du schéma qualifiée dans Lab sans réinitialisation | Futurs modules et recettes complémentaires | Raccord qualifié dans le même volume |
| T-32 — Cloudflare direct | Original publié et mis à jour avec D1/R2 conservés ; correctif de capture intégré Core/Lab | Démo, autres reprises et exactitude de la prose IA historique | Publication Lab, conservation, réponse OpenAI et widgets navigateur confirmés |
| Autres lots T-17 à T-39 | Voir les prérequis déjà fournis ci-dessus | Modules, publications et recette finale | À réaliser selon le jalon prioritaire |

## Règles de suivi
États autorisés : à faire, en cours, bloqué (raison/prérequis), en revue, vérifié, livré. Enregistrer responsable réel, branche/issue ou tâche locale, PR, SHA, tests/profils et preuves à chaque transition. « Livré » exige version et livraison vérifiée ; fusionner ne suffit pas. Une dépendance fournisseur manquante bloque sa recette, pas toutes les tâches indépendantes.
Après GO, commencer P0 puis les fondations P1/P2 consommables par la première app ; les dépendances ci-dessous priment sur le numéro du lot. Qualifier Sites et Cloudflare dès que leurs accès respectifs le permettent, sans bloquer les travaux locaux ni l'un par l'autre. P3/P4 avancent par tranches couplées : achever chat/widgets, installer un module métier témoin et valider son paquet. Le jalon initial T-36/T-39 exige les capacités et preuves de cette première app ; le périmètre complet des lots reste ouvert jusqu'à ses propres recettes. Ce GO historique est soumis aux restrictions de priorité du 28 septembre ci-dessus.
Chaque ligne constitue un lot de PR de taille révisable, pas une autorisation de tout coder dans une seule branche. Avant son exécution, décomposer les sous-tâches dans le PRD/TODO du module avec critères hérités ; enregistrer leurs liens ici. Cette décomposition ne peut ni retirer une exigence ni faire passer un lot partiel à « vérifié ».
## Jalons de dépendance et qualifications différées

Une dépendance consomme un **livrable précis et testé**, pas automatiquement l’achèvement mondial de toutes ses recettes. Enregistrer séparément `livrable local vérifié`, `qualification Sites`, `qualification Cloudflare`, `recette dérivée`. Une exigence reste partiellement qualifiée tant que ses profils requis manquent ; pas de case globale « vérifié » anticipée. Pour les tâches non listées, les critères pertinents du livrable doivent être satisfaits avant son utilisation.

| Prérequis consommable | Ce qui autorise la suite | Ce qui reste à qualifier et où |
|---|---|---|
| T-01 → T-02/T-03 | Contrôleurs locaux testés/revus, protections appliquées et CI des PR puis de main réussies après régularisation Actions | Contrôles fonctionnels ajoutés par T-02 puis modules ; la preuve de SHA/artefact est d’abord un test du contrôleur, pas une release de CMS. |
| T-02 → T-03/T-11 | Schémas/validateurs SDK exécutés sur fixtures valides/invalides ; aucun runtime applicatif prétendument testé | Six suites de vrais modules et intégration hôte en T-11/T-30 ; répétition pertinente sur les modules ultérieurs. |
| T-04 → T-05 | Identités et droits persistants, transport et entrée natifs, installation locale explicite qualifiés sur main | T-04 reste ouvert : administration visuelle, remise des capacités, profils hébergés et autorisations transversales nécessitent T-06/T-07/T-10. Aucun jalon ne vaut clôture de ces exigences. |
| T-05 → T-06 | Sous-ensemble D1/R2/coffre et modèles composés nécessaire aux opérations, avec garanties et preuves propres | Explorateur, recherche, export/restauration et autres critères T-05 restent ouverts jusqu'à leurs recettes. Les opérations administratives Access utilisent le registre commun de T-06. |
| T-04/T-05/T-06/T-07 → T-08/T-09/T-31 | Comptes, modèles, fichiers, opérations et workspace construits et testés localement | T-09 teste la tranche sur Sites ; T-32 sur Cloudflare. Les fonctions ajoutées ensuite repassent la recette hôte avant T-36. |
| T-10 à T-16 → première app | Contrats et code testés sur l’environnement disponible, avec refus ; aucune intégration fournisseur annoncée réelle sans accès | Les profils requis par la première app sont qualifiés au jalon initial ; les autres modules et fournisseurs T-17 à T-29 gardent leurs preuves et leur clôture propres après ce jalon. |
| T-12 → T-23 | Documentation installée, lecture autorisée et distinction des révisions prouvées | Édition/validation/immutabilité du PRD de travail réalisées en T-23. |
| T-30 → T-32 | Paquet du module métier témoin installé dans une app hôte locale indépendante et démo locale autonome ; docs/tests/artefacts de cette tranche | Démo Cloudflare en T-32 ; installation/update dans le vrai fork après création de B, en T-38. Les compléments du starter restent suivis dans T-30. |
| T-08/T-30/T-31 → T-32 | Publication Cloudflare de l'original et de la démo avec transfert/reprise sur leurs ressources autorisées | La qualification Sites de T-09 se fait séparément ; T-33 multiressource hors Sites vient après la première app. |
| T-09/T-32 → T-36 initial | Site A et parcours Cloudflare du périmètre initial, avec chat OpenAI, widgets et module témoin testés ; politique de distribution examinée | Les modules différés et les profils exhaustifs de T-36 restent ouverts. |
| T-36 initial → T-37/T-38/T-39 ciblé | Version initiale de l'original publiée ; fork réel B, installation/update et recette ciblée de la première app | La recette exhaustive T-39 et les compléments de T-36 suivent les lots différés ; aucun lot partiel n'est déclaré « vérifié ». |

Les droits de distribution sont vérifiés **avant chaque première publication concernée**, y compris starter/démo/paquet s’ils précèdent la release finale. Cette vérification ne demande pas de choisir maintenant les futurs tarifs ou les fonctions premium. Toute publication externe conserve son mandat propre.

## Vue ordonnée par dépendances
| Tâche | Lot | Livrable | Dépendances | État |
|---|---|---|---|---|
| [T-01](#T-01) | P0 | Gouvernance effective et revue indépendante | GO reçu | En cours |
| [T-02](#T-02) | P0 | Contrats exécutables et contrôle commun | [T-01](#T-01) | En cours |
| [T-03](#T-03) | P1 | Runtime commun et démarrage local | [T-02](#T-02) | En cours |
| [T-04](#T-04) | P2 | Identités, comptes et droits | [T-03](#T-03) | En cours |
| [T-05](#T-05) | P2 | Données, fichiers, recherche et coffre | [T-03](#T-03), [T-04](#T-04) | En cours |
| [T-06](#T-06) | P2 | Opérations, événements et exécutions bornées | [T-04](#T-04), [T-05](#T-05) | En cours |
| [T-07](#T-07) | P1 | Workspace et conservation des onglets | [T-03](#T-03), [T-04](#T-04), [T-05](#T-05), [T-06](#T-06) | En cours |
| [T-08](#T-08) | P1 | Registre minimal et identité de publication | [T-04](#T-04), [T-05](#T-05), [T-06](#T-06) | En cours |
| [T-09](#T-09) | P1 | Première tranche sur Sites | [T-07](#T-07), [T-08](#T-08) | En cours — adaptateur et nouvelle cible |
| [T-10](#T-10) | P2 | MCP, OAuth et accès machine | [T-06](#T-06) ; recette Sites : [T-09](#T-09) | En cours — code local |
| [T-11](#T-11) | P3 | SDK et cycle de vie des modules | [T-02](#T-02), [T-06](#T-06), [T-10](#T-10) | En cours — code local |
| [T-12](#T-12) | P3 | Documentation vivante des modules | [T-11](#T-11) | Vérifié |
| [T-13](#T-13) | P4 | Fronts, thèmes et headless | [T-07](#T-07), [T-11](#T-11) | En cours |
| [T-14](#T-14) | P4 | Conversations et progression persistante | [T-06](#T-06), [T-07](#T-07), [T-11](#T-11) | En cours |
| [T-15](#T-15) | P4 | Module OpenAI et contrat fournisseur | [T-14](#T-14) | En cours — première tranche qualifiée, compléments différés |
| [T-16](#T-16) | P4 | Widgets et plugins conversationnels compatibles GPT | [T-10](#T-10), [T-13](#T-13), [T-15](#T-15) | Tranche intégrée — qualification hébergée |
| [T-30](#T-30) | P3 | Starter, paquets et extension externe | [T-11](#T-11), [T-12](#T-12), [T-13](#T-13), [T-16](#T-16) | En cours — distribution initiale publique et recette locale acquises, autres critères ouverts |
| [T-31](#T-31) | P1 | Docker local persistant | [T-03](#T-03), [T-05](#T-05), [T-07](#T-07) | En cours |
| [T-32](#T-32) | P6 | Publication complète Cloudflare | [T-08](#T-08), [T-30](#T-30), [T-31](#T-31) | En cours — original publié et mis à jour, SDK 1.1.0 public, démo ouverte |
| [T-36](#T-36) | P7 | Version initiale de l’original, puis compléments | Jalon initial : [T-08](#T-08), [T-09](#T-09), [T-10](#T-10), [T-11](#T-11), [T-12](#T-12), [T-13](#T-13), [T-14](#T-14), [T-15](#T-15), [T-16](#T-16), tranche témoin [T-30](#T-30), [T-31](#T-31), [T-32](#T-32) | En cours — jalon `app/v0.0.1` public et Site A qualifié, recette complète ouverte |
| [T-37](#T-37) | P7 | Vrai fork Creezio Lab et Site B | Version initiale publiée de [T-36](#T-36) | En cours — fork, Sites et Docker publiés ; la recette Cloudflare Lab reste à compléter |
| [T-38](#T-38) | P8 | Adoption des mises à jour et contributions | Fork initial de [T-37](#T-37) | En cours — module 0.1.2 adopté ; widgets historiques et cycle durable qualifiés, recette Cloudflare Lab ouverte |
| [T-39](#T-39) | P9 | Recette ciblée puis exhaustive | Preuves initiales de [T-38](#T-38) | En cours — flux Site A, conservation Site B et refus ciblés qualifiés ; Cloudflare et consolidation ouverts |
| [T-17](#T-17) | P5 | Tâches humaines et travail | [T-11](#T-11), [T-14](#T-14) | À faire — dernier bloc |
| [T-18](#T-18) | P5 | Messagerie native | [T-11](#T-11), [T-14](#T-14) | À faire — après première app |
| [T-19](#T-19) | P5 | Support | [T-11](#T-11), [T-17](#T-17), [T-18](#T-18) | À faire — après première app |
| [T-20](#T-20) | P5 | CRM | [T-11](#T-11) | À faire — après première app |
| [T-21](#T-21) | P5 | Pages et navigation | [T-11](#T-11), [T-13](#T-13) | À faire — après première app |
| [T-22](#T-22) | P5 | Analytics et diagnostics | [T-11](#T-11), [T-17](#T-17) | À faire — après première app |
| [T-23](#T-23) | P5 | Intentions et développement piloté | [T-12](#T-12), [T-17](#T-17) | À faire — dernier bloc, plan et accord explicite préalables |
| [T-24](#T-24) | P5 | Règles et automatisation sans scheduler | [T-11](#T-11), [T-17](#T-17) | À faire — dernier bloc, plan et accord explicite préalables |
| [T-25](#T-25) | P5 | Catalogue métier réutilisable complet | [T-11](#T-11), [T-13](#T-13), [T-16](#T-16) | À faire — après module témoin |
| [T-26](#T-26) | P5 | Connecteur n8n | [T-10](#T-10), [T-11](#T-11), [T-16](#T-16), [T-24](#T-24) | À faire — après première app |
| [T-27](#T-27) | P5 | Connecteur Stripe | [T-11](#T-11), [T-16](#T-16) | À faire — après première app |
| [T-28](#T-28) | P5 | Connecteur Meili | [T-05](#T-05), [T-11](#T-11) | À faire — après première app |
| [T-29](#T-29) | P5 | Autres connecteurs et frontières externes | [T-11](#T-11), [T-16](#T-16), [T-18](#T-18), [T-23](#T-23) | À faire — après première app |
| [T-33](#T-33) | P6 | Stockages distincts hors Sites | [T-32](#T-32) | À faire — après première app |
| [T-34](#T-34) | P6 | Éditions, politiques et activation | [T-08](#T-08), [T-11](#T-11), [T-27](#T-27) | À faire — accord explicite futur préalable |
| [T-35](#T-35) | P6 | Accompagnement avec accès consenti | [T-23](#T-23), [T-34](#T-34) | À faire — accord explicite futur préalable |

<a id="T-01"></a>
## T-01 — Gouvernance effective et revue indépendante

- Lot : **P0** ; état : **en cours** ; responsable : Codex, coordination et contrôleurs locaux.
- Dépendances : GO complet reçu le 26 septembre 2026. Compte unique `creezio` confirmé par le responsable ; revue technique par un autre agent, contrôles et protections à qualifier.
- Travail/livrables : Politique et revue technique approuvées, premiers validateurs documentaires et de gouvernance construits puis qualifiés, règles distantes et propriétaires réels activés, tests de refus. T-02 ajoute ensuite les schémas métier et critères de modules.
- Besoin : [US-01](USER-STORIES.md#US-01). Acceptation : [REQ-0101](EXIGENCES.md#REQ-0101), [REQ-0102](EXIGENCES.md#REQ-0102), [REQ-0103](EXIGENCES.md#REQ-0103), [REQ-0104](EXIGENCES.md#REQ-0104).
- Validation : implémenter puis exécuter les recettes liées, sur **GitHub et local selon le profil** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : [réalisation P0](IMPLEMENTATION-P0.md), contrôleurs et protections relus, CI de PR #1 (run 36258186574, tentative 2) et nouveau main `7b585c1` réussis. PR #5 : candidat `920d635`, un test volontairement invalide, run 36266145749 en échec (343 réussites, un échec), contrôle requis rouge et état GitHub `blocked`, sans tentative de fusion ni bypass. Le test témoin est retiré du candidat final ; aucun assouplissement des contrôles. Les futurs profils de livraison de CMS restent à qualifier lors de leur construction.

<a id="T-02"></a>
## T-02 — Contrats exécutables et contrôle commun

- Lot : **P0** ; état : **en cours** ; responsable : Codex, schémas/validateur/tests répartis entre agents et intégration revue.
- Dépendances : [T-01](#T-01).
- Travail/livrables : Schémas et validateur SDK sur fixtures positives/négatives, graphes intermodules de toutes origines, références publiques, versions, optional et transitions de composition ; branche locale core/t02-contracts depuis 3767c43. Suites applicatives avec vrais modules ensuite en T-11/T-30 ; ne pas confondre fixtures et runtime.
- Besoin : [US-02](USER-STORIES.md#US-02). Acceptation : [REQ-0201](EXIGENCES.md#REQ-0201), [REQ-0202](EXIGENCES.md#REQ-0202), [REQ-0203](EXIGENCES.md#REQ-0203), [REQ-0204](EXIGENCES.md#REQ-0204).
- Validation : implémenter puis exécuter les recettes liées, sur **local et CI, puis intégration des modules** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : [réalisation T-02](IMPLEMENTATION-T02.md), checkpoint/revue exacte conservés hors sources ; PR #2 intégrée en `61c70fd`, 195 tests distants réussis et CI du nouveau main verte. Livrable statique consommable, sans installation ou runtime module qualifié par ces fixtures.

<a id="T-03"></a>
## T-03 — Runtime commun et démarrage local

- Lot : **P1** ; état : **en cours** ; responsable : Codex, runtime/composition/recettes répartis entre agents et intégration revue.
- Dépendances : [T-02](#T-02).
- Travail/livrables : Versions figées, lockfile, profils de build, installation sur base neuve et module témoin ; mesures initiales.
- Besoin : [US-03](USER-STORIES.md#US-03). Acceptation : [REQ-0301](EXIGENCES.md#REQ-0301), [REQ-0302](EXIGENCES.md#REQ-0302), [REQ-0303](EXIGENCES.md#REQ-0303).
- Validation : implémenter puis exécuter les recettes liées, sur **local workerd/Miniflare** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : [réalisation T-03](IMPLEMENTATION-T03.md), checkpoint local `4d97e9e` et revue exacte conservés hors sources. Build/types, workerd et persistance D1/R2 après redémarrage vérifiés ; PR #3 intégrée en `b14cef7`, 245 tests distants réussis et CI du nouveau main verte. Ce livrable permet T-04 ; aucune qualification Sites/Cloudflare ni CMS complet acquise.

<a id="T-04"></a>
## T-04 — Identités, comptes et droits

- Lot : **P2** ; état : **en cours** ; responsable : Codex, fondations et revues réparties entre agents.
- Dépendances : [T-03](#T-03).
- Travail/livrables : Identités/sessions, invitations, comptes de service, rôles/contextes et module natif access.
- Tranches : [fondations, persistance, comptes, enforcement et interfaces](IMPLEMENTATION-T04.md). Le SQL central minimal nécessaire aux comptes est avancé avec T-04 ; le reste de T-05 demeure distinct, sans ajouter un cycle au backlog.
- Jalon consommable : identité locale qualifiée, incluant installation explicite et entrée native ; permet la première tranche T-05. La qualification complète des droits par UI/API/MCP/widgets et OAuth attend les canaux T-06/T-07/T-10, sans fermer prématurément T-04 ni créer une API administrative parallèle.
- Besoin : [US-04](USER-STORIES.md#US-04). Acceptation : [REQ-0401](EXIGENCES.md#REQ-0401), [REQ-0402](EXIGENCES.md#REQ-0402), [REQ-0403](EXIGENCES.md#REQ-0403).
- Validation : implémenter puis exécuter les recettes liées, sur **local, puis Sites/Cloudflare** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : fondations/comptes intégrés par PR #4, puis suivi PR #5 et base `123e182` qualifiée (343 tests CI). La PR #6 (`8793b20`, 370 tests CI) ajoute huit modèles de droits, soit seize modèles access, un seed d'administration explicite et le service d'autorisation avec session/epoch/claim frais. Les recettes ciblées vérifient le graphe, les refus et les courses dans D1 ; le résultat complet et la revue sont liés au SHA candidat dans les preuves de PR. La PR #7 (`33748a1`, 402 tests CI) ajoute le dix-septième modèle des capacités à usage unique et les services d’invitation/activation/récupération. La PR #8 (`6983845`, 445 tests CI) porte le total à dix-neuf modèles avec les comptes machine et leurs scopes exacts. La PR #9 (`ff39dfd`, 470 tests CI) ajoute les listes administratives, les statuts humains et les révocations de sessions. La PR #10 (`a892cd2`, 506 tests CI) ajoute l'impersonation interne auditée, avec vingt et un modèles privés. La PR #11 (`0192c8d`, 542 tests CI) raccorde login/session/logout HTTP. La PR #12 (`94194a9`, 575 tests CI) ajoute le SDK de session et les entrées navigateur. La PR #13 (`db9dd50`, 613 tests CI) intègre l’installation opérateur locale ; les autres transports, l’administration visuelle et la livraison des liens restent à construire ; garde des mutations métier à raccorder avec T-06. La [sonde Sites](QUALIFICATION-SITES.md) qualifie les KDF et observe le transport réseau, pas ces parcours ; voir [réalisation T-04](IMPLEMENTATION-T04.md).

<a id="T-05"></a>
## T-05 — Données, fichiers, recherche et coffre

- Lot : **P2** ; état : **en cours** ; responsables : agents Socle/Apps/Certivan et Codex pour intégration/revue.
- Dépendances : [T-03](#T-03), [T-04](#T-04).
- Travail/livrables : Services D1/R2/coffre, modèle composé et journal SQL central ; module natif data-explorer, recherche native et export/restauration.
- Tranche intégrée : [fondations D1/R2/coffre](IMPLEMENTATION-T05.md), PR #14 dans `d22df2d`, 672 tests locaux et CI. Le registre T-06 consomme seulement les primitives qualifiées ; les autres critères T-05 restent ouverts.
- Besoin : [US-05](USER-STORIES.md#US-05). Acceptation : [REQ-0501](EXIGENCES.md#REQ-0501), [REQ-0502](EXIGENCES.md#REQ-0502), [REQ-0503](EXIGENCES.md#REQ-0503), [REQ-0504](EXIGENCES.md#REQ-0504).
- Validation : implémenter puis exécuter les recettes liées, sur **local, puis Sites/Cloudflare** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : [PR #14](https://github.com/creezio/Creezio-D1R2/pull/14), candidat `0556bd0`, main `d22df2d`, 672/672 en local et dans les runs CI 36282430413/36282625712. Périmètre : fondations internes ; aucune recette de recherche, d'export/restauration ou d'hébergement revendiquée.

<a id="T-06"></a>
## T-06 — Opérations, événements et exécutions bornées

- Lot : **P2** ; état : **en cours** ; responsables : Codex (registre/intégration), Apps (persistance), Socle (compilation), Certivan (recette indépendante).
- Dépendances : [T-04](#T-04), [T-05](#T-05).
- Travail/livrables : Registre d’opérations, API, erreurs typées, audit, idempotence, outbox, suivi et reprises.
- Tranche interne intégrée : [registre et exécutions](IMPLEMENTATION-T06.md), PR #15, main `3a4ad091`, 723 tests locaux et CI. Registre, compilation, exécuteur sous droits natifs, stockage D1, audit et outbox forment un livrable interne consommable ; cela ne qualifie pas les transports métier.
- Tranche HTTP intégrée par PR #16 à `56eb0159` : bindings composés, routage natif, client navigateur et suivi par clé. 779 tests et recette navigateur locale ; événements, approbations, appels interopérations, livraison fournisseur réelle et MCP restent ouverts.
- Besoin : [US-06](USER-STORIES.md#US-06). Acceptation : [REQ-0601](EXIGENCES.md#REQ-0601), [REQ-0602](EXIGENCES.md#REQ-0602), [REQ-0603](EXIGENCES.md#REQ-0603).
- Validation : implémenter puis exécuter les recettes liées, sur **local, puis appel externe hébergé** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : PR #15 intégrée à `3a4ad091`, 723 tests locaux et CI sur le périmètre interne. PR #16 : HTTP et client intégrés dans `56eb0159`, 779 tests locaux et CI ; recette navigateur avec réponse perdue après commit et réconciliation sans renvoi. Hébergements et MCP restent distincts.

<a id="T-07"></a>
## T-07 — Workspace et conservation des onglets

- Lot : **P1** ; état : **en cours** ; responsable : Codex, avec travaux parallèles d'interface, de SDK et d'API sur une branche commune.
- Dépendances : [T-03](#T-03), [T-04](#T-04), [T-05](#T-05), [T-06](#T-06).
- Travail/livrables : SDK de panneaux, navigation et autorisation de vues ; restauration bornée en session sous projection fraîche ; adaptation des composants du Creezio original dans `admin/workspace/` et hôte par audience. Une recette navigateur locale couvre deux fiches, leurs brouillons et la reprise d’une réponse perdue. L’intégration finale et les parcours produit/hébergés restent à qualifier.
- Tranche intégrée : [implémentation T-07](IMPLEMENTATION-T07.md), PR #16, main `56eb0159`, 779 tests et recette navigateur locale. Les composants originaux repris sont raccordés au SDK ; la parité du produit entier nécessite encore ses modules et ses parcours.
- Besoin : [US-07](USER-STORIES.md#US-07). Acceptation : [REQ-0701](EXIGENCES.md#REQ-0701), [REQ-0702](EXIGENCES.md#REQ-0702), [REQ-0703](EXIGENCES.md#REQ-0703).
- Validation : implémenter puis exécuter les recettes liées, sur **navigateur local, puis Sites** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : tests locaux ciblés décrits dans [l'état T-07](IMPLEMENTATION-T07.md). Recette locale de deux fiches et premiers 779 contrôles réussis ; candidat final, revue, CI et profils hébergés suivis séparément avant qualification globale.

<a id="T-08"></a>
## T-08 — Registre minimal et identité de publication

- Lot : **P1** ; état : **en cours** ; onboarding propriétaire publié et qualifié dans son périmètre, installations Lab créées, raccords de livraison ouverts ; PR #35, main `e51928f98e6f0453f26b563a504fa868e3c1a04d`.
- Dépendances : [T-04](#T-04), [T-05](#T-05), [T-06](#T-06).
- Travail/livrables : Service central séparé, vérification GitHub/email, token d’installation et contrôle de publication ; bootstrap documenté.
- Besoin : [US-08](USER-STORIES.md#US-08). Acceptation : [REQ-0801](EXIGENCES.md#REQ-0801), [REQ-0802](EXIGENCES.md#REQ-0802), [REQ-0803](EXIGENCES.md#REQ-0803).
- Validation : implémenter puis exécuter les recettes liées, sur **service central et app cliente** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : Core main `e51928f` et CI 1 163/1 163 ; Worker registre version `ba21708c`, artefact `sha256-bc153ce69a20950321495ccf5a46657f4b0bc381e9ead33b55e10c69f5b73547` (55 167 octets). Bindings et D1 conservés : 3 projets, 5 installations, 2 propriétaires. Le projet Lab `7234b2de-e2a1-4eec-a2ce-a7f18426f200` possède deux installations Sites/Cloudflare créées après autorisation ; leurs jetons ont ensuite été tournés par le parcours propriétaire natif, récupérés par téléchargement et stockés dans un coffre DPAPI hors dépôt. Le relevé D1 à 08:08 UTC (versions 1, sans rotation) précède ces actions ; aucun nouveau numéro de version D1 n’est affirmé ici. Le raccord des publishers et email reste ouvert. Voir les preuves opérateur hors dépôt.

<a id="T-09"></a>
## T-09 — Première tranche sur Sites

- Lot : **P1** ; état : **première tranche hébergée qualifiée, compléments en cours** ; responsable : orchestrateur. Si le compte GPT courant ne retrouve plus l'ancien Site (404), créer un nouveau Site public sous ce compte, raccorder le nouveau `project_id` et conserver les identifiants et preuves de l'ancien Site dans l'historique. Chaque cible conserve ses propres données et preuves.
- Dépendances : [T-07](#T-07), [T-08](#T-08).
- Travail/livrables : Site A réutilisé s'il est accessible et adapté, sinon nouveau Site public du compte courant : compte, module témoin, onglets, opération et fichier ; comparaison local/Sites et traçabilité du changement de `project_id`.
- Besoin : [US-09](USER-STORIES.md#US-09). Acceptation : [REQ-0901](EXIGENCES.md#REQ-0901), [REQ-0902](EXIGENCES.md#REQ-0902).
- Validation : implémenter puis exécuter les recettes liées, sur **Site public réel** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : Site A original courant publié depuis `cb716aa35933acd0831ca1bb2504a95bd98427e1`, version 4, et déclaration registre synchronisée. Après correction du chat, un seul `turn.drive` réel a réussi en 14 161 ms, sans reprise manuelle ; réponse persistée de 933 octets. Les données D1/R2 préexistantes ont été relues et conservées. Ce témoin concerne ce parcours Site A ; la publication et la recette de B restent ouvertes.

<a id="T-10"></a>
## T-10 — MCP, OAuth et accès machine

- Lot : **P2** ; état : **en cours — livrable local qualifié**. PR #19 intégrée, main `f52a17b9`, 866/866 local et CI candidat/main. Recettes ChatGPT et Site public restantes ; limites dans IMPLEMENTATION-T10.
- Dépendances : [T-06](#T-06) pour le code et les tests locaux ; [T-09](#T-09) pour la recette Sites du transport.
- Travail/livrables : Endpoints admin/app, découverte, ressources, OAuth natif et tokens machine ; clients de recette figés. Raccords et limites suivis dans [IMPLEMENTATION-T10](IMPLEMENTATION-T10.md).
- Besoin : [US-10](USER-STORIES.md#US-10). Acceptation : [REQ-1001](EXIGENCES.md#REQ-1001), [REQ-1002](EXIGENCES.md#REQ-1002), [REQ-1003](EXIGENCES.md#REQ-1003).
- Validation : implémenter puis exécuter les recettes liées, sur **clients MCP réels et Site public** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : candidat `d691805e`, main `f52a17b9`, arbre `8d8e63d3`, CI 36296748920/36297058152 ; rapports T10 conservés hors sources. Callback SDK réel vérifié ; navigation visuelle vers le callback refusée par l’inspecteur du navigateur de test, non qualifiée.

<a id="T-11"></a>
## T-11 — SDK et cycle de vie des modules

- Lot : **P3** ; état : **en cours — livrable local qualifié** ; PR #20 intégrée, main `037c0a0b`, 908 tests locaux et CI. Publication et distribution complète restent raccordées par leurs lots.
- Dépendances : [T-02](#T-02), [T-06](#T-06), [T-10](#T-10).
- Travail/livrables : SDK versionné, résolveur et verrou transitif, module natif modules-settings, catalogue/configuration/diagnostic « dépend de / utilisé par », plan de changement et gardes communes du cycle de vie. Contributions facultatives et relations persistantes contrôlées selon DEPENDANCES-MODULES.md. Suivre [IMPLEMENTATION-T11](IMPLEMENTATION-T11.md) et le [TODO du module](../extensions/native/modules-settings/TODO.md).
- Besoin : [US-11](USER-STORIES.md#US-11). Acceptation : [REQ-1101](EXIGENCES.md#REQ-1101), [REQ-1102](EXIGENCES.md#REQ-1102), [REQ-1103](EXIGENCES.md#REQ-1103), [REQ-1104](EXIGENCES.md#REQ-1104), [REQ-1105](EXIGENCES.md#REQ-1105), [REQ-1106](EXIGENCES.md#REQ-1106).
- Validation : implémenter puis exécuter les recettes liées, sur **local et app hôte** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : candidat `76674c5`, main `037c0a0b`, arbre `0da0b71b`, CI 36299996090/36300347412 ; 908/908 sans omission, build/types/Workerd et trois revues indépendantes. Recettes navigateur et limites décrites dans IMPLEMENTATION-T11, preuves T11 conservées hors source.

<a id="T-12"></a>
## T-12 — Documentation vivante des modules

- Lot : **P3** ; état : **vérifié** ; responsable : Codex orchestrateur, chats Sol API/SDK/Workspace ; branche `core/t12-installed-documentation`.
- Dépendances : [T-11](#T-11).
- Réalisation : [périmètre T12](IMPLEMENTATION-T12.md). Prérequis consommé : PR #20, main `037c0a0b`, 908 tests locaux et CI ; lecture documentaire désormais qualifiée dans PR #21.
- Travail/livrables : Contrôles docs, documentation embarquée et lecture UI/API/MCP autorisée ; contrats distinguant PRD installé et révisions de travail. L’édition/validation humaine des révisions est construite en T-23.
- Besoin : [US-12](USER-STORIES.md#US-12). Acceptation : [REQ-1201](EXIGENCES.md#REQ-1201), [REQ-1202](EXIGENCES.md#REQ-1202).
- Validation : implémenter puis exécuter les recettes liées, sur **package, workspace et API/MCP** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : candidat `ae312982`, main `20d48fda`, arbre `aef9cdb4`, CI 36301642996/36302251823, 923/923 sans omission ; trois revues indépendantes, types/build/Workerd et navigateur sur le même artefact. Lire IMPLEMENTATION-T12 pour les essais initiaux, corrections et limites. État vérifié pour les documents installés ; aucune release ni recette Sites prétendue.

<a id="T-13"></a>
## T-13 — Fronts, thèmes et headless

- Lot : **P4** ; état : **en cours** ; responsable : Codex et trois chats Sol ; PR #22 intégrée, qualification locale disponible ; recette Sites restante.
- Dépendances : [T-07](#T-07), [T-11](#T-11).
- Réalisation : [périmètre T13](IMPLEMENTATION-T13.md), réemploi Certivan V5 et primitives Creezio ; comptes/permissions communs, aucun second backend.
- Travail/livrables : Thèmes standard/ChatGPT-like, moteur de composition, composants et client headless ; personnalisation dans application/.
- Besoin : [US-13](USER-STORIES.md#US-13). Acceptation : [REQ-1301](EXIGENCES.md#REQ-1301), [REQ-1302](EXIGENCES.md#REQ-1302).
- Validation : implémenter puis exécuter les recettes liées, sur **navigateur et Site** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : PR #22, candidat `b950fba3`, main `d12ab795`, 953/953 local et CI ; recette navigateur des deux thèmes et reprise de mutation vérifiées. Sites reste non qualifié.

<a id="T-14"></a>
## T-14 — Conversations et progression persistante

- Lot : **P4** ; état : **en cours** ; responsable : Codex et trois chats Sol ; branche `core/t14-conversations`.
- Dépendances : [T-06](#T-06), [T-07](#T-07), [T-11](#T-11).
- Réalisation : [périmètre T14](IMPLEMENTATION-T14.md), UI originale Creezio, données et fichiers par ports communs.
- Travail/livrables : Module conversations, états partagés SDK, historique/recherche/archive et transport adapté ; OpenAI indépendant.
- Correctif ciblé T40 en cours : dans un panneau sans conversation sélectionnée, projeter l’état depuis la configuration publique OpenAI plutôt que depuis le `no_provider` initial du contrôleur. Garder l’envoi désactivé sans modèle autorisé ; une recette Sites A/B reste requise après intégration.
- Besoin : [US-14](USER-STORIES.md#US-14). Acceptation : [REQ-1401](EXIGENCES.md#REQ-1401), [REQ-1402](EXIGENCES.md#REQ-1402).
- Validation : implémenter puis exécuter les recettes liées, sur **navigateur local et Sites** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-15"></a>
## T-15 — Module OpenAI et contrat fournisseur

- Lot : **P4** ; état : **première tranche qualifiée, PR #24 intégrée ; compléments ouverts** ; responsables : orchestrateur et agents API, SDK, UI.
- Dépendances : [T-14](#T-14).
- Travail/livrables : Module OpenAI, configuration/modèle, adaptation Responses/outils et quotas ; ports autres fournisseurs/voix.
- Besoin : [US-15](USER-STORIES.md#US-15). Acceptation : [REQ-1501](EXIGENCES.md#REQ-1501), [REQ-1502](EXIGENCES.md#REQ-1502).
- Validation : implémenter puis exécuter les recettes liées, sur **OpenAI réel et chats app/workspace** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : candidat `af63cb3c`, main `42efa820`, CI 993/993 ; réponses OpenAI réelles locales/Sites, conservation après mise à jour, refus anonymes et trois revues exactes. Artefacts des étapes distincts ; voir [réalisation T15](IMPLEMENTATION-T15.md).

<a id="T-16"></a>
## T-16 — Widgets et plugins conversationnels compatibles GPT

- Lot : **P4** ; état : **en cours** ; tranche intégrée, recettes Linux Lab acquises dans leur périmètre, qualifications hébergées courantes ouvertes ; responsables : orchestrateur et agents Sol.
- Dépendances : [T-10](#T-10), [T-13](#T-13), [T-15](#T-15).
- Travail/livrables : Hôte multiwidgets, ressources MCP Apps, paquet plugin/skills, modes message/contexte/direct par action, adaptateur GPT et recette réelle des trois modes dans les deux chats.
- Réalisation en cours : [contrats et raccords T16](IMPLEMENTATION-T16.md). En Linux Lab préadoption 0.1.0, trois tours OpenAI réels et les actions widget direct/message/contexte ont été observés ; les boutons internes ont été activés par Tab/Return. L’ajout de contexte du troisième tour est capturé durablement dans son snapshot. Le même renseignement figurait aussi dans l’historique texte : le snapshot seul ne prouve pas que le modèle l’a utilisé.
- Besoin : [US-16](USER-STORIES.md#US-16). Acceptation : [REQ-1601](EXIGENCES.md#REQ-1601), [REQ-1602](EXIGENCES.md#REQ-1602), [REQ-1603](EXIGENCES.md#REQ-1603), [REQ-1604](EXIGENCES.md#REQ-1604), [REQ-1605](EXIGENCES.md#REQ-1605), [REQ-1606](EXIGENCES.md#REQ-1606), [REQ-1607](EXIGENCES.md#REQ-1607).
- Validation : implémenter puis exécuter les recettes liées, sur **chat Creezio et conversation ChatGPT** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : `CREEZIO-T38-LAB-WIDGETS-LINUX-9FDB288-2026-09-28.json`, `CREEZIO-T38-LAB-WIDGET-CONTEXT-SNAPSHOT-THIRD-TURN-2026-09-28.json` et captures hors commit. Recettes ChatGPT et Sites du compte courant, clic pointeur dans l’iframe et approbation humaine restent à qualifier séparément.

<a id="T-17"></a>
## T-17 — Tâches humaines et travail

Priorité : dernier bloc après les travaux indépendants ; aucune nouvelle approbation imposée pour ce lot.

- Lot : **P5** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-11](#T-11), [T-14](#T-14).
- Travail/livrables : Module tasks-work avec PRD/docs/CI et parcours de travail humain.
- Besoin : [US-17](USER-STORIES.md#US-17). Acceptation : [REQ-1701](EXIGENCES.md#REQ-1701).
- Validation : implémenter puis exécuter les recettes liées, sur **workspace, API et MCP** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-18"></a>
## T-18 — Messagerie native

- Lot : **P5** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-11](#T-11), [T-14](#T-14).
- Travail/livrables : Module messaging : boîtes/messages/brouillons/pièces jointes et port de transport.
- Besoin : [US-18](USER-STORIES.md#US-18). Acceptation : [REQ-1801](EXIGENCES.md#REQ-1801).
- Validation : implémenter puis exécuter les recettes liées, sur **workspace et API/MCP** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-19"></a>
## T-19 — Support

- Lot : **P5** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-11](#T-11), [T-17](#T-17), [T-18](#T-18).
- Travail/livrables : Module support et relations autorisées avec contacts/messages/tâches.
- Besoin : [US-19](USER-STORIES.md#US-19). Acceptation : [REQ-1901](EXIGENCES.md#REQ-1901).
- Validation : implémenter puis exécuter les recettes liées, sur **workspace et API/MCP** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-20"></a>
## T-20 — CRM

- Lot : **P5** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-11](#T-11).
- Travail/livrables : Module crm, entités/relations/recherche et vues.
- Besoin : [US-20](USER-STORIES.md#US-20). Acceptation : [REQ-2001](EXIGENCES.md#REQ-2001).
- Validation : implémenter puis exécuter les recettes liées, sur **workspace et API/MCP** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-21"></a>
## T-21 — Pages et navigation

- Lot : **P5** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-11](#T-11), [T-13](#T-13).
- Travail/livrables : Module pages-navigation, médias/SEO/édition et reset contrôlé.
- Besoin : [US-21](USER-STORIES.md#US-21). Acceptation : [REQ-2101](EXIGENCES.md#REQ-2101).
- Validation : implémenter puis exécuter les recettes liées, sur **front, workspace et API/MCP** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-22"></a>
## T-22 — Analytics et diagnostics

- Lot : **P5** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-11](#T-11), [T-17](#T-17).
- Travail/livrables : Module analytics, consultation de l’audit, productivité/usage et exports limités.
- Besoin : [US-22](USER-STORIES.md#US-22). Acceptation : [REQ-2201](EXIGENCES.md#REQ-2201).
- Validation : implémenter puis exécuter les recettes liées, sur **workspace et API/MCP** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-23"></a>
## T-23 — Intentions et développement piloté

Priorité : dernier bloc après T-17. Expliquer fonctions, effets, limites, plan et recette puis obtenir la validation explicite de l'utilisateur avant implémentation.

- Lot : **P5** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-12](#T-12), [T-17](#T-17).
- Travail/livrables : Module intentions-development, révisions/validation PRD, tâches, artefacts et historique de livraison.
- Besoin : [US-23](USER-STORIES.md#US-23). Acceptation : [REQ-2301](EXIGENCES.md#REQ-2301), [REQ-2302](EXIGENCES.md#REQ-2302).
- Validation : implémenter puis exécuter les recettes liées, sur **workspace et API/MCP** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-24"></a>
## T-24 — Règles et automatisation sans scheduler

Priorité : dernier bloc après T-17. Expliquer fonctions, effets, limites, plan et recette puis obtenir la validation explicite de l'utilisateur avant implémentation.

- Lot : **P5** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-11](#T-11), [T-17](#T-17).
- Travail/livrables : Module automation-rules, événements, conditions/actions et journal.
- Besoin : [US-24](USER-STORIES.md#US-24). Acceptation : [REQ-2401](EXIGENCES.md#REQ-2401).
- Validation : implémenter puis exécuter les recettes liées, sur **API/MCP externe et workspace** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-25"></a>
## T-25 — Catalogue métier réutilisable

- Lot : **P5** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-11](#T-11), [T-13](#T-13), [T-16](#T-16).
- Travail/livrables : Module catalogue, données produit et ports publics de référence.
- Besoin : [US-25](USER-STORIES.md#US-25). Acceptation : [REQ-2501](EXIGENCES.md#REQ-2501).
- Validation : implémenter puis exécuter les recettes liées, sur **app fraîche et widgets** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-26"></a>
## T-26 — Connecteur n8n

La partie API/MCP du connecteur n8n peut avancer avant T-24 ; son raccord aux règles d'automatisation attend T-24 et sa validation.

- Lot : **P5** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-10](#T-10), [T-11](#T-11), [T-16](#T-16), [T-24](#T-24).
- Travail/livrables : Module n8n : connexion, workflows autorisés, déclenchements/suivi/widgets et callbacks.
- Besoin : [US-26](USER-STORIES.md#US-26). Acceptation : [REQ-2601](EXIGENCES.md#REQ-2601), [REQ-2602](EXIGENCES.md#REQ-2602).
- Validation : implémenter puis exécuter les recettes liées, sur **n8n réel + Site public** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-27"></a>
## T-27 — Connecteur Stripe

- Lot : **P5** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-11](#T-11), [T-16](#T-16).
- Travail/livrables : Module Stripe : produits/prix/clients/checkout/abonnements selon PRD, webhooks et widgets.
- Besoin : [US-27](USER-STORIES.md#US-27). Acceptation : [REQ-2701](EXIGENCES.md#REQ-2701).
- Validation : implémenter puis exécuter les recettes liées, sur **Stripe en mode test** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-28"></a>
## T-28 — Connecteur Meili

- Lot : **P5** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-05](#T-05), [T-11](#T-11).
- Travail/livrables : Module Meili, projections, indexation incrémentale et reconstruction reprenable.
- Besoin : [US-28](USER-STORIES.md#US-28). Acceptation : [REQ-2801](EXIGENCES.md#REQ-2801).
- Validation : implémenter puis exécuter les recettes liées, sur **Meili réel et recherche native** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-29"></a>
## T-29 — Autres connecteurs et frontières externes

- Lot : **P5** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-11](#T-11), [T-16](#T-16), [T-18](#T-18), [T-23](#T-23).
- Travail/livrables : PRD et tâches par fournisseur : Hermes, mail, navigateur distant/relais, Granola, agents/exécution de développement, observabilité, desktop/infrastructure et autres IA/voix selon les capacités de la matrice.
- Besoin : [US-29](USER-STORIES.md#US-29). Acceptation : [REQ-2901](EXIGENCES.md#REQ-2901), [REQ-2902](EXIGENCES.md#REQ-2902).
- Validation : implémenter puis exécuter les recettes liées, sur **chaque fournisseur réel autorisé** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-30"></a>
## T-30 — Starter, paquets et extension externe

- Lot : **P3** ; état : **en cours — distribution initiale acquise, critères restants ouverts** ; responsables : orchestrateur, agents API/SDK, UI et hôte. PR #26 fusionnée sur main `e67636635a526daa544ea3573b271e1822f3f4fe` ; dépôt public Creezio-Extension-Starter, PR #1 fusionnée sur `527a1bc1446a529ad6e560e3a25dea13a12001e9`.
- Dépendances : [T-11](#T-11), [T-12](#T-12), [T-13](#T-13), [T-16](#T-16).
- Travail/livrables : Première tranche prioritaire : starter, paquet runtime réel, validation autonome, plugin et démo locale d'un seul module métier témoin, installé hors du checkout source. Les comparateurs, dépendances interéditeurs et intégrations facultatives restent dans le lot pour la suite ; ils ne conditionnent pas cette première app. Vérifier les droits avant toute distribution concernée ; publication de la démo qualifiée en T-32.
- Besoin : [US-30](USER-STORIES.md#US-30). Acceptation : [REQ-3001](EXIGENCES.md#REQ-3001), [REQ-3002](EXIGENCES.md#REQ-3002), [REQ-3003](EXIGENCES.md#REQ-3003), [REQ-3004](EXIGENCES.md#REQ-3004).
- Validation : implémenter puis exécuter les recettes liées, sur **tarball dans app de validation indépendante et démo locale** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : SDK public `sdk-v1.1.0` et Starter public `module-v0.1.2` avec archives vérifiées. La démo indépendante locale a couvert API admin/app, D1/R2, OpenAI, deux widgets et UI originale. En Linux Lab préadoption 0.1.0, les boutons internes direct/message/contexte ont été exercés au clavier (Tab/Return) ; le contrôleur n’a pas réalisé de clic pointeur imbriqué dans l’iframe. [Réalisation et limites](IMPLEMENTATION-T30.md). Publication Cloudflare de la démo suivie en T-32.

<a id="T-31"></a>
## T-31 — Docker local persistant

- Lot : **P1** ; état : **en cours** ; responsables : Codex et agents Sol sur `core/t08-publication-foundations`.
- Dépendances : [T-03](#T-03), [T-05](#T-05), [T-07](#T-07).
- Travail/livrables : Docker/Miniflare/workerd, volumes et diagnostic ; recette redémarrage/restauration.
- Besoin : [US-31](USER-STORIES.md#US-31). Acceptation : [REQ-3101](EXIGENCES.md#REQ-3101).
- Validation : implémenter puis exécuter les recettes liées, sur **Docker local réel** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : recette Docker locale synthétique du 27 septembre : installation, connexion HTTP, exclusion concurrente, écritures D1/R2, arrêt, redémarrage et restauration d'un volume distinct sur l'image `sha256:ba5a692fe1534585caaac9a40f7d74a2fb638c96f71f8a770c5dbb3073d4a39b`. La recette Linux T32 a ensuite conservé compte, brouillon et fichier R2 après remplacement d'image et arrêté Docker avec code zéro. Portée et limites dans [Réalisation T31](IMPLEMENTATION-T31.md) et [Réalisation T32](IMPLEMENTATION-T32.md).

<a id="T-32"></a>
## T-32 — Publication complète Cloudflare

- Lot : **P6** ; état : **en cours** ; responsables : orchestrateur et agents T32 après fusion de la PR #27 sur main `cca3157ed966e9b6efddf71a920606dac16cd1ff` ; CI du nouveau main réussie avec 1 152/1 152 tests.
- Dépendances : [T-08](#T-08), tranche témoin [T-30](#T-30), [T-31](#T-31). La publication Sites [T-09](#T-09) suit son propre parcours et n'est pas un prérequis technique de Cloudflare.
- Travail/livrables : Module livraison locale et exécuteur limité, Worker/assets, bindings D1/R2, transfert cohérent et reprise ; original et démo du starter publiés. Le fork sera exercé en T-38.
- Besoin : [US-32](USER-STORIES.md#US-32). Acceptation : [REQ-3201](EXIGENCES.md#REQ-3201), [REQ-3202](EXIGENCES.md#REQ-3202), [REQ-3203](EXIGENCES.md#REQ-3203).
- Validation : implémenter puis exécuter les recettes liées, sur **compte Cloudflare autorisé réel** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : CI des candidats 39a9ec5 à 1 124/1 124, 9ba8025 à 1 132/1 132 et de l'opérateur 5320845 à 1 134/1 134 ; les échecs initiaux EXDEV, `_cf_KV` et métadonnée R2 restent documentés. La reprise Linux du transfert `d76cdcf6-3203-4ef9-a2d5-0c19c042a90a` a publié l'original source `3542c5663cd4cfb3e0998e93f57cbacc53d4b1e1` sur [Cloudflare](https://creezio-cloudflare-linux.fidusia.workers.dev/) : 67 modules/35 assets vérifiés, journal `delivered`, registre `synchronized`, compte/brouillon/fichier conservés et réponse OpenAI réelle ; Docker arrêté avec code zéro. La première mise à jour réelle REQ-3203 depuis la vue Livraison, source `27ad87770e7270ab6e082fa92f03b12062a6e056`, est `delivered` avec registre synchronisé, 67 modules/35 assets vérifiés et témoins D1/R2 conservés ; une nouvelle réponse OpenAI a été obtenue après rechargement. La CI Linux du merge d'essai a réussi 1 152/1 152 ; le global Windows local est incomplet après timeout au test 837. Démo et autres reprises restent ouvertes ; SDK `sdk-v1.1.0` public depuis le main qualifié `f8dc03c`. [Réalisation T32](IMPLEMENTATION-T32.md).
- Lab : le premier transfert s'est arrêté en `capturing` avec `active_effect`, avant artefact ou import ; le journal et la capture partielle sont préservés. Le correctif Core PR #39/main `0078fc7` (CI main 1 183/1 183) a été adopté par Lab PR #6/main `949f028` (CI 1 186/1 186). Le transfert distinct `a4ea2615` a vérifié 2 265 lignes D1 et un objet R2 ; après upload Worker, un `RangeError` de l'inspecteur a laissé le plan `delivery-unknown` et la publication `prepared`. Core PR #40 et Lab PR #7 ont corrigé l'inspection ; le même transfert est `delivered`, registre `synchronized`, avec 71 modules/41 assets vérifiés et une nouvelle réponse OpenAI réelle ; voir [T32](IMPLEMENTATION-T32.md).

<a id="T-33"></a>
## T-33 — Stockages distincts hors Sites

- Lot : **P6** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-32](#T-32).
- Travail/livrables : Résolveur de ressources autorisées, provisionnement/bindings et qualification des quotas.
- Besoin : [US-33](USER-STORIES.md#US-33). Acceptation : [REQ-3301](EXIGENCES.md#REQ-3301).
- Validation : implémenter puis exécuter les recettes liées, sur **local puis Cloudflare direct** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-34"></a>
## T-34 — Éditions, politiques et activation

Implémentation des éditions et fonctions premium uniquement après validation explicite future de l'utilisateur ; le GO historique ne suffit pas.

- Lot : **P6** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-08](#T-08), [T-11](#T-11), [T-27](#T-27).
- Travail/livrables : Politiques versionnées, justificatifs signés, états de facturation/activation et tests Community/Enterprise.
- Besoin : [US-34](USER-STORIES.md#US-34). Acceptation : [REQ-3401](EXIGENCES.md#REQ-3401), [REQ-3402](EXIGENCES.md#REQ-3402).
- Validation : implémenter puis exécuter les recettes liées, sur **service central et app** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-35"></a>
## T-35 — Accompagnement avec accès consenti

Implémentation de l'accompagnement avec accès au code uniquement après validation explicite future de l'utilisateur ; le GO historique ne suffit pas.

- Lot : **P6** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-23](#T-23), [T-34](#T-34).
- Travail/livrables : Consentement limité/révocable, périmètres lecture/branche-PR/déploiement distincts, audit et révocation.
- Besoin : [US-35](USER-STORIES.md#US-35). Acceptation : [REQ-3501](EXIGENCES.md#REQ-3501).
- Validation : implémenter puis exécuter les recettes liées, sur **dépôt de test consenti** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-36"></a>
## T-36 — Release de l’original

- Lot : **P7** ; état : **en cours, jalon initial ciblé** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : pour le **jalon initial consommable**, [T-08](#T-08), [T-09](#T-09), [T-10](#T-10), [T-11](#T-11), [T-12](#T-12), [T-13](#T-13), [T-14](#T-14), [T-15](#T-15), [T-16](#T-16), tranche témoin [T-30](#T-30), [T-31](#T-31), [T-32](#T-32).
- Suite du lot : la clôture complète de T-36 attend les lots différés T-17 à T-29 et T-33 à T-35 et leurs propres profils.
- Travail/livrables : Version initiale de l’original avec manifeste versions/propriété, docs, artefacts et provenance selon Git flow ; compléter la release au fil des modules et qualifications différés. La première version publiée peut être consommée par T-37 sans déclarer T-36 entièrement vérifié.
- Besoin : [US-36](USER-STORIES.md#US-36). Acceptation : [REQ-3601](EXIGENCES.md#REQ-3601), [REQ-3602](EXIGENCES.md#REQ-3602).
- Validation : implémenter puis exécuter les recettes liées, sur **CI, Site A et artefacts publiés** ; inclure les cas négatifs et les contrôles communs appropriés.
- Version initiale : [`app/v0.0.0`](https://github.com/creezio/Creezio-D1R2/releases/tag/app/v0.0.0) reste la preuve historique du jalon T36 ; [`app/v0.0.1`](https://github.com/creezio/Creezio-D1R2/releases/tag/app/v0.0.1) est la release originale publique actuelle, issue du main qualifié `a911e4d`. Voir [preuves, usage et limites T36](IMPLEMENTATION-T36.md).
- Preuves : archives source et notices publiées ; la source fonctionnelle Core `0078fc7` porte le correctif T32, distinct de la source du Site A. L’ancien Site A a été qualifié avant le changement de compte ; le Site A courant `appgprj_6aba07912a888191b9dfbee5b65f2448` sert sa version 5 depuis `833701dd15e6fa81b2f329169a99b7aeb0270412`. Le témoin de chat version 4 depuis `cb716aa` a répondu en un seul `turn.drive` avec 933 octets persistés ; il reste historique. Le Site B version 5 est publié séparément depuis `1a93fa85a3c1c44794b0e82dfc5eda4c409eba12` ; T36 complet reste ouvert.

<a id="T-37"></a>
## T-37 — Vrai fork Creezio Lab et Site B

- Lot : **P7** ; état : **en cours** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : version initiale publiée et qualifiée de [T-36](#T-36), sans attendre la clôture exhaustive de ce lot.
- Travail/livrables : Vrai fork public Creez-io/Creezio-Lab de la version initiale, Site B et **un module métier témoin** avec thème/front propre ; les modules supplémentaires et le parcours complet de validation de budget suivent après la première app.
- Besoin : [US-37](USER-STORIES.md#US-37). Acceptation : [REQ-3701](EXIGENCES.md#REQ-3701), [REQ-3702](EXIGENCES.md#REQ-3702).
- Validation : implémenter puis exécuter les recettes liées, sur **GitHub et deux Sites publics** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : vrai fork public `Creez-io/Creezio-Lab`, projet enregistré sous `7234b2de-e2a1-4eec-a2ce-a7f18426f200` ; Lab main `949f028dbbe99ab586c02c42c82e51f145379b23` (PR #6, CI 1 186/1 186). L'ancien Site B et son build initial restent dans l'historique. Le même Site B courant `appgprj_6aba07af3a248191912848628c94b92d` sert la version 5 depuis `1a93fa85a3c1c44794b0e82dfc5eda4c409eba12` ; comptes, front, module 0.1.2, demandes, widgets historiques et fichiers sont conservés. La déclaration Sites au registre est synchronisée. Lab Cloudflare est publié ; la recette applicative reste à compléter.

<a id="T-38"></a>
## T-38 — Adoption des mises à jour et contributions

- Lot : **P8** ; état : **en cours** ; adoption du module 0.1.2 et correction T40 qualifiées dans leur périmètre ; recette Cloudflare Lab ouverte.
- Dépendances : fork initial utilisable de [T-37](#T-37).
- Travail/livrables : Pour la première app, installation du vrai paquet témoin puis adoption, par le fork B, d'une nouvelle version issue de l'original A et mise à jour du module/thème sans perte des données ni du front, avec refus d'une mise à jour incompatible ; publication Cloudflare du fork via le parcours T-32. Les contributions amont et intégrations facultatives restantes gardent leurs preuves propres dans T-38.
- Besoin : [US-38](USER-STORIES.md#US-38). Acceptation : [REQ-3801](EXIGENCES.md#REQ-3801), [REQ-3802](EXIGENCES.md#REQ-3802), [REQ-3803](EXIGENCES.md#REQ-3803).
- Validation : implémenter puis exécuter les recettes liées, sur **A/B, Cloudflare, tarballs et GitHub** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : Starter `module-v0.1.2` public ; Lab PR #2 à #6 fusionnées, main `949f028` et CI 1 186/1 186. Le même Site B version 5 et Docker Linux servent le module 0.1.2 avec front et données conservés ; les anciens widgets sont restaurés. Les deux plans acceptés avant T40 ont été annulés avec motif et sans confirmation rétroactive. Le refus de désactivation d'Access avec consommateurs couvre une garde d'update, pas un refus d'outil ChatGPT. Prochain vrai cycle de plan, autres critères T38 et recette Cloudflare restante et exactitude de la prose IA historique restent ouvertes ; voir [T40](IMPLEMENTATION-T40.md) et [T32](IMPLEMENTATION-T32.md).

<a id="T-39"></a>
## T-39 — Recette finale et validation utilisateur

- Lot : **P9** ; état : **en cours** ; responsable : équipe Creezio pour cette correction, recette produit encore à coordonner.
- Dépendances : preuves initiales d'installation et de mise à jour de [T-38](#T-38).
- Travail/livrables : **Recette ciblée de la première app** : deux Sites publics, chat OpenAI, widget/outil autorisé et refusé, module témoin issu du paquet, mise à jour original→fork, publication Cloudflare et retour utilisateur, avec versions/SHA/profils et limites. La **recette exhaustive** de tous les modules, fournisseurs et profils suit les lots différés ; le jalon ciblé ne vaut pas clôture de T-39.
- Besoin : [US-39](USER-STORIES.md#US-39). Acceptation : [REQ-3901](EXIGENCES.md#REQ-3901).
- Validation : implémenter puis exécuter les recettes liées, sur **deux Sites, Cloudflare et clients GPT/MCP** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : le tour OpenAI réel du Site A version 4 depuis `cb716aa` a réussi avec un seul `turn.drive` (14 161 ms) et 933 octets persistés ; témoin unique, sans garantie générale de latence. A/B version 5 sont publiés. Dans ChatGPT, le MCP app Lab 0.1.2 a réellement exécuté `purchase_request_get/list` et rendu fiche/liste ; seules des lectures métier ont été exercées. Sur B, `widget.render.read` historique APP a réussi (200), la même route ADMIN avec le seul cookie APP a refusé (401 `authentication_required`), puis APP a relu et s'est déconnecté. Ce refus concerne le transport widget natif, pas `tools/call` ChatGPT. La publication Cloudflare Lab, sa conservation native et une nouvelle réponse OpenAI sont confirmées ; trois widgets historiques sont confirmés par navigateur après rechargement, mais la prose IA historique contient un montant erroné et le retour utilisateur reste ouvert. T39 exhaustive suit les lots différés. Voir [T39](IMPLEMENTATION-T39.md).

## Sous-tâches initiales obligatoires du lot des connecteurs

| Sous-tâche | Périmètre et preuve minimum |
|---|---|
| T-29-HERMES | Capacités, soumission externe, progression/résultat persistés, validation humaine et annulation/reprise selon protocole ; retour au chat autorisé. |
| T-29-MAIL | Envoi vers destinataire de test autorisé, réception, accusés/webhooks, réconciliation et reprise raccordés aux boîtes/outbox natives. |
| T-29-BROWSER | Sessions/profils, navigation/actions, visualisation et fin de session ; relais utilisateur distinct, authentifié et explicitement autorisé. |
| T-29-GRANOLA | Notes, transcriptions, dossiers, réception signée, déduplication, synchronisation et consultation avec compte fournisseur réel. |
| T-29-DEV | Projets/modèles autorisés, demandes/exécutions/journaux/artefacts, annulation et MCP ; génération/vérification de code par exécuteur externe puis livraison autorisée. Aucun processus dans le socle. |
| T-29-OBS | Export d’événement corrélé filtré et réception réelle par le service ; analytics natifs autonomes. |
| T-29-DESKTOP | Client desktop, commandes autorisées, état de ressources et protocole authentifié ; aucune dépendance du démarrage web au client. |
| T-29-AI-VOICE | Pour les fournisseurs/capacités retenus au PRD : modèles, flux, outil contrôlé et voix réellement configurés/testés ; absence de fournisseur explicite. Ne pas assimiler un port extensible à une intégration livrée. |

Ces sous-tâches sont toutes à faire, sous la responsabilité et les dépendances T-29. Créer leur PRD/TODO nominal avant code, avec six suites et preuves/versions/accès propres. Le choix d’un service de test ne retire aucune famille de capacités ; une API fournisseur incapable d’une fonction impose un écart documenté et une décision, pas un faux succès. Les recettes ne promettent pas toutes les API de tous les fournisseurs possibles.

## Prérequis à vérifier au moment utile

| Prérequis | Lot concerné | Conduite |
|---|---|---|
| GO de développement | T-01 et suivants | GO du 26 septembre désormais restreint par les priorités du 28 septembre : accords explicites futurs pour T-23/T-24, T-34/T-35 et toute reconstruction WinHub/TempoFlow ; compléments T-04/T-05/T-06/T-10 différés et expliqués avant reprise. |
| Revue technique et règles GitHub | T-01 ; première fusion | Compte unique creezio autorisé ; revue d’un autre agent liée au SHA, origine du workflow vérifiée et protections qualifiées. Aucune approbation GitHub indépendante inventée. |
| Site public du compte courant | T-09 | Réutiliser le Site de qualification s'il est accessible et adapté ; si l'ancien renvoie 404 après changement de compte GPT, créer un nouveau Site public, mettre à jour le `project_id` courant et conserver l'ancien identifiant et ses preuves. Éviter les Sites de test dupliqués. |
| Docker fonctionnel | T-31 | Docker Linux utilisé pour la recette T31, puis pour la première publication et le premier update T32 de l'original ; arrêts propres avec code zéro. La démo conserve sa recette propre. Ne pas lancer de service utilisateur implicitement. |
| Compte Cloudflare connecté | T-32/T-33 | Compte autorisé utilisé pour une première publication et un premier update réels de l'original sur workers.dev, avec Worker/assets, D1/R2 et registre vérifiés dans le périmètre T32. La démo, les limites de quotas et T33 gardent leurs contrôles propres. Les droits DNS du jeton utilisé sont insuffisants : vérifier les accès de zone existants si domaine personnalisé. Pour le transfert multipart par S3 R2, réutiliser uniquement les credentials et permissions qualifiés pour la cible ; ne pas réclamer automatiquement une nouvelle clé. |
| Accès fournisseurs | T-15/T-26 à T-29 | Réutiliser les secrets autorisés conservés ; affectation explicite à chaque environnement, jamais copie automatique des secrets de la sonde. Accès manquant = recette concernée non qualifiée. |
| Publication npm/catalogue/plugin | T-30/T-36 | Vérifier comptes/origines/droits ; tester d’abord le tarball sans publication publique. |
| Contrat de distribution | Avant le premier push public de code ou autre distribution concernée, puis T-30/T-36 | Arbitrage différé : aucune question de licence/tarif/SaaS à rouvrir pendant le cadrage technique. Vérifier le périmètre avant sa première distribution, sans bloquer la conception et le travail local autorisé. |
| Fork et Site B | T-37 | Destination approuvée ; relire disponibilité/droits puis créer après validation du socle. |

La liste de fichiers du dépôt et les skills guident la reprise. Une session se termine avec tâche courante, état exact, preuves et blocages consignés, sans considérer une conversation comme unique mémoire du projet.
