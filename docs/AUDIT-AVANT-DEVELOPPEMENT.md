# Audit du dossier avant développement

Mise à jour après GO du 26 septembre : le responsable a autorisé l’implémentation complète et le fonctionnement sous le seul compte creezio. Voir [P0](IMPLEMENTATION-P0.md) pour les réalisations ; les relevés initiaux ci-dessous sont historiques.

26 septembre 2026 — révision de cadrage 1. Périmètre : cohérence du plan, architecture, capacités, modules, interfaces, gouvernance et préparation du développement. **Ce rapport n'est pas une recette runtime ni un audit de sécurité d'un CMS déjà construit.**

Travail documentaire local `task-20260926-01`, rattaché à la demande de consolidation et d'audit avant GO. Branche de revue : `docs/task-20260926-01-cadrage-complet`. Ce travail prépare notamment les contrats des exigences REQ-0101 à REQ-0203 et leur traçabilité ; il ne déclare pas ces contrôles implémentés.

## Complément : interactions de widgets

La clarification du 26 septembre ajoute quatre exigences (REQ-1604 à REQ-1607), portant le total à **83 exigences**, toujours 39 stories et 39 tâches. Le [contrat des interactions](INTERACTIONS-WIDGETS.md) rend explicites widgets multiples, modes message/contexte/direct **par action**, parité chat interne/GPT et absence d'approbation métier implicite. Les chiffres du contrôle initial ci-dessous restent datés de sa révision à 79 exigences ; ils ne décrivent pas ce complément. La documentation OpenAI a été relue, mais aucune recette en conversation GPT ni implémentation Creezio n'est annoncée réalisée.

Après deux premiers jetons actifs mais insuffisants pour D1/R2, un nouveau jeton fourni a permis les lectures Workers, D1 et R2 ; sa politique confirme les droits d'écriture correspondants. Il permet de préparer la recette sur workers.dev, sans prétendre à une publication déjà réussie. Le DNS reste refusé pour ce jeton : vérifier séparément les accès de zone si domaine personnalisé. Aucun droit modifié, jeton créé ou déploiement exécuté ; la conservation des accès reste locale et chiffrée hors de ce dépôt. Le renouvellement de l'ancien OAuth n'est plus un préalable obligatoire.

## Verdict et limites

Le dossier décrit les usages, frontières, contrats, critères et ordre de travail nécessaires pour commencer **P0 après GO utilisateur**. Aucun nouveau choix produit bloquant n'a été identifié après correction. Le code du CMS, ses contrôleurs et ses recettes restent à construire. Les protections distantes et le parcours de revue technique doivent être établis dans P0 ; les accès nécessaires aux autres jalons sont listés ci-dessous.

Le PRD, les exigences, les stories et le backlog ne sont pas quatre listes concurrentes : le PRD fixe le résultat, les exigences définissent l'acceptation, les stories expriment les parcours et TODO porte dépendances/états/preuves. Les contrats spécialisés détaillent ces exigences ; une réduction de leur périmètre demande une décision explicite.

## Dossier examiné

- [PRD](PRD.md), [exigences](EXIGENCES.md), [stories](USER-STORIES.md), [backlog](TODO.md), [plan](PLAN-IMPLEMENTATION.md) et [matrice](MATRICE-CAPACITES.md).
- [Dépôts et modules natifs](ARCHITECTURE-DEPOTS.md), [standard module](STANDARD-MODULE.md), [écosystème](EXTENSIONS-THEMES-ECOSYSTEME.md), [compatibilité GPT](COMPATIBILITE-CHATGPT.md), [stockage](STOCKAGE-ET-HEBERGEMENT.md), [cadre produit](CADRE-PRODUIT-ET-COMMUNAUTE.md) et [offres](LICENCES-ET-OFFRES.md).
- [AGENTS](../AGENTS.md), [FILES](../FILES.md), [contribution](../CONTRIBUTING.md), [développement](DEVELOPMENT-STANDARD.md), [Git flow](GIT-FLOW.md), [neuf skills](../skills/README.md), gabarits d'issues et de PR.
- Preuves techniques datées de la [qualification Sites](QUALIFICATION-SITES.md), sans nouvelle exécution hébergée pendant cet audit documentaire.

