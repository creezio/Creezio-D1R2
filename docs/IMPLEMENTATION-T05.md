# Données, fichiers et coffre — T-05

La branche `core/t05-data-foundations` part du main `db9dd50`, qualifié après la PR #13 (613 tests). Le [lot T-05](TODO.md#T-05) est **en cours**. Cette première tranche construit les primitives nécessaires au registre d'opérations T-06 ; elle ne clôture pas l'explorateur, la recherche, l'export/restauration ni les recettes hébergées.

## Travail de la tranche

| Travail | Responsable | Critères concernés | État |
|---|---|---|---|
| Compiler les modèles sélectionnés, inspecter et appliquer les ajouts compatibles avec reçu central | Agent Socle | [REQ-0501](EXIGENCES.md#REQ-0501), [REQ-0503](EXIGENCES.md#REQ-0503) | En revue |
| Accès D1 par module et contexte, lectures et écritures sous droits frais | Agent Apps | [REQ-0501](EXIGENCES.md#REQ-0501), [REQ-0502](EXIGENCES.md#REQ-0502) | En revue |
| Fichiers privés, publication et reprise D1/R2 ; coffre serveur | Agent Certivan | [REQ-0502](EXIGENCES.md#REQ-0502), [REQ-0504](EXIGENCES.md#REQ-0504) | En revue |
| Intégration, recette indépendante, agrégat et documentation | Codex, coordination | [US-05](USER-STORIES.md#US-05) | En revue |

## Contrats conservés

Le catalogue runtime reprend les modèles et permissions v1 validés, avec leurs propriétaires, tables compilées et états d'activation. Les outils Node de compilation ne sont pas importés dans le Worker. Un modèle présent ne confère aucun droit, et une table conservée après désactivation ne rend pas le module utilisable.

Le SQL provient du compilateur central. L'inspection compare les définitions réelles au plan et aux définitions précédemment enregistrées. Les ajouts compatibles et leur reçu sont atomiques ; une dérive ou une évolution incompatible est refusée sans réparation implicite. Les modules ne fournissent aucun script de transformation. Un reçu permet d'observer un commit après une réponse perdue ; il ne donne pas l'autorité de réexécuter aveuglément le changement.

Le port de données reçoit une identité résolue par les services natifs et une cible d'opération serveur. Les permissions déclarées désignent explicitement leurs actions et ressources ; leurs noms n'ont aucune sémantique implicite. Les capacités et plans internes sont propres à une instance, un module et un contexte. La garde de lecture ou d'écriture recontrôle l'identité et les droits dans le batch D1 qui réalise l'effet. Une décision préalable ne vaut pas permission future.

Les fichiers déclarent leur modèle de métadonnées et le mapping de leurs champs techniques. Les métadonnées privées et le contenu R2 suivent le contexte autorisé. Une préparation dans R2 ne vaut pas publication : la confirmation dans D1 précède l'accès au fichier. D1 et R2 n'ont aucune transaction commune ; les états incertains et les nettoyages incomplets restent explicites et reprenables sur demande.

Le coffre conserve des références opaques et des enveloppes chiffrées, avec une clé d'environnement dédiée et versionnée. Le contexte, la connexion et la version sont liés à l'enveloppe. Seul un connecteur serveur autorisé peut utiliser le clair ; aucune clé n'est envoyée dans les résultats de métadonnées. Remplacer un secret, révoquer son usage et changer la clé de chiffrement sont des opérations distinctes.

Ces services restent internes jusqu'au [registre T-06](TODO.md#T-06). Les opérations métier publiques, l'approbation, l'audit métier, l'idempotence et l'outbox y seront raccordés. Il n'existe pas d'API SQL libre ni de mécanisme de planification interne.

## Validation et limites

`npm run test:data` exécute les tests ciblés ; `npm run check` exige aussi cette famille de tests, avec les contrôles déjà présents. La recette indépendante associe comptes natifs et port D1 : identifiants identiques dans deux contextes, entrées capturées, conflit tardif annulant tout un batch et révocation entre préparation et effet. Les recettes fichiers/coffre et SQL doivent prouver les erreurs, les reprises et la conservation des données sur stockage synthétique.

Les suites ciblées vérifient aussi le refus des suites de données absentes, les ajouts SQL et leur conservation après redémarrage, les mises à jour concurrentes et le rollback après une erreur tardive. Sur D1/R2 réels locaux, elles couvrent la publication du fichier avec l'écriture métier dans un même batch D1, les erreurs R2 et reprises, les catégories et contextes distincts, ainsi que la révocation pendant la lecture R2. Les tests du coffre couvrent le remplacement concurrent, le changement de clé, l'isolation par connexion/contexte et le refus de transmettre un secret lorsque les droits ou son état changent pendant le déchiffrement. Une recette workerd charge directement les primitives de données et de chiffrement ; elle ne remplace pas une recette hébergée.

L'agrégat, les résultats effectifs, la révision et les revues indépendantes sont conservés hors du commit source puis liés à la PR avant fusion. Une réussite ciblée ne vaut pas encore validation globale du candidat. Le nouveau main est vérifié séparément après intégration.

Cette tranche n'expose pas de transport produit pour les fichiers ou le coffre. Les fichiers publics restent refusés ; l'abandon concerne une préparation non publiée et conserve son état pour reprendre le nettoyage. Le coffre est injecté dans un connecteur serveur de confiance ; il ne prétend pas isoler un connecteur malveillant ayant reçu le secret. Aucun transfert implicite de clé, purge autonome ou transaction D1/R2 n'est ajouté. Les modifications de colonnes, les preuves Sites/Cloudflare, l'explorateur, la recherche, les relations/projections encore non prises en charge et l'export/restauration demeurent ouverts dans le backlog. Les bornes techniques ne constituent pas des offres premium.
