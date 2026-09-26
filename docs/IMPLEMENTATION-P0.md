# P0 — démarrage de l'implémentation

Le GO complet a été reçu le 26 septembre 2026. Le mandat autorise la construction suivant le backlog, les validations et les déploiements de recette prévus. Les conditions de revue et de livraison restent applicables ; aucune fonction n'est acquise du seul fait du GO.

## Travail T-01

Responsable de réalisation : Codex, avec travaux délégués et relecture technique séparée. Identité GitHub disponible : `creezio`, également auteur/pousseur de la PR documentaire. Travail local lié à [T-01](TODO.md#T-01), [US-01](USER-STORIES.md#US-01), REQ-0101 à REQ-0104. Décision explicite du responsable : conserver uniquement le compte GitHub creezio. La revue technique est menée par un autre agent sur la révision exacte, sans approbation GitHub fictive. Pour amorcer le dépôt, la PR #1 reçoit le cadrage et les premiers contrôleurs ; après tests/revue et squash, les lots suivants partent de main sur une branche dédiée. Aucun empilement de PR.

Les premières réalisations sont des contrôleurs de développement, pas le runtime du CMS :

- `scripts/quality/docs.mjs` : documents, liens/ancres, traçabilité des exigences/stories/tâches, cycles et contrats documentaires.
- `scripts/quality/governance.mjs` : règles et revue sur snapshot explicite ; refuse données absentes, preuve obsolète, auto-approbation ou contrôle non réussi. Ce validateur ne crée pas d'identité et ne certifie pas l'authenticité d'un snapshot fourni arbitrairement.
- `scripts/quality/evidence.mjs` et `run.mjs` : preuve locale liée au commit/tree et aux empreintes réelles, y compris sources non committées. Les tests vides, ignorés, annulés ou en échec ne passent pas.
- `scripts/quality/observe-github.mjs` : observation distante GET uniquement, via credential Git existant ou environnement, sans copie des jetons dans les preuves.
- `.github/workflows/p0-validation.yml` : tests candidats et contrôle agrégé, sans secrets de publication ; activation et origine à vérifier avant fusion.

Commandes disponibles avec Node 24 : `npm run check:docs`, `npm run test:quality`, `npm run check`. Les deux contrôleurs inspectent des données ; ils n'exécutent pas le code des modules inspectés. L'agrégateur exécute les tests du code candidat et reste une preuve non privilégiée. Le rapport `.quality/latest.json` est ignoré par Git et indique explicitement `mergeReady: false` ; il ne remplace pas les vérifications distantes ni la recette hébergée. Le répertoire est réutilisé à chaque contrôle.

## Gouvernance à un seul compte

Le relevé initial confirme main non protégée et un seul collaborateur, `creezio`. Le responsable a demandé de conserver ce compte et d'adapter le plan. Une seconde identité GitHub et une GitHub App dédiée ne sont donc plus des prérequis. Les relectures d'un autre agent sont enregistrées avec périmètre, source exacte, défauts/corrections et verdict ; ce ne sont pas des approbations GitHub.

Le workflow candidat s'exécute sans secret de publication et agrège ses résultats sous `creezio/quality-gate`. Le mainteneur vérifie avant fusion le workflow réel, son événement, sa révision, les résultats et leur correspondance au head/base relus. La protection exige PR, ce contrôle réussi avec son App ID, base à jour, conversations résolues, squash seul et interdiction de force-push/suppression. Le nombre d'approbations GitHub est zéro ; le contrôle de revue technique appartient au parcours d'intégration.

Limite explicite : GitHub ne distingue pas à lui seul deux workflows homonymes provenant de GitHub Actions. L'orchestrateur doit vérifier cette origine ; un voyant vert isolé ne l'autorise pas à fusionner. Les changements de contrôleurs sont relus séparément contre la politique approuvée. Aucun mécanisme ne prétend retirer au propriétaire son pouvoir de modifier les règles. [Limites GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/troubleshooting-rules).

## Impact et preuves

Contrôleurs autonomes sans dépendance npm tierce ; Node est un outil de développement, pas une dépendance de runtime Creezio. Aucun changement de modèle D1, fichier R2, opération métier, UI ou widget. Les contrats produit et les exigences restent conservés ; les ajouts ultérieurs sont suivis dans EXIGENCES.md. Les politiques de licence/offres restent différées ; aucun composant premium distribué par ce travail local.

Les protections ont été activées et relues ; le parcours de contribution a exécuté ses contrôles distants, y compris le candidat négatif décrit ci-dessous. T-01 conserve les qualifications des futurs profils de livraison de CMS ; les tests actuels de ces politiques ne constituent pas une release produit. Les jalons T-02/runtime sont consommés selon le [backlog](TODO.md), sans annoncer le CMS livré. Le résultat exact des tests figure dans les preuves locales et distantes, avec limites et empreintes.

## Relevé distant du 26 septembre 2026

Les réglages ont été appliqués et relus : main exige une PR, `creezio/quality-gate` depuis GitHub Actions (App ID 15368), une branche à jour et les conversations résolues ; enforcement administrateur actif, zéro approbation GitHub requise, force-push/suppression refusés. Le dépôt n'autorise que squash. Le ruleset de tags `24045719` protège les familles core/module/app/registry contre mise à jour, suppression et réécriture, sans acteur exempté.

Le [premier run distant](https://github.com/creezio/Creezio-D1R2/actions/runs/36257911219) sur `77ad0fabbfec8f6571ce95ba6cb9e8b6489515db` a été refusé avant toute étape : compte GitHub Actions verrouillé pour facturation. Il ne s'agit pas d'un échec des tests. GitHub signale la PR `BLOCKED`, ce qui confirme le refus de fusion en l'absence du contrôle réussi ; aucune tentative de contournement ou fusion effectuée. La régularisation a été demandée au responsable.

## Reprise après régularisation

Le responsable a payé la facture et demandé la reprise de publication le 26 septembre. La [tentative 2 du run de la tête finale](https://github.com/creezio/Creezio-D1R2/actions/runs/36258186574) `3767c435cc506c34994f5a9e6c7032b80067968e` a exécuté 120 tests réussis, sans skip/todo, puis le check requis. L'origine et le contenu du workflow ont été rapprochés de la source ; le commit de test fusionné `2439709` et la tête ont le même arbre `8fdf4f6`. Revue technique finale et relecture indépendante du contrôleur de gouvernance acceptées ; zéro approbation GitHub fabriquée.

La [PR #1](https://github.com/creezio/Creezio-D1R2/pull/1) a été intégrée par squash en `7b585c1eed65d91489404fa9fee88a035a0e35c2`, sans bypass, après relecture des protections. Le [run du nouveau main](https://github.com/creezio/Creezio-D1R2/actions/runs/36265163034) réussit également. Les checkpoints suivants ont ensuite été intégrés dans l'ordre via les PR #2, #3 et #4, avec revue, CI candidate puis CI du nouveau main. Main `485f5ad` passe 343 tests. Ces intégrations ne qualifient pas le CMS complet.

La revue technique des contrôleurs/tests/workflow sur cette tête et la base `82241ffade8fb2686d3ad646935ae5a01385dbdc` a été acceptée par un autre agent. Les modifications documentaires sont relues par l'orchestrateur. Toute nouvelle tête exige rapprochement des preuves et de la revue avant fusion. Les preuves de ces lots et leurs limites figurent dans leurs documents IMPLEMENTATION et le backlog.

## Refus d'un candidat invalide

La [PR #5](https://github.com/creezio/Creezio-D1R2/pull/5), non draft, part de main `485f5ad16a546d31211f6b30474afa24e5b1b0cf`. Son premier candidat `920d63533f0cbd7d2870dd532deac64cebbd5976` ajoute uniquement un test explicitement invalide ; aucun contrôle existant ou fichier de runtime ne change. Le [run négatif](https://github.com/creezio/Creezio-D1R2/actions/runs/36266145749) exécute 344 tests : 343 réussites et un échec, sans skip/todo. Le contrôle requis `creezio/quality-gate` échoue depuis l'App 15368 ; GitHub signale `mergeable_state: blocked`, malgré un merge sans conflit. Les arbres du head et du commit de test fusionné concordent ; workflow et protections sont inchangés.

Le candidat final retire ce test témoin et conserve seulement la mise à jour documentaire du suivi. Il doit repasser la CI et la revue avant squash ; aucune tentative de fusion du candidat invalide, aucun bypass et aucun affaiblissement de protection. L'historique de la PR conserve la preuve du refus, tandis que main ne reçoit pas le test invalide. Les journaux distants affichent les totaux ; leur extrait final ne restitue pas la ligne d'assertion témoin. Son exécution isolée locale confirme l'échec `EXPECTED_T01_QUALIFICATION_REFUSAL` ; seule cette fixture diffère de la base verte.

## Continuité locale pendant le blocage historique

Le responsable avait autorisé explicitement la poursuite locale pendant la régularisation de GitHub Actions. T-02 a été construit sur `core/t02-contracts` depuis le checkpoint P0 `3767c43`, puis T-03 et T-04 sur leurs bases locales testées. Les dépendances intermodules ont été renforcées selon sa demande. Aucun de ces checkpoints n'a contourné le blocage distant. Après régularisation, leurs arbres ont été conservés lors de la synchronisation avec main et vérifiés à nouveau en CI. Le cycle PR/revue/squash normal reprend pour les lots suivants.
