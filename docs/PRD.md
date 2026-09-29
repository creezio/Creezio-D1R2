# Creezio — PRD produit

Version de cadrage : 3, 27 septembre 2026. **GO reçu, implémentation en cours ; aucun CMS complet livré à ce stade.** Le backlog distingue preuves locales et qualification du produit ; le GO ne vaut pas recette.

## Produit et résultat recherché

Creezio est un socle d'applications nativement serverless, comparable à un CMS extensible : il fournit un backend, un workspace standard avec onglets et chat, des comptes et droits, des données et fichiers, et des modules fonctionnels prêts à utiliser. Il permet de créer une application personnelle, un outil d'entreprise ou un SaaS. Le workspace peut être l'interface unique ; un front facultatif utilise les thèmes dynamiques fournis ou une réalisation headless. Tous les modules, natifs, métiers partagés, spécifiques et externes, suivent le même contrat de données, opérations, API, MCP, UI, documentation et tests. Leur partie plugin conversationnel rend ces fonctions utilisables dans le chat Creezio et, si l'éditeur le souhaite, dans ChatGPT. Chaque app possède ses propres données, accès et déploiement, tout en pouvant adopter les évolutions du socle et de ses modules sans perdre ses personnalisations.

Un module peut fournir plusieurs widgets. Leurs actions distinguent demande proposée au chat, contexte conservé pour le prochain tour et traitement direct sans tour LLM ; un même widget peut combiner ces modes. Le [contrat des interactions](INTERACTIONS-WIDGETS.md) s'applique à ChatGPT et au chat Creezio, avec mêmes données/droits et sans validation d'achat implicite.

Le développeur doit commencer par son métier, sans reconstruire les comptes, le workspace, les API, les outils MCP, les widgets ou les mécanismes de mise à jour. L'administrateur configure des fonctionnalités complètes ; installer un connecteur n8n ou Stripe puis renseigner ses accès doit suffire pour utiliser les opérations annoncées.

La référence fonctionnelle et visuelle de l'administration est le Creezio original : ses modules, écrans, composants et interactions sont conservés et adaptés à l'architecture cible. Réutiliser leur code lorsqu'il convient ; une incompatibilité technique peut imposer un remplacement interne, mais ne justifie ni un nouvel écran ni une simplification du produit. Creezio Lite n'est pas la base de cette interface. Cette précision d'exécution ne réduit aucune exigence ci-dessous.

## Utilisateurs et parcours

| Acteur | Besoin | Résultat attendu |
|---|---|---|
| Créateur d'application personnelle | Utiliser ses données et automatiser son travail sans construire un front | Workspace complet, modules natifs, accès machine limités, front désactivable. |
| Responsable d'équipe | Donner aux collaborateurs leurs outils sans leur donner l'administration système | Comptes et rôles ; mêmes règles dans le workspace, l'API, le chat et MCP. |
| Éditeur de SaaS | Proposer son expérience et gérer ses utilisateurs | Front à thème ou headless ; contexte et permissions serveur ; administration Creezio conservée. Les conditions commerciales futures restent ouvertes. |
| Utilisateur d'une application | Agir dans l'interface ou depuis ChatGPT | Compte applicatif natif, données autorisées, outils et widgets métier ; aucun droit administrateur implicite. |
| Développeur humain ou IA | Ajouter ou maintenir un module sans réinventer les conventions | Starter, SDK, AGENTS, skills, documentation module et contrôles bloquants communs. |
| Éditeur de module tiers | Distribuer une fonction réutilisable | Paquet versionné, plugin conversationnel et démo issus du même code ; tests autonomes et compatibilité vérifiable. |
| Mainteneur Creezio | Faire évoluer le produit, suivre les installations officielles et accompagner | Registre séparé, versions datées, contributions revues, releases puis adoption testée ; accès d'assistance uniquement consenti. |

L'accès au workspace n'est pas un rôle administrateur. Une même personne peut cumuler plusieurs rôles, mais chaque opération vérifie ses droits actuels. Le choix d'un front ne change pas ce modèle.

## Ordre de livraison

Le premier jalon est **une app réellement utilisable**, sans attendre toutes les familles de modules. Il achève les conversations natives (T-14), l'appel OpenAI réel (T-15) et les outils/widgets (T-16), puis installe depuis un vrai paquet le starter et **un seul module métier témoin** (T-30). La publication requise comprend le registre T-08, deux Sites publics via T-09/T-36/T-37, le parcours Docker local T-31 et la publication complète Cloudflare T-32. La version initiale de l'original et du vrai fork est suivie d'une preuve d'installation/mise à jour T-38 et d'une recette ciblée T-39. Le parcours Sites et le parcours Cloudflare qualifient le même code indépendamment : l'ancien Site devenu inaccessible après changement de compte GPT peut être remplacé par un nouveau Site public du compte courant, avec son nouveau `project_id` et l'historique précédent préservé.

