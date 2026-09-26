# Backlog de réalisation
Révision 7 — 26 septembre 2026. **GO complet reçu ; T-01 à T-04 en cours selon leurs qualifications.** Ce fichier est la liste de travail canonique du produit ; le plan et les PRD de modules y renvoient. Les PR #1 à #5 sont intégrées ; la base `123e182` passe 343 tests en CI. La tranche `core/t04-authorization` ajoute les droits D1 et la modification atomique du graphe ; T-04 conserve les parcours encore absents décrits ci-dessous. L'[état P0](IMPLEMENTATION-P0.md) distingue contrôleurs et gouvernance. Le dossier documentaire est audité séparément dans [AUDIT-AVANT-DEVELOPPEMENT.md](AUDIT-AVANT-DEVELOPPEMENT.md) ; il ne coche aucune fonctionnalité.
## Règles de suivi
États autorisés : à faire, en cours, bloqué (raison/prérequis), en revue, vérifié, livré. Enregistrer responsable réel, branche/issue ou tâche locale, PR, SHA, tests/profils et preuves à chaque transition. « Livré » exige version et livraison vérifiée ; fusionner ne suffit pas. Une dépendance fournisseur manquante bloque sa recette, pas toutes les tâches indépendantes.
Après GO, commencer P0 puis la tranche P1/P2 nécessaire au premier Site ; les dépendances ci-dessous priment sur le numéro du lot. Qualifier Cloudflare tôt dès disponibilité, mais ne pas bloquer le travail local sur son accès. P3/P4 peuvent avancer par tranches couplées : installer un module témoin d’abord, finaliser le starter après widgets/front. Le socle complet et les preuves restent requis avant P7.
Chaque ligne constitue un lot de PR de taille révisable, pas une autorisation de tout coder dans une seule branche. Avant son exécution, décomposer les sous-tâches dans le PRD/TODO du module avec critères hérités ; enregistrer leurs liens ici. Cette décomposition ne peut ni retirer une exigence ni faire passer un lot partiel à « vérifié ».
## Jalons de dépendance et qualifications différées

Une dépendance consomme un **livrable précis et testé**, pas automatiquement l’achèvement mondial de toutes ses recettes. Enregistrer séparément `livrable local vérifié`, `qualification Sites`, `qualification Cloudflare`, `recette dérivée`. Une exigence reste partiellement qualifiée tant que ses profils requis manquent ; pas de case globale « vérifié » anticipée. Pour les tâches non listées, les critères pertinents du livrable doivent être satisfaits avant son utilisation.

| Prérequis consommable | Ce qui autorise la suite | Ce qui reste à qualifier et où |
|---|---|---|
| T-01 → T-02/T-03 | Contrôleurs locaux testés/revus, protections appliquées et CI des PR puis de main réussies après régularisation Actions | Contrôles fonctionnels ajoutés par T-02 puis modules ; la preuve de SHA/artefact est d’abord un test du contrôleur, pas une release de CMS. |
| T-02 → T-03/T-11 | Schémas/validateurs SDK exécutés sur fixtures valides/invalides ; aucun runtime applicatif prétendument testé | Six suites de vrais modules et intégration hôte en T-11/T-30 ; répétition pertinente sur les modules ultérieurs. |
| T-04/T-05/T-06/T-07 → T-08/T-09/T-31 | Comptes, modèles, fichiers, opérations et workspace construits et testés localement | T-09 teste la tranche sur Sites ; T-32 sur Cloudflare. Les fonctions ajoutées ensuite repassent la recette hôte avant T-36. |
| T-10 à T-29 → lots consommateurs | Contrats et code testés sur l’environnement disponible, avec refus ; aucune intégration fournisseur annoncée réelle sans accès | Compléter tous les profils et fournisseurs déclarés avant T-36 ; leurs preuves peuvent avancer en parallèle des tâches indépendantes. |
| T-12 → T-23 | Documentation installée, lecture autorisée et distinction des révisions prouvées | Édition/validation/immutabilité du PRD de travail réalisées en T-23. |
| T-30 → T-32 | Tarball dans app hôte locale et démo locale autonomes ; docs/tests/artefacts complets | Démo Cloudflare en T-32 ; installation/update dans le vrai fork après création de B, en T-38. |
| T-32/T-33 → T-36 | Original et démo sur Cloudflare, transfert/reprise/isolation prouvés | Même parcours du fork après sa création, en T-38. |
| T-36 → T-37 | Toutes les capacités de l’original et recettes disponibles sur A/Cloudflare validées, politique de distribution examinée | B n’existe pas avant ce jalon ; ses scénarios de filiation/update sont T-37/T-38, puis validation globale T-39. |

