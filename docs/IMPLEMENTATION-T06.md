# Registre et exécutions — T-06

La branche `core/t06-operations` part de `d22df2d`, qualifié après la PR #14 : 672 tests locaux et dans la CI du candidat puis du main. Le [lot T-06](TODO.md#T-06) est en cours ; aucune nouvelle opération publique n'est annoncée qualifiée par cette préparation.

## Répartition et contrats

Socle compile les schémas canoniques v1 en validateurs statiques compatibles Worker, sans compilation dynamique dans l'application. Apps construit le stockage technique des exécutions, tentatives, audits et intentions de sortie. Certivan produit la recette indépendante sur D1 et les trois identités natives. Codex raccorde le registre, l'exécuteur, la composition, la documentation et les contrôles communs.

Le contrat d'opération existant reste la référence : schémas d'entrée/sortie, acteur, audience, contexte, permissions, effets déclarés, concurrence et idempotence. Les adaptateurs transmettent une demande au même service ; un canal n'accorde aucun droit. Les handlers reçoivent leurs lectures et plans autorisés, jamais la base, un jeton natif, du SQL libre ou le droit de fabriquer une identité.

Les plans métier, le résultat, l'audit et les intentions de sortie rejoignent le même batch D1 avec garde fraîche. Une réponse perdue doit pouvoir être relue sans rejouer l'effet. Un effet fournisseur se prépare et se réclame durablement avant l'appel réseau ; son état incertain ne devient pas un échec certain ni une autorisation de renvoyer. La clé d'idempotence fournisseur reste distincte de la clé interne. Aucun scheduler n'est ajouté.

Les modèles techniques appartiennent à l'hôte `creezio.runtime`, namespace réservé, et passent par le compilateur SQL central. Ils ne constituent pas un module métier supplémentaire. Les modules continuent à déclarer leurs modèles actuels et n'écrivent pas de scripts de transformation SQL.

## Registre et exécuteur

La composition émet `operations.ts` et `operation-validators.mjs` avec les imports statiques de toutes les opérations actives, y compris celles sans route HTTP. Les schémas stricts sont compilés au build ; ni AJV compilateur, ni code dynamique, ni téléchargement de schéma ne sont nécessaires dans le Worker. Le catalogue et les déclarations sont capturés et immuables. Les tests T-03 conservent leur témoin HTTP de métadonnées ; cette fixture ne vaut pas qualification des futurs adaptateurs métier T-06.

Le moteur interne expose `invoke` et `status`. L'entrée est capturée et validée avant claim ; l'identité, l'audience, le contexte et les droits viennent des services T-04. Le handler peut lire et fabriquer au plus seize plans, sans écriture immédiate. Les effets doivent être déclarés ; les champs protégés restent fermés. Le résultat est validé avant le batch qui associe les plans, l'audit, le résultat et l'outbox. Le contrôle de version d'objet et les gardes natives sont réévalués dans cette transaction.

Une clé d'idempotence appartient à un module, une opération, un acteur réel, un sujet, un contexte et une audience. Sa portée ne change pas avec la version : changer l'entrée ou le contrat produit un conflit, pas une nouvelle action. Le digest couvre l'opération, la version du module et ses schémas. Après expiration de la rétention, la clé existante reste bloquée ; aucun nettoyage ou paiement répété n'est déduit d'une échéance. Les entrées brutes et credentials ne sont pas conservés dans l'historique ; seul leur hash utile à la concordance est stocké.

Annuler ou dépasser le délai ferme les capacités du handler, mais ne préempte ni du JavaScript synchrone ni un batch déjà engagé. En cas d'acquittement perdu, seul un résultat terminal effectivement relu permet de confirmer l'issue. Sinon le moteur rend `unknown` ; une lecture ultérieure avec autorisation fraîche permet la réconciliation. Un claim tenté n'est jamais réutilisé. Le stockage prépare aussi des claims de livraison et une reprise explicite de préparation expirée ; leurs adaptateurs publics restent à construire. Une livraison réclamée ou incertaine n'est jamais remise automatiquement en file.

Les quatre modèles techniques passent par le SQL central, sans devenir des modèles publics d'un module. Le pont de transaction est lié à l'instance D1 et reste interne au cœur. Les handlers ne reçoivent ni ce pont ni le stockage des exécutions. Ces capacités encadrent les modules de confiance ; elles ne constituent pas un bac à sable pour du code hostile partageant le Worker.

## Critères et progression

La tranche traite [REQ-0601](EXIGENCES.md#REQ-0601), [REQ-0602](EXIGENCES.md#REQ-0602), [REQ-0603](EXIGENCES.md#REQ-0603) et [US-06](USER-STORIES.md#US-06). Les recettes doivent couvrir entrée/sortie invalides, refus de mutation par une query, droits frais, contexte/audience, doublons et concurrence, rollback tardif, révocation entre préparation et commit, reprise observée et livraison externe incertaine.

L'approbation humaine requise, les événements, les appels interopérations et les effets intermodules restent refusés jusqu'à leur raccordement qualifié. Les routes métier protégées restent fermées ; aucune API, recette MCP ou livraison fournisseur réelle n'est annoncée par ces services internes. OAuth et signatures fournisseurs nécessitent leurs transports respectifs. Tests internes, API hébergée et client MCP réel sont des preuves distinctes ; aucune étiquette de canal dans une fixture ne vaut recette de transport. Les résultats seront liés au candidat et à ses revues avant fusion.

Le PRD, les exigences et les contrats v1 restent inchangés : cette tranche construit une partie des critères existants. `npm run test:operations` cible ses recettes ; la famille est obligatoire dans `npm run check`. La qualification porte sur des données synthétiques, notamment les trois credentials natifs, l'entrée/sortie invalide, les champs protégés, le doublon, le rollback tardif, la révocation, le délai et la lecture après acquittement perdu. Aucun service tiers, serveur planifié ou nouveau déploiement n'est ajouté.
