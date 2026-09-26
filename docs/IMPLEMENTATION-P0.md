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

Contrôleurs autonomes sans dépendance npm tierce ; Node est un outil de développement, pas une dépendance de runtime Creezio. Aucun changement de modèle D1, fichier R2, opération métier, UI ou widget. Les contrats produit et les 83 exigences restent conservés. Les politiques de licence/offres restent différées ; aucun composant premium distribué par ce travail local.

La qualification T-01 reste partielle jusqu’à activation, relecture des réglages et validation du parcours distant avec refus. T-02 et le runtime ne sont pas annoncés livrés ; leurs jalons seront consommés selon le [backlog](TODO.md). Le résultat exact des tests figure dans la preuve locale, avec limites et empreintes.

## Relevé distant du 26 septembre 2026

Les réglages ont été appliqués et relus : main exige une PR, `creezio/quality-gate` depuis GitHub Actions (App ID 15368), une branche à jour et les conversations résolues ; enforcement administrateur actif, zéro approbation GitHub requise, force-push/suppression refusés. Le dépôt n'autorise que squash. Le ruleset de tags `24045719` protège les familles core/module/app/registry contre mise à jour, suppression et réécriture, sans acteur exempté.

Le [premier run distant](https://github.com/creezio/Creezio-D1R2/actions/runs/36257911219) sur `77ad0fabbfec8f6571ce95ba6cb9e8b6489515db` a été refusé avant toute étape : compte GitHub Actions verrouillé pour facturation. Il ne s'agit pas d'un échec des tests. GitHub signale la PR `BLOCKED`, ce qui confirme le refus de fusion en l'absence du contrôle réussi ; aucune tentative de contournement ou fusion effectuée. La régularisation a été demandée au responsable.

La revue technique des contrôleurs/tests/workflow sur cette tête et la base `82241ffade8fb2686d3ad646935ae5a01385dbdc` a été acceptée par un autre agent. Les modifications documentaires sont relues par l'orchestrateur. Toute nouvelle tête exige rapprochement des preuves et de la revue avant fusion. Le développement des contrats peut être préparé localement, mais ni la gouvernance distante complète ni le runtime ne sont déclarés qualifiés tant que la CI n'a pas exécuté les tests.