Les droits de distribution sont vérifiés **avant chaque première publication concernée**, y compris starter/démo/paquet s’ils précèdent la release finale. Cette vérification ne demande pas de choisir maintenant les futurs tarifs ou les fonctions premium. Toute publication externe conserve son mandat propre.

## Vue ordonnée par dépendances
| Tâche | Lot | Livrable | Dépendances | État |
|---|---|---|---|---|
| [T-01](#T-01) | P0 | Gouvernance effective et revue indépendante | GO reçu | En cours |
| [T-02](#T-02) | P0 | Contrats exécutables et contrôle commun | [T-01](#T-01) | En cours |
| [T-03](#T-03) | P1 | Runtime commun et démarrage local | [T-02](#T-02) | En cours |
| [T-04](#T-04) | P2 | Identités, comptes et droits | [T-03](#T-03) | En cours |
| [T-05](#T-05) | P2 | Données, fichiers, recherche et coffre | [T-03](#T-03), [T-04](#T-04) | À faire |
| [T-06](#T-06) | P2 | Opérations, événements et exécutions bornées | [T-04](#T-04), [T-05](#T-05) | À faire |
| [T-07](#T-07) | P1 | Workspace et conservation des onglets | [T-03](#T-03), [T-04](#T-04), [T-05](#T-05), [T-06](#T-06) | À faire |
| [T-08](#T-08) | P1 | Registre minimal et identité de publication | [T-04](#T-04), [T-05](#T-05), [T-06](#T-06) | À faire |
| [T-09](#T-09) | P1 | Première tranche sur Sites | [T-07](#T-07), [T-08](#T-08) | À faire |
| [T-10](#T-10) | P2 | MCP, OAuth et accès machine | [T-06](#T-06), [T-09](#T-09) | À faire |
| [T-11](#T-11) | P3 | SDK et cycle de vie des modules | [T-02](#T-02), [T-06](#T-06), [T-10](#T-10) | À faire |
| [T-12](#T-12) | P3 | Documentation vivante des modules | [T-11](#T-11) | À faire |
| [T-13](#T-13) | P4 | Fronts, thèmes et headless | [T-07](#T-07), [T-11](#T-11) | À faire |
| [T-14](#T-14) | P4 | Conversations et progression persistante | [T-06](#T-06), [T-07](#T-07), [T-11](#T-11) | À faire |
| [T-15](#T-15) | P4 | Module OpenAI et contrat fournisseur | [T-14](#T-14) | À faire |
| [T-16](#T-16) | P4 | Widgets et plugins conversationnels compatibles GPT | [T-10](#T-10), [T-13](#T-13), [T-15](#T-15) | À faire |
| [T-17](#T-17) | P5 | Tâches humaines et travail | [T-11](#T-11), [T-14](#T-14) | À faire |
| [T-18](#T-18) | P5 | Messagerie native | [T-11](#T-11), [T-14](#T-14) | À faire |
| [T-19](#T-19) | P5 | Support | [T-11](#T-11), [T-17](#T-17), [T-18](#T-18) | À faire |
| [T-20](#T-20) | P5 | CRM | [T-11](#T-11) | À faire |
| [T-21](#T-21) | P5 | Pages et navigation | [T-11](#T-11), [T-13](#T-13) | À faire |
| [T-22](#T-22) | P5 | Analytics et diagnostics | [T-11](#T-11), [T-17](#T-17) | À faire |
| [T-23](#T-23) | P5 | Intentions et développement piloté | [T-12](#T-12), [T-17](#T-17) | À faire |
| [T-24](#T-24) | P5 | Règles et automatisation sans scheduler | [T-11](#T-11), [T-17](#T-17) | À faire |
| [T-25](#T-25) | P5 | Catalogue métier réutilisable | [T-11](#T-11), [T-13](#T-13), [T-16](#T-16) | À faire |
| [T-26](#T-26) | P5 | Connecteur n8n | [T-10](#T-10), [T-11](#T-11), [T-16](#T-16), [T-24](#T-24) | À faire |
| [T-27](#T-27) | P5 | Connecteur Stripe | [T-11](#T-11), [T-16](#T-16) | À faire |
| [T-28](#T-28) | P5 | Connecteur Meili | [T-05](#T-05), [T-11](#T-11) | À faire |
| [T-29](#T-29) | P5 | Autres connecteurs et frontières externes | [T-11](#T-11), [T-16](#T-16), [T-18](#T-18), [T-23](#T-23) | À faire |
| [T-30](#T-30) | P3 | Starter, paquets et extension externe | [T-11](#T-11), [T-12](#T-12), [T-13](#T-13), [T-16](#T-16) | À faire |
| [T-31](#T-31) | P1 | Docker local persistant | [T-03](#T-03), [T-05](#T-05), [T-07](#T-07) | À faire |
| [T-32](#T-32) | P6 | Publication complète Cloudflare | [T-08](#T-08), [T-09](#T-09), [T-30](#T-30), [T-31](#T-31) | À faire |
| [T-33](#T-33) | P6 | Stockages distincts hors Sites | [T-32](#T-32) | À faire |
| [T-34](#T-34) | P6 | Éditions, politiques et activation | [T-08](#T-08), [T-11](#T-11), [T-27](#T-27) | À faire |
| [T-35](#T-35) | P6 | Accompagnement avec accès consenti | [T-23](#T-23), [T-34](#T-34) | À faire |
| [T-36](#T-36) | P7 | Release de l’original | [T-09](#T-09), [T-10](#T-10), [T-12](#T-12), [T-13](#T-13), [T-14](#T-14), [T-15](#T-15), [T-16](#T-16), [T-17](#T-17), [T-18](#T-18), [T-19](#T-19), [T-20](#T-20), [T-21](#T-21), [T-22](#T-22), [T-23](#T-23), [T-24](#T-24), [T-25](#T-25), [T-26](#T-26), [T-27](#T-27), [T-28](#T-28), [T-29](#T-29), [T-30](#T-30), [T-32](#T-32), [T-33](#T-33), [T-34](#T-34), [T-35](#T-35) | À faire |
| [T-37](#T-37) | P7 | Vrai fork Creezio Lab et Site B | [T-36](#T-36) | À faire |
| [T-38](#T-38) | P8 | Adoption des mises à jour et contributions | [T-37](#T-37) | À faire |
| [T-39](#T-39) | P9 | Recette finale et validation utilisateur | [T-38](#T-38) | À faire |

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
- Besoin : [US-04](USER-STORIES.md#US-04). Acceptation : [REQ-0401](EXIGENCES.md#REQ-0401), [REQ-0402](EXIGENCES.md#REQ-0402), [REQ-0403](EXIGENCES.md#REQ-0403).
- Validation : implémenter puis exécuter les recettes liées, sur **local, puis Sites/Cloudflare** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : fondations/comptes intégrés par PR #4, puis suivi PR #5 et base `123e182` qualifiée (343 tests CI). La tranche `core/t04-authorization` ajoute huit modèles de droits, soit seize modèles access, un seed d'administration explicite et le service d'autorisation avec session/epoch/claim frais. Les recettes ciblées vérifient le graphe, les refus et les courses dans D1 ; le résultat complet et la revue sont liés au SHA candidat dans les preuves de PR. HTTP/UI/invitations/reset/machines/impersonation restent à construire ; garde des mutations métier à raccorder avec T-06. La [sonde Sites](QUALIFICATION-SITES.md) qualifie les KDF, pas ces parcours ; voir [réalisation T-04](IMPLEMENTATION-T04.md).

<a id="T-05"></a>
## T-05 — Données, fichiers, recherche et coffre

- Lot : **P2** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-03](#T-03), [T-04](#T-04).
- Travail/livrables : Services D1/R2/coffre, modèle composé et journal SQL central ; module natif data-explorer, recherche native et export/restauration.
- Besoin : [US-05](USER-STORIES.md#US-05). Acceptation : [REQ-0501](EXIGENCES.md#REQ-0501), [REQ-0502](EXIGENCES.md#REQ-0502), [REQ-0503](EXIGENCES.md#REQ-0503), [REQ-0504](EXIGENCES.md#REQ-0504).
- Validation : implémenter puis exécuter les recettes liées, sur **local, puis Sites/Cloudflare** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-06"></a>
## T-06 — Opérations, événements et exécutions bornées

- Lot : **P2** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-04](#T-04), [T-05](#T-05).
- Travail/livrables : Registre d’opérations, API, erreurs typées, audit, idempotence, outbox, suivi et reprises.
- Besoin : [US-06](USER-STORIES.md#US-06). Acceptation : [REQ-0601](EXIGENCES.md#REQ-0601), [REQ-0602](EXIGENCES.md#REQ-0602), [REQ-0603](EXIGENCES.md#REQ-0603).
- Validation : implémenter puis exécuter les recettes liées, sur **local, puis appel externe hébergé** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-07"></a>
## T-07 — Workspace et conservation des onglets

- Lot : **P1** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-03](#T-03), [T-04](#T-04), [T-05](#T-05), [T-06](#T-06).
- Travail/livrables : Workspace réemployé/adapté, SDK navigation et adaptateur routeur isolé ; recette navigateur reproductible.
- Besoin : [US-07](USER-STORIES.md#US-07). Acceptation : [REQ-0701](EXIGENCES.md#REQ-0701), [REQ-0702](EXIGENCES.md#REQ-0702), [REQ-0703](EXIGENCES.md#REQ-0703).
- Validation : implémenter puis exécuter les recettes liées, sur **navigateur local, puis Sites** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-08"></a>
## T-08 — Registre minimal et identité de publication

- Lot : **P1** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-04](#T-04), [T-05](#T-05), [T-06](#T-06).
- Travail/livrables : Service central séparé, vérification GitHub/email, token d’installation et contrôle de publication ; bootstrap documenté.
- Besoin : [US-08](USER-STORIES.md#US-08). Acceptation : [REQ-0801](EXIGENCES.md#REQ-0801), [REQ-0802](EXIGENCES.md#REQ-0802), [REQ-0803](EXIGENCES.md#REQ-0803).
- Validation : implémenter puis exécuter les recettes liées, sur **service central et app cliente** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-09"></a>
## T-09 — Première tranche sur Sites

- Lot : **P1** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-07](#T-07), [T-08](#T-08).
- Travail/livrables : Site A réutilisé si adapté : compte, module témoin, onglets, opération et fichier ; comparaison local/Sites.
- Besoin : [US-09](USER-STORIES.md#US-09). Acceptation : [REQ-0901](EXIGENCES.md#REQ-0901), [REQ-0902](EXIGENCES.md#REQ-0902).
- Validation : implémenter puis exécuter les recettes liées, sur **Site public réel** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-10"></a>
## T-10 — MCP, OAuth et accès machine

- Lot : **P2** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-06](#T-06), [T-09](#T-09).
- Travail/livrables : Endpoints admin/app, découverte, ressources, OAuth natif et tokens machine ; clients de recette figés.
- Besoin : [US-10](USER-STORIES.md#US-10). Acceptation : [REQ-1001](EXIGENCES.md#REQ-1001), [REQ-1002](EXIGENCES.md#REQ-1002), [REQ-1003](EXIGENCES.md#REQ-1003).
- Validation : implémenter puis exécuter les recettes liées, sur **clients MCP réels et Site public** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-11"></a>
## T-11 — SDK et cycle de vie des modules

- Lot : **P3** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-02](#T-02), [T-06](#T-06), [T-10](#T-10).
- Travail/livrables : SDK versionné, résolveur et verrou transitif, module natif modules-settings, catalogue/configuration/diagnostic « dépend de / utilisé par », plan de changement et gardes communes du cycle de vie. Contributions facultatives et relations persistantes contrôlées selon DEPENDANCES-MODULES.md.
- Besoin : [US-11](USER-STORIES.md#US-11). Acceptation : [REQ-1101](EXIGENCES.md#REQ-1101), [REQ-1102](EXIGENCES.md#REQ-1102), [REQ-1103](EXIGENCES.md#REQ-1103), [REQ-1104](EXIGENCES.md#REQ-1104), [REQ-1105](EXIGENCES.md#REQ-1105), [REQ-1106](EXIGENCES.md#REQ-1106).
- Validation : implémenter puis exécuter les recettes liées, sur **local et app hôte** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-12"></a>
## T-12 — Documentation vivante des modules

- Lot : **P3** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-11](#T-11).
- Travail/livrables : Contrôles docs, documentation embarquée et lecture UI/API/MCP autorisée ; contrats distinguant PRD installé et révisions de travail. L’édition/validation humaine des révisions est construite en T-23.
- Besoin : [US-12](USER-STORIES.md#US-12). Acceptation : [REQ-1201](EXIGENCES.md#REQ-1201), [REQ-1202](EXIGENCES.md#REQ-1202).
- Validation : implémenter puis exécuter les recettes liées, sur **package, workspace et API/MCP** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-13"></a>
## T-13 — Fronts, thèmes et headless

- Lot : **P4** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-07](#T-07), [T-11](#T-11).
- Travail/livrables : Thèmes standard/ChatGPT-like, moteur de composition, composants et client headless ; personnalisation dans application/.
- Besoin : [US-13](USER-STORIES.md#US-13). Acceptation : [REQ-1301](EXIGENCES.md#REQ-1301), [REQ-1302](EXIGENCES.md#REQ-1302).
- Validation : implémenter puis exécuter les recettes liées, sur **navigateur et Site** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-14"></a>
## T-14 — Conversations et progression persistante

- Lot : **P4** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-06](#T-06), [T-07](#T-07), [T-11](#T-11).
- Travail/livrables : Module conversations, états partagés SDK, historique/recherche/archive et transport adapté ; OpenAI indépendant.
- Besoin : [US-14](USER-STORIES.md#US-14). Acceptation : [REQ-1401](EXIGENCES.md#REQ-1401), [REQ-1402](EXIGENCES.md#REQ-1402).
- Validation : implémenter puis exécuter les recettes liées, sur **navigateur local et Sites** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-15"></a>
## T-15 — Module OpenAI et contrat fournisseur

- Lot : **P4** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-14](#T-14).
- Travail/livrables : Module OpenAI, configuration/modèle, adaptation Responses/outils et quotas ; ports autres fournisseurs/voix.
- Besoin : [US-15](USER-STORIES.md#US-15). Acceptation : [REQ-1501](EXIGENCES.md#REQ-1501), [REQ-1502](EXIGENCES.md#REQ-1502).
- Validation : implémenter puis exécuter les recettes liées, sur **OpenAI réel et chats app/workspace** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-16"></a>
## T-16 — Widgets et plugins conversationnels compatibles GPT

- Lot : **P4** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-10](#T-10), [T-13](#T-13), [T-15](#T-15).
- Travail/livrables : Hôte multiwidgets, ressources MCP Apps, paquet plugin/skills, modes message/contexte/direct par action, adaptateur GPT et recette réelle des trois modes dans les deux chats.
- Besoin : [US-16](USER-STORIES.md#US-16). Acceptation : [REQ-1601](EXIGENCES.md#REQ-1601), [REQ-1602](EXIGENCES.md#REQ-1602), [REQ-1603](EXIGENCES.md#REQ-1603), [REQ-1604](EXIGENCES.md#REQ-1604), [REQ-1605](EXIGENCES.md#REQ-1605), [REQ-1606](EXIGENCES.md#REQ-1606), [REQ-1607](EXIGENCES.md#REQ-1607).
- Validation : implémenter puis exécuter les recettes liées, sur **chat Creezio et conversation ChatGPT** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-17"></a>
## T-17 — Tâches humaines et travail

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

- Lot : **P5** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-12](#T-12), [T-17](#T-17).
- Travail/livrables : Module intentions-development, révisions/validation PRD, tâches, artefacts et historique de livraison.
- Besoin : [US-23](USER-STORIES.md#US-23). Acceptation : [REQ-2301](EXIGENCES.md#REQ-2301), [REQ-2302](EXIGENCES.md#REQ-2302).
- Validation : implémenter puis exécuter les recettes liées, sur **workspace et API/MCP** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-24"></a>
## T-24 — Règles et automatisation sans scheduler

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

- Lot : **P3** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-11](#T-11), [T-12](#T-12), [T-13](#T-13), [T-16](#T-16).
- Travail/livrables : Starter destiné à un dépôt public, paquet runtime, validation autonome, plugin et démo locale ; comparateur fournisseur de référence, chaîne de dépendances interéditeurs et intégration facultative depuis les archives réelles. Vérifier les droits avant toute distribution concernée ; publication de la démo qualifiée en T-32.
- Besoin : [US-30](USER-STORIES.md#US-30). Acceptation : [REQ-3001](EXIGENCES.md#REQ-3001), [REQ-3002](EXIGENCES.md#REQ-3002), [REQ-3003](EXIGENCES.md#REQ-3003), [REQ-3004](EXIGENCES.md#REQ-3004).
- Validation : implémenter puis exécuter les recettes liées, sur **tarball dans app de validation indépendante et démo locale** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-31"></a>
## T-31 — Docker local persistant

- Lot : **P1** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-03](#T-03), [T-05](#T-05), [T-07](#T-07).
- Travail/livrables : Docker/Miniflare/workerd, volumes et diagnostic ; recette redémarrage/restauration.
- Besoin : [US-31](USER-STORIES.md#US-31). Acceptation : [REQ-3101](EXIGENCES.md#REQ-3101).
- Validation : implémenter puis exécuter les recettes liées, sur **Docker local réel** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-32"></a>
## T-32 — Publication complète Cloudflare

- Lot : **P6** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-08](#T-08), [T-09](#T-09), [T-30](#T-30), [T-31](#T-31).
- Travail/livrables : Module livraison locale et exécuteur limité, Worker/assets, bindings D1/R2, transfert cohérent et reprise ; original et démo du starter publiés. Le fork sera exercé en T-38.
- Besoin : [US-32](USER-STORIES.md#US-32). Acceptation : [REQ-3201](EXIGENCES.md#REQ-3201), [REQ-3202](EXIGENCES.md#REQ-3202), [REQ-3203](EXIGENCES.md#REQ-3203).
- Validation : implémenter puis exécuter les recettes liées, sur **compte Cloudflare autorisé réel** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

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

- Lot : **P6** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-08](#T-08), [T-11](#T-11), [T-27](#T-27).
- Travail/livrables : Politiques versionnées, justificatifs signés, états de facturation/activation et tests Community/Enterprise.
- Besoin : [US-34](USER-STORIES.md#US-34). Acceptation : [REQ-3401](EXIGENCES.md#REQ-3401), [REQ-3402](EXIGENCES.md#REQ-3402).
- Validation : implémenter puis exécuter les recettes liées, sur **service central et app** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-35"></a>
## T-35 — Accompagnement avec accès consenti

- Lot : **P6** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-23](#T-23), [T-34](#T-34).
- Travail/livrables : Consentement limité/révocable, périmètres lecture/branche-PR/déploiement distincts, audit et révocation.
- Besoin : [US-35](USER-STORIES.md#US-35). Acceptation : [REQ-3501](EXIGENCES.md#REQ-3501).
- Validation : implémenter puis exécuter les recettes liées, sur **dépôt de test consenti** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-36"></a>
## T-36 — Release de l’original

- Lot : **P7** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-09](#T-09), [T-10](#T-10), [T-12](#T-12), [T-13](#T-13), [T-14](#T-14), [T-15](#T-15), [T-16](#T-16), [T-17](#T-17), [T-18](#T-18), [T-19](#T-19), [T-20](#T-20), [T-21](#T-21), [T-22](#T-22), [T-23](#T-23), [T-24](#T-24), [T-25](#T-25), [T-26](#T-26), [T-27](#T-27), [T-28](#T-28), [T-29](#T-29), [T-30](#T-30), [T-32](#T-32), [T-33](#T-33), [T-34](#T-34), [T-35](#T-35).
- Travail/livrables : Release de l’original, manifeste versions/propriété, docs, artefacts et adoption selon Git flow.
- Besoin : [US-36](USER-STORIES.md#US-36). Acceptation : [REQ-3601](EXIGENCES.md#REQ-3601), [REQ-3602](EXIGENCES.md#REQ-3602).
- Validation : implémenter puis exécuter les recettes liées, sur **CI, Site A et artefacts publiés** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-37"></a>
## T-37 — Vrai fork Creezio Lab et Site B

- Lot : **P7** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-36](#T-36).
- Travail/livrables : Fork public Creez-io/Creezio-Lab après validation du socle, Site B, thème et demandes d’achat/validation budget.
- Besoin : [US-37](USER-STORIES.md#US-37). Acceptation : [REQ-3701](EXIGENCES.md#REQ-3701), [REQ-3702](EXIGENCES.md#REQ-3702).
- Validation : implémenter puis exécuter les recettes liées, sur **GitHub et deux Sites publics** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-38"></a>
## T-38 — Adoption des mises à jour et contributions

- Lot : **P8** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-37](#T-37).
- Travail/livrables : Release A→B, update individuelle de module/thème, starter installé, issue/PR amont, refus d’update/retrait cassant les consommateurs et preuves des intégrations facultatives ; publication Cloudflare du fork via le parcours T-32.
- Besoin : [US-38](USER-STORIES.md#US-38). Acceptation : [REQ-3801](EXIGENCES.md#REQ-3801), [REQ-3802](EXIGENCES.md#REQ-3802), [REQ-3803](EXIGENCES.md#REQ-3803).
- Validation : implémenter puis exécuter les recettes liées, sur **A/B, Cloudflare, tarballs et GitHub** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

<a id="T-39"></a>
## T-39 — Recette finale et validation utilisateur

- Lot : **P9** ; état : **à faire** ; responsable nominatif : à attribuer au démarrage.
- Dépendances : [T-38](#T-38).
- Travail/livrables : Rapport associé à ses preuves : versions/SHA/profils, scénarios positifs/négatifs, limites et démonstration utilisateur.
- Besoin : [US-39](USER-STORIES.md#US-39). Acceptation : [REQ-3901](EXIGENCES.md#REQ-3901).
- Validation : implémenter puis exécuter les recettes liées, sur **deux Sites, Cloudflare et clients GPT/MCP** ; inclure les cas négatifs et les contrôles communs appropriés.
- Preuves : aucune preuve produit acquise ; renseigner PR/commit, version, profil, résultats et limites avant changement d’état.

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
| GO de développement | T-01 et suivants | Attendre la décision utilisateur après lecture du dossier. |
| Revue technique et règles GitHub | T-01 ; première fusion | Compte unique creezio autorisé ; revue d’un autre agent liée au SHA, origine du workflow vérifiée et protections qualifiées. Aucune approbation GitHub indépendante inventée. |
| Accès au Site courant | T-09 | Relire accès/outils ; réutiliser le Site de qualification si adapté. Pas de nouveau Site par essai. |
| Docker fonctionnel | T-31 | Moteur inaccessible lors du relevé : diagnostiquer au démarrage du lot, sans lancer un service utilisateur implicitement. |
| Compte Cloudflare connecté | T-32/T-33 | Un nouveau jeton du compte autorisé a permis les lectures Workers/D1/R2 ; sa politique confirme leurs droits d'écriture. Accès suffisant pour préparer la recette sur workers.dev, mais aucune écriture, publication ou limite de quotas qualifiée. Les droits DNS de ce jeton sont insuffisants : vérifier les accès de zone existants si domaine personnalisé. L'ancien échec OAuth n'est plus un préalable obligatoire. Pour le transfert multipart par S3 R2, qualifier les credentials et permissions S3 distincts d’OAuth ; ne pas réclamer automatiquement une nouvelle clé. |
| Accès fournisseurs | T-15/T-26 à T-29 | Réutiliser les secrets autorisés conservés ; affectation explicite à chaque environnement, jamais copie automatique des secrets de la sonde. Accès manquant = recette concernée non qualifiée. |
| Publication npm/catalogue/plugin | T-30/T-36 | Vérifier comptes/origines/droits ; tester d’abord le tarball sans publication publique. |
| Contrat de distribution | Avant le premier push public de code ou autre distribution concernée, puis T-30/T-36 | Arbitrage différé : aucune question de licence/tarif/SaaS à rouvrir pendant le cadrage technique. Vérifier le périmètre avant sa première distribution, sans bloquer la conception et le travail local autorisé. |
| Fork et Site B | T-37 | Destination approuvée ; relire disponibilité/droits puis créer après validation du socle. |

La liste de fichiers du dépôt et les skills guident la reprise. Une session se termine avec tâche courante, état exact, preuves et blocages consignés, sans considérer une conversation comme unique mémoire du projet.