Les modules natifs et connecteurs T-17 à T-29, le catalogue complet T-25, les ressources distinctes T-33, les offres T-34 et l'assistance T-35 suivent ce premier jalon. Les exigences ci-dessous et dans [EXIGENCES.md](EXIGENCES.md) gardent leur portée ; la première version ne vaut ni clôture globale de T-36 ni recette exhaustive T-39. Chaque tranche annonce seulement les profils et critères effectivement prouvés.

## Périmètre fonctionnel à livrer

Les exigences numérotées figurent dans [EXIGENCES.md](EXIGENCES.md). Les détails fonctionnels restent dans la [matrice de capacités](MATRICE-CAPACITES.md), sans réduction implicite de son périmètre.

- Socle technique : identité et OAuth, opérations, autorisations, contexte de données, D1/R2, coffre, audit, événements, recherche de base, composition et validation des modules.
- Workspace standard : onglets et panneaux conservant leur état, navigation, tableaux/listes/formulaires, chat et widgets, administration et diagnostics.
- La tranche de lecture Analytics conserve ses six vues originales et expose deux cartes admin d'événements déclarés ; instrumentation et mesures automatiques demeurent des exigences distinctes ([T-22](TODO.md#T-22)).
- Douze familles de modules natifs décrites dans l'[architecture des dépôts](ARCHITECTURE-DEPOTS.md), notamment tâches humaines, messagerie et brouillons, support, CRM, pages/navigation, analytics et développement piloté par spécifications.
- Front facultatif, thèmes standard et ChatGPT-like, contributions dynamiques des modules, composants et client headless.
- API et MCP administrateur/utilisateur séparés par catalogue et permissions, sur le même backend ; appels externes sans navigateur et sans module n8n obligatoire.
- Modules communs et connecteurs configurables, paquet communautaire, mises à jour indépendantes et starter de développeur.
- Développement local persistant, publication complète sur Cloudflare, installation et mises à jour dans GPT Sites, registre d'installation et architecture Community/Enterprise.

Une fonction native reste disponible sans moteur externe. Une capacité nécessitant un fournisseur non configuré affiche précisément ce manque ; elle ne renvoie pas une réussite simulée. La configuration d'un fournisseur n'implique pas que Creezio héberge son logiciel.

## Principes d'architecture non négociables

| Sujet | Décision |
|---|---|
| Runtime | Une application et un déploiement communs ; aucun serveur par client ou module. Pas de dépendance à un processus Node permanent dans le socle. |
| Hébergements | Même logique métier, schémas et contrats sur Sites, local et Cloudflare ; les adaptateurs exposent des capacités, sans fork métier selon l'hébergement. |
| Sites | Sites publics, authentification Creezio native ; un couple D1/R2 par app, cloisonnement logique serveur. Les deux Sites de recette ont des ressources distinctes. |
| Local et Cloudflare | Docker/Miniflare sert au développement et aux tests hors ligne. Publier transfère toute l'app, les données et fichiers vers le compte Cloudflare choisi ; la production fonctionne après arrêt du local. |
| Ressources multiples | Hors Sites uniquement, derrière les bindings effectivement provisionnés et déployés d'une application commune, avec limites vérifiées. Un identifiant de base ne crée pas un binding. |
| Module / plugin | Le module possède données et logique ; son plugin conversationnel projette ses outils, widgets et skills, sans dupliquer backend ni base. |
| Planification | Un service externe appelle les opérations bornées autorisées. Creezio conserve échéances, états, approbations et résultats ; aucun scheduler natif ni promesse de réveil autonome. |
| Mises à jour | Sur Sites, demande puis exécution/vérification dans GPT. Depuis le local Docker, exécuteur de livraison limité. Aucune publication Sites lancée depuis son back-office. |
| Données | Modèles actuels et SQL central généré de création/évolution ; conservation et compatibilité contrôlées. Aucun dispositif de conversion d'un autre produit dans le dépôt. |
| Registre | Local hors ligne ; propriétaire vérifié GitHub ou email et token requis à la publication officielle. Aucune donnée métier centralisée. |
| Offres | Architecture de politiques et droits signés prévue ; licence définitive, tarifs, fonctions premium et éligibilité des SaaS différés. LICENSE du contenu déjà publié inchangé. |