Trois relectures parallèles ont confronté le dossier aux capacités, aux contrats de développement/packaging et aux parcours UI/chat. Elles servent de revue technique locale ; elles ne constituent pas une approbation GitHub par une identité indépendante.

## Incohérences corrigées

| Constat | Correction et trace |
|---|---|
| MIT encore présenté globalement et modèle commercial exigé trop tôt | Limiter l'affirmation au contenu déjà publié ; préparer politiques/activation, différer licence/tarifs/premium/SaaS. Vérifier les droits avant chaque distribution concernée, sans rouvrir maintenant l'arbitrage. |
| Documentation et CI module insuffisamment inscrites au plan | Contrat uniforme PRD/interview/TODO/CHANGELOG/README/AGENTS/FILES/gate et six suites ; contrôles SDK indépendants, références de validation fermées et docs de la version installée. |
| Méthode de branches/fusion seulement évoquée | Git flow unique avec tâches, branches courtes, sync par merge, revue distincte, squash et artefact du SHA final ; activation effective et refus à prouver en P0. |
| Contrôles requis avant leur propre construction | T-01 construit/qualifie les contrôles documentaires et de gouvernance, active les règles puis prouve les refus ; T-02 ajoute les schémas/fixtures ; suites applicatives qualifiées avec les modules suivants. |
| Qualification hébergée requise avant construction de la tranche hébergée | Jalons distincts de livrable local et de recette Sites/Cloudflare ; dépendances précises dans TODO. Aucune exigence globale cochée avant tous ses profils. |
| Démo Cloudflare et livraison locale dépendant l'une de l'autre | T-30 valide paquet et démo localement ; T-32 publie original et démo ; T-38 exerce le fork créé après validation de l'original. |
| T-12 demandant déjà le workflow de révision de T-23 | T-12 livre docs embarquées/lecture/contrats ; T-23 réalise PRD révisionnés, validation humaine et immutabilité d'une révision approuvée. |
| Isolation formulée comme interdiction de tout partage entre comptes | Refus hors droits, plus test positif de partage explicitement autorisé entre collaborateurs ; contexte toujours choisi/contrôlé côté serveur. |
| Recettes de connecteurs trop étroites | Réception mail/accusés/réconciliation, catégories/fichiers catalogue, abonnement Stripe, Granola complet, navigateur/relais et IA/voix inscrits explicitement ; sous-tâches nominales T-29. |
| Module budget tantôt facultatif, tantôt requis | Deux modules métier requis dans le fork de recette pour prouver la relation intermodules ; intégrations catalogue/comparateur restent optionnelles pour le parcours minimal. |
| Prérequis de transfert incomplets | Accès R2 S3 distincts lorsque requis pour le multipart, vérification des ressources/quotas et aucune copie implicite des secrets. |

## Couverture contrôlée

| Domaine | Conclusion documentaire |
|---|---|
| Personnel, entreprise, SaaS | Workspace seul possible ; opérateur distinct de l'administrateur système ; front facultatif ou headless. |
| Natif et optionnel | Douze familles natives recensées ; externaliser un moteur ne retire pas tâches, brouillons, CRM, support, pages, analytics ou validation humaine. |
| Modules et plugins | Même standard quelle que soit l'origine ; plugin conversationnel comme projection, sans second backend/base ; écrans/API utilisables sans chat. |
| UI et chat | Réemploi qualifié des onglets, état par panneau, deux thèmes dynamiques, chat standard, plugins multiples et widget historique ; clé OpenAI distincte d'OAuth GPT. |
| Données et hébergement | Un D1/R2 Sites, isolation logique ; ressources distinctes hors Sites via bindings réels, même app ; local dev/test puis production Cloudflare indépendante. |
| Automatisation | API/MCP machine natifs, événements/approbations/reprises persistés ; planification externe, aucune tâche autonome promise. |
| Documentation module | Docs version installée, PRD de travail approuvé et historique d'installation distincts ; mises à jour traçables. |
| Écosystème et updates | GitHub/paquets/catalogue, starter/démo, véritable archive installée, mises à jour ciblées conservatrices, provenance avec ou sans GitHub. |
| Registre/offres | Propriétaire GitHub/email vérifié, token à publication officielle, local hors ligne, droits premium séparés, assistance explicite/révocable. |
| Gouvernance | Consignes + skills + contrôleurs + revue + protections effectives ; aucune promesse qu'un AGENTS interdit universellement de modifier un code accessible. |

