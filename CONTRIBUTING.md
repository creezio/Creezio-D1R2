# Contribuer à Creezio

Le développement est autorisé suivant le plan et le backlog. Le runtime et les contrôles automatisés sont construits et qualifiés par lots. La présence d'un guide, d'un skill ou d'un fichier de configuration ne signifie pas qu'une CI ou une protection distante est active.

## Préparer une contribution

Lire [AGENTS.md](AGENTS.md), le [PRD](docs/PRD.md), le [plan d'implémentation](docs/PLAN-IMPLEMENTATION.md), le [standard de développement](docs/DEVELOPMENT-STANDARD.md) et le [cycle Git](docs/GIT-FLOW.md). Pour un module, lire aussi le [standard des modules](docs/STANDARD-MODULE.md) et le [contrat des dépendances](docs/DEPENDANCES-MODULES.md). Déclarer les fournisseurs obligatoires/facultatifs, versions/origines et ports publics, puis vérifier les consommateurs avant toute rupture. Les [skills de développement](skills/README.md) accompagnent cette méthode ; ils ne remplacent ni les contrôles ni les autorisations.

Relier le travail à une exigence et à une tâche existante dans [EXIGENCES.md](docs/EXIGENCES.md), [USER-STORIES.md](docs/USER-STORIES.md) et [TODO.md](docs/TODO.md). Une issue précise le besoin et les critères quand GitHub est utilisé. Sans GitHub, une tâche locale persistante remplit cette fonction sans inventer de référence distante.

Réutiliser les sources, checkouts et dépendances disponibles. Préserver les changements non committés, les données et le travail des autres contributeurs. Coordonner les modifications communes avant d'éditer les mêmes fichiers. Ne jamais publier de secret, token, clé privée, donnée utilisateur ou code privé sans mandat.

## Développer et documenter

Le contrat d'un module est identique qu'il soit natif, commun, propre à une application ou fourni par un tiers. Sa logique et ses données sont partagées par UI, API, MCP et widgets. Un plugin conversationnel ne crée pas un autre backend ; le front est facultatif et les droits sont vérifiés côté serveur.

Toute contribution conserve les capacités et interactions spécifiées. Elle fournit les critères positifs et négatifs pertinents, les tests nécessaires et les documents affectés. Chaque module possède README, AGENTS, FILES, PRD, interview, TODO et changelog ; les documents sont actualisés selon l'impact, sans modifications artificielles lorsqu'ils ne sont pas concernés.

Les six suites de module sont backend, UI, API/MCP, widgets, paquet et documentation. Leur exécution commune et les contrôles SDK sont à construire et qualifier avant d'être annoncés opérationnels. Une suite absente ou non exécutée, une intégration sans accès et une recette sur un autre environnement restent explicitement non vérifiées.

Les modules externes fournissent un paquet runtime et un artefact de validation lié à la même version, origine, révision et intégrité. Toutes leurs références nécessaires doivent être résolues. La politique de l'éditeur ne remplace pas celle du consommateur ; aucun code de test tiers ne reçoit de secret de production.

## Proposer et intégrer

Le flux commun est : branche de travail issue de `main`, PR à jour, revue technique par un autre agent sur le SHA final, squash GitHub, puis vérification du nouveau `main`. Les branches sont de type `module/`, `core/`, `docs/` ou `release/` selon le [cycle Git](docs/GIT-FLOW.md). `release/` sert à préparer une publication et n'est pas une deuxième branche stable. Le bootstrap autorisé étend la PR #1 au P0 sur sa branche actuelle ; cette exception initiale évite des PR empilées et conserve les contrôles avant fusion. Le responsable autorise également les checkpoints de développement local pendant le blocage de facturation Actions, selon GIT-FLOW ; les protections de fusion restent appliquées.

La PR décrit le problème et le comportement final, son périmètre, les contrats et données affectés, les preuves, les limites et les documents actualisés. Elle est tenue à jour après correction. Une contribution ne choisit pas une autre méthode de fusion pour contourner les règles communes.

Indexer uniquement les chemins concernés et relire le diff. Les commits suivent `<type>(<scope>): <résultat>`. Ne pas pousser directement `main`, réécrire une branche publiée, forcer un push, ignorer les hooks/contrôles ou utiliser un bypass. Une PR devenue ancienne est actualisée en intégrant `main` dans sa branche, puis contrôlée et revue à nouveau.

Le projet utilise le compte GitHub `creezio`, conformément à la décision utilisateur. Aucune seconde identité GitHub ni App dédiée n'est requise. Un autre agent relit la révision finale ; sa conclusion, le SHA et les limites sont conservés hors du commit source ou dans un artefact associé. L'orchestrateur vérifie cette revue, l'origine du workflow et les résultats de CI avant de fusionner. Cette preuve technique n'est pas une approbation GitHub, et le nom du check ne garantit pas à lui seul quel workflow l'a produit.

Les issues et PR sont créées ou commentées dans le mandat donné. Une correction amont n'autorise pas implicitement le déploiement des applications qui la consomment. Une app privée peut proposer une correction expurgée sans transmettre son code métier, ses données ou ses accès.

## Publier et adopter

Une release est préparée dans une PR distincte puis intégrée par squash. Construire et tester l'artefact depuis le **nouveau commit final de `main`**, avec les versions et verrous définitifs. Publier cet artefact exact dans le mandat accordé ; ne pas reprendre le build d'une ancienne PR. Tags, versions et intégrités publiés restent immuables.

Fusion d'une contribution, publication d'un composant et installation dans une application sont distinctes. La recette de l'application vérifie conservation de son front, de ses extensions, de ses données et de ses droits. Son historique d'installation rapporte le résultat effectif ; le changelog du paquet ne le remplace pas.

Sans GitHub, le parcours conserve provenance, source identifiée, validation, revue autorisée et preuves de livraison locales ou Sites. Il ne prétend pas disposer de PR ou de protections GitHub. Aucun compte GitHub n'est créé ou relié implicitement.

## Licences et état des contrôles

Respecter le [LICENSE](LICENSE) applicable aux fichiers concernés et le [cadre des licences et offres](docs/LICENCES-ET-OFFRES.md). Les décisions futures Community/Enterprise, les tarifs et le périmètre premium restent distincts du contenu déjà publié. Ne pas placer automatiquement tout nouveau composant sous une licence globale ni inventer une cession ou un accord de contribution non approuvé.

L'activation effective de la gouvernance est une étape P0 préalable au runtime : identités, protections, validateurs, origine des checks et cas de refus doivent être vérifiés. Tant que cette qualification manque, les guides expriment les exigences à satisfaire et les comptes rendus doivent conserver cette limite.