## Ce qui ne fait pas partie de cette construction

Recréer les applications métier existantes avant validation du socle et du fork ; fournir un orchestrateur de flotte applicative ; installer, héberger ou maintenir n8n/Hermes/Meili ; lancer un serveur par plugin ; exécuter du JavaScript tiers téléchargé à chaud ; obtenir des droits applicatifs depuis une connexion GPT ; synchroniser automatiquement tous les secrets vers un fournisseur ; garantir le suivi de toute copie modifiée du code accessible ; prétendre empêcher toute modification locale par de simples consignes AGENTS.

## Mesure de réussite et recette

La première app est jugée sur les parcours ciblés ci-dessus : conversation avec fournisseur réel, outil/widget et permissions, module témoin issu d'un paquet, original et vrai fork publics, mise à jour conservant données/personnalisation et publication Cloudflare vérifiée. La réussite **exhaustive** du produit exige ensuite tous les parcours ci-dessous, pas seulement un nombre de fichiers, un build ou une CI verte :

1. Une app fraîche fonctionne avec ses modules natifs, son workspace, ses comptes et ses données, sans service optionnel configuré.
2. Une nouvelle vue de module apparaît dans les deux thèmes officiels sans modification du routeur de l'app ; la même opération respecte les mêmes permissions depuis UI/API/MCP/widgets.
3. Les onglets conservent brouillons, localisation, historique, scroll et interactions ; révocation et changement d'identité purgent les accès devenus interdits.
4. Un outil et un widget réels fonctionnent dans Creezio puis ChatGPT avec authentification native déléguée ; plusieurs plugins coexistent dans le chat sans confondre leurs instances ou pouvoirs.
5. L'original A et le vrai fork B démarrent sur deux Sites publics. B ajoute ses modules et son front ; une mise à jour du socle puis d'un module conserve personnalisation, données et fichiers.
6. Une extension externe est installée depuis son véritable paquet, pas depuis le checkout voisin ; sa démo Cloudflare et son installation utilisent la même version vérifiée.
7. Le parcours local → Cloudflare transfère app/D1/R2, reprend une interruption et préserve les données de production lors d'une mise à jour ultérieure.
8. Des changements invalides sont refusés par les contrôles et le parcours GitHub officiel ; une release publie l'artefact du SHA effectivement fusionné, avec provenance et preuves.

Les seuils de bundle, temps de réponse, concurrence et volume sont mesurés sur les profils retenus puis figés dans la première tranche de qualification. Aucun objectif chiffré de performance n'est déclaré atteint sans mesure. L'accessibilité clavier/focus, les erreurs utilisables, les limites des opérations et l'absence de secret côté client font partie des critères transverses.

## Pilotage du développement

La chaîne normative est : **PRD → exigence → user story → tâche → tests et preuves → version livrée**. Les tâches sont dans [TODO.md](TODO.md), les parcours dans [USER-STORIES.md](USER-STORIES.md), la méthode dans [DEVELOPMENT-STANDARD.md](DEVELOPMENT-STANDARD.md) et [GIT-FLOW.md](GIT-FLOW.md). Chaque module reproduit cette discipline selon [STANDARD-MODULE.md](STANDARD-MODULE.md).

Une décision modifie les documents concernés et les liens de traçabilité, sans multiplier des listes de travail concurrentes. Une story regroupe un besoin ; une tâche décrit un travail livrable ; les tests prouvent les critères des exigences. Une case cochée signifie que ses preuves existent pour la version et le profil concernés. Les dépendances externes ne doivent pas disparaître derrière une case « terminé ».

Le [rapport avant développement](AUDIT-AVANT-DEVELOPPEMENT.md) expose les corrections, les preuves existantes, les limites et les prérequis restants. Le GO utilisateur est acquis. La recette ciblée de l'original et du vrai fork précède les autres applications métier ; la recette exhaustive suit les modules et profils différés.

## Composition fiable des fonctionnalités

L’administrateur voit de quels modules dépend chaque fonctionnalité et quels modules l’utilisent, quelle que soit leur origine. Installer un panier exige un catalogue compatible et actif ; une intégration facultative peut être retirée en conservant le reste du module autonome. Le système calcule les dépendances transitives, fixe les versions et bloque les mises à jour, désactivations ou retraits qui casseraient un consommateur. La proposition de changements est explicite et protège les données. Le [contrat des dépendances](DEPENDANCES-MODULES.md) précise manifeste, droits, interface, SDK, starter, tests et parcours de livraison ; ce n’est pas une simple liste npm.