## État réel des accès et preuves

| Élément | Fait connu et portée | Action au bon jalon |
|---|---|---|
| GitHub, relu pendant cet audit | `main` à `82241ffade8fb2686d3ad646935ae5a01385dbdc`, `protected: false`, contrôles requis désactivés, collection rulesets vide. Aucun contrôle actif ajouté par cette préparation. | P0 : premiers contrôles, identités habilitées et protections réellement qualifiés. Les gabarits présents ne valent pas enforcement. |
| Revue technique — décision après GO | Le responsable conserve uniquement le compte creezio ; aucune seconde identité GitHub requise. | Revue par un autre agent, liée à la révision ; workflow réel/CI vérifiés avant squash sous creezio. Ne pas inventer une approbation GitHub. |
| Sites | Sonde publique existante : primitives D1/R2, auth/cookies/révocation et accès externes vérifiés antérieurement ; pas le CMS. | T-09 : relire accès actuels et réutiliser le Site A si adapté ; B seulement après socle validé. |
| Chat/OpenAI | Deux appels réels réussis dans la sonde ; progression SSE groupée côté navigateur, consultation concurrente d'événements D1 prouvée. | T-14/T-16 : vraie conversation, annulation/reprise, permissions et widgets à qualifier. Ne pas assimiler cette sonde au chat livré. |
| Docker | CLI présent ; moteurs inaccessibles lors du relevé de faisabilité. Aucun service démarré pour cet audit. | T-31 : environnement fonctionnel et volumes à qualifier ; ce manque ne bloque pas la rédaction des contrats. |
| Cloudflare personnel | Renouvellement OAuth précédemment échoué ; accès Workers/D1/R2 non qualifiés. | T-32 : réauthentification et droits/quotas ; accès S3 R2 si requis. Pas de nouvelle clé réclamée par défaut. |
| Fournisseurs et distribution | Les accès de démonstration des autres connecteurs et les droits de publication des paquets ne sont pas tous établis. | Vérifier au lot concerné ; recette réelle non acquise sans accès. Aucune installation ni publication de tiers pendant cet audit. |
| Licence/offres | Architecture prévue, conditions finales différées par décision utilisateur ; LICENSE existant inchangé. | Vérifier les conditions avant toute première distribution du code concerné, y compris push public, starter ou démo ; ne pas décider implicitement l'accès commercial des SaaS. |

Les relevés techniques antérieurs sont datés, pas une assurance de disponibilité actuelle. Aucune clé ou valeur de secret n'est incluse dans ce dossier.

## Vérifications documentaires et sortie

Contrôles exécutés le 26 septembre 2026 : **32 fichiers Markdown, 905 liens locaux dont 647 liens avec ancre**, 79 exigences, 39 stories, 39 tâches et 107 relations de dépendance déclarées. Identifiants uniques, références résolues, graphe déclaré sans cycle ; les cycles de recette implicites trouvés en revue ont été corrigés par les jalons explicites. Les neuf skills passent leur validateur de structure ; les deux formulaires d'issue sont des YAML valides. Diff sans erreur d'espacement, LICENSE inchangé et aucune forme évidente de secret détectée. Le scan documentaire n'est pas une preuve exhaustive d'absence de secrets ni un contrôle fonctionnel.

Après corrections, les relectures ciblées ne relèvent plus de défaut bloquant dans le périmètre documentaire. Les tests de comportement, preuves fournisseur, protections et releases restent volontairement non validés tant que leur travail n'a pas été exécuté.

Le dossier permet de reprendre par une tâche identifiée sans reconstituer toute la conversation. Les prochains actes sont : validation utilisateur du plan, P0 et qualification de la gouvernance, tranche fonctionnelle précoce puis déroulement du backlog. La création du vrai fork, les deux Sites complets, les publications Cloudflare et les futures applications métier restent des jalons ultérieurs.
