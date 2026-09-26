# Changelog

## Non publié

- T-04 : listes administratives paginées des comptes et sessions, suspension/réactivation des comptes humains sans perte de leur état d’inscription, révocation ciblée ou globale. Les lectures revérifient la garde dans leur batch ; les mutations et leur audit restent atomiques, même si l’administrateur révoque sa propre session. Aucun parcours HTTP ou écran ouvert par cette tranche.

- T-04 : comptes de service et tokens API à scopes exacts contexte/audience/permissions ; émission, rotation, révocation et état sous garde administrative fraîche. Résolution machine distincte des sessions humaines, droits actuels en intersection, cibles d’opération copiées avant attente. Transports et interfaces encore à raccorder.

- T-04 : invitations/activations et récupération à usage unique, comptes en attente sans droits implicites, versions de credential et révocation des sessions/capacités après récupération ; émission/révocation réservées à la gestion des accès. Résolveur natif partagé et capture des entrées avant attente. Livraison des liens et transports encore à raccorder.

- T-04 : rôles/contextes/affectations/overrides persistants et droits initiaux explicites ; lecture cohérente et remplacement autorisé du graphe dans D1, protégés par session fraîche, epoch et claim atomique. Les canaux HTTP/MCP et interfaces restent à raccorder.
- T-04 : primitives d'identité, moteur pur de droits, huit modèles access et SQL central ; bootstrap à usage unique, comptes/sessions D1 révocables et admission avant KDF. Contrat/docs/six suites du module présents ; transports de connexion, droits persistants, invitations/reset et interfaces restent en construction.
- Reprise GitHub : PR #1 à #4 intégrées après régularisation Actions, revue technique, CI des candidats et de chaque nouveau main. PR #5 qualifie le refus d'un candidat volontairement invalide ; le test témoin est retiré, sans modifier les contrôles ni le runtime.
- Runtime T-03 : Worker commun, composition statique contrôlée, adaptateurs DB/BUCKET, vue initiale et module témoin de qualification. Opérations protégées fermées jusqu'au raccordement de l'identité native ; aucune publication produit.
- Démarrage de T-01 après GO : contrôleurs documentaires et de gouvernance, tests de refus et empreinte des sources. Workflow candidat sans droits de publication.
- Contrats de widgets : plusieurs types/instances par module et modes message/contexte/direct déclarés par action.

Le CMS n'est pas encore livré. Les protections distantes et les qualifications runtime restent distinctes de ces réalisations locales ; voir [P0](docs/IMPLEMENTATION-P0.md) et [TODO](docs/TODO.md).

## En cours — contrats et dépendances de modules

- Contrat de dépendances commun à toutes les origines : déclarations, résolution/verrou, contributions facultatives, protection des consommateurs et conservation des données.
- Six exigences supplémentaires, critères des stories/lots, guides IA et gabarits de revue alignés ; gestionnaire et recettes hébergées encore à construire.
- Poursuite locale autorisée pendant le blocage GitHub Actions, sans changement des protections de fusion.
