# Exigences produit et techniques
Révision 3 — 26 septembre 2026. 89 exigences, dont les interactions des widgets et le graphe de dépendances entre modules. **Implémentation en cours ; la qualification de chaque exigence est suivie dans le backlog**, sans confondre contrôleurs locaux, produit et recettes hébergées ; une preuve de sonde ne qualifie pas le CMS. Les contraintes détaillées de la [matrice](MATRICE-CAPACITES.md) et des contrats restent applicables.
## Lecture et traçabilité
Chaque identifiant est stable ; une exigence retirée reste historisée avec décision motivée. Le responsable produit valide les changements de périmètre ; le responsable technique du lot livre et un relecteur indépendant contrôle. Les [stories](USER-STORIES.md) décrivent le besoin, le [backlog](TODO.md) ordonne le travail. Les références de tests ci-dessous sont des **identifiants de recette à implémenter**, pas des noms de tests déjà exécutés.
Pour chaque preuve future, conserver : exigence/test, résultat attendu et observé, date, acteur, commit/tree, versions et intégrité des paquets, composition/lockfile, hébergement/client, données de test et limites. Aucun secret. Les preuves hébergées sensibles restent dans un stockage d’accès contrôlé, avec résumé partageable. Une modification pertinente invalide la preuve correspondante.

## Gouvernance effective et revue indépendante

Responsable de réalisation : équipe du lot P0, revue indépendante. Profil de recette : **GitHub et local selon le profil**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-0101"></a>**REQ-0101** | **Parcours de contribution unique.** Tâche locale ou issue, branche courte issue de main à jour, commits ciblés, PR, synchronisation par merge, revue technique par un autre agent sur le SHA final puis squash. Compte GitHub unique autorisé ; bootstrap PR #1 étendue au P0 selon GIT-FLOW, sans PR empilées. Refuser push direct main, force-push, rebase d'une branche publiée et branche permanente d'agent. Sans GitHub : provenance, revue technique, contrôles et preuves locales, sans PR/protection fictive. | [US-01](USER-STORIES.md#US-01) · [T-01](TODO.md#T-01) · recette `V-0101` |
| <a id="REQ-0102"></a>**REQ-0102** | **Protections et revue monocompte.** Vérifier main/tags, PR obligatoire, contrôle Actions requis à jour, discussions résolues et squash seul ; aucun second compte ni nombre d'approbations GitHub requis. Un autre agent relit le SHA final et conserve sa preuve hors du commit source ou dans un artefact associé. Avant fusion, l'orchestrateur vérifie cette revue, l'origine réelle du workflow et les résultats ; refuser échec, preuve/revue périmée ou origine incohérente. Distinguer protections GitHub et vérifications de procédure, sans annoncer une certification automatique du workflow. | [US-01](USER-STORIES.md#US-01) · [T-01](TODO.md#T-01) · recette `V-0102` |
| <a id="REQ-0103"></a>**REQ-0103** | **Preuves et versions exactes.** Vérifier SHA/tree/composition/profil de chaque preuve ; après squash recontrôler le nouveau SHA main et l’artefact exact à publier. Refuser preuve ancienne, état ignoré/neutre, suite vide, succès factice ou publication concurrente de la même version. | [US-01](USER-STORIES.md#US-01) · [T-01](TODO.md#T-01) · recette `V-0103` |
| <a id="REQ-0104"></a>**REQ-0104** | **Guides et contrats maintenus.** Root/module AGENTS, FILES, skills canoniques, issues et PR désignent les règles, contrôles et preuves de revue technique. Vérifier routage réel des skills et dérive des adaptations. Comparer une modification de gouvernance aux contrats approuvés et la faire relire avant adoption ; ne pas réintroduire une seconde identité obligatoire ni traiter une consigne comme un blocage technique. | [US-01](USER-STORIES.md#US-01) · [T-01](TODO.md#T-01) · recette `V-0104` |

## Contrats exécutables et contrôle commun

Responsable de réalisation : équipe du lot P0, revue indépendante. Profil de recette : **local et CI, puis intégration des modules**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-0201"></a>**REQ-0201** | **Contrat complet et versionné.** Le manifeste décrit identité/origine, données, opérations, droits, API, MCP, recherche, UI, widgets, événements, docs et CI. Rejeter collisions, dépendances incompatibles, déclarations orphelines et références absentes. | [US-02](USER-STORIES.md#US-02) · [T-02](TODO.md#T-02) · recette `V-0201` |
| <a id="REQ-0202"></a>**REQ-0202** | **Six suites et contrôles indépendants.** Chaque module fournit backend, ui, api-mcp, widgets, package et docs, tests et gate. Le SDK vérifie aussi les contrats et l’intégration hôte ; une dispense est motivée et vérifiée. Refuser une suite vide, simulée ou silencieusement ignorée. | [US-02](USER-STORIES.md#US-02) · [T-02](TODO.md#T-02) · recette `V-0202` |
| <a id="REQ-0203"></a>**REQ-0203** | **Politique de confiance.** Le changement testé ne choisit pas sa propre politique d’acceptation. Qualifier une origine mainteneur approuvée, les changements de workflows/règles et l’absence de secrets dans l’exécution de code tiers. Aucun nom de statut seul ne prouve la provenance du contrôle. | [US-02](USER-STORIES.md#US-02) · [T-02](TODO.md#T-02) · recette `V-0203` |
| <a id="REQ-0204"></a>**REQ-0204** | **Graphe de dépendances vérifiable.** Déclarer identifiant/origine, version compatible, caractère obligatoire/facultatif et contrats publics requis pour toutes les origines de modules. Valider chaîne transitive, unicité de résolution, références gardées, cycles, verrous et changements de composition ; un paquet npm présent ne suffit pas. Refuser absence, mauvaise origine, version/port incompatible et verrou incohérent avant build/publication. | [US-02](USER-STORIES.md#US-02) · [T-02](TODO.md#T-02) · recette `V-0204` |

## Runtime commun et démarrage local

Responsable de réalisation : équipe du lot P1, revue indépendante. Profil de recette : **local workerd/Miniflare**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-0301"></a>**REQ-0301** | **Application serverless commune.** Worker, assets, workspace et front facultatif utilisent la même logique et les mêmes modèles. Aucun processus Node permanent, service tiers embarqué ni runtime par module/client ; importer un module incompatible doit échouer au build. | [US-03](USER-STORIES.md#US-03) · [T-03](TODO.md#T-03) · recette `V-0301` |
| <a id="REQ-0302"></a>**REQ-0302** | **Installation autonome et composition.** Le dépôt démarre avec ses sources et son lockfile sans checkout voisin ni clé fournisseur. Les modules absents sont exclus du bundle ; une dépendance manquante est diagnostiquée, pas remplacée par une réussite simulée. | [US-03](USER-STORIES.md#US-03) · [T-03](TODO.md#T-03) · recette `V-0302` |
| <a id="REQ-0303"></a>**REQ-0303** | **Limites observables.** Mesurer taille du Worker, imports, temps de démarrage/routes et budgets de requête ; figer les seuils pour les profils retenus, puis refuser leurs dépassements. Aucun chiffre de performance déclaré réussi sans mesure. | [US-03](USER-STORIES.md#US-03) · [T-03](TODO.md#T-03) · recette `V-0303` |

## Identités, comptes et droits

Responsable de réalisation : équipe du lot P2, revue indépendante. Profil de recette : **local, puis Sites/Cloudflare**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-0401"></a>**REQ-0401** | **Authentification native.** Création du premier administrateur autorisée explicitement ; comptes/invitations, connexion, expiration et révocation fonctionnent. Une identité GPT n’ouvre aucune session Creezio ; un Site public protège tout de même les données. | [US-04](USER-STORIES.md#US-04) · [T-04](TODO.md#T-04) · recette `V-0401` |
| <a id="REQ-0402"></a>**REQ-0402** | **Autorisations transverses.** Rôles, droits hérités/autorisés/interdits et impersonation auditée s’appliquent aux écrans/API/MCP/widgets. Un opérateur workspace est refusé en administration système ; revérifier droits et contexte au commit, pas seulement à la lecture. | [US-04](USER-STORIES.md#US-04) · [T-04](TODO.md#T-04) · recette `V-0402` |
| <a id="REQ-0403"></a>**REQ-0403** | **Sécurité des canaux.** Session navigateur, OAuth délégué et token machine gardent audiences/portées distinctes ; protection des mutations navigateur, limites, révocation et masquage des secrets testés. Sans cookie, un token machine valide fonctionne ; sans identité valide les données sont refusées. | [US-04](USER-STORIES.md#US-04) · [T-04](TODO.md#T-04) · recette `V-0403` |

## Données, fichiers, recherche et coffre

Responsable de réalisation : équipe du lot P2, revue indépendante. Profil de recette : **local, puis Sites/Cloudflare**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-0501"></a>**REQ-0501** | **Modèles et évolution centrale.** Définir champs persistés/calculés/snapshots, contraintes/index/relations et suppression ; initialiser une base neuve et appliquer le SQL central versionné. Refuser les écritures de champs calculés, conflits de version et évolutions incompatibles avant effet ; aucun script de transformation dans les modules. | [US-05](USER-STORIES.md#US-05) · [T-05](TODO.md#T-05) · recette `V-0501` |
| <a id="REQ-0502"></a>**REQ-0502** | **Isolation logique et fichiers privés.** Sur Sites, un seul D1/R2 partagé avec contexte serveur dans lectures, relations, recherches, compteurs, facettes, fichiers et conversations. Refuser tout accès hors droits, même avec identifiants devinés ; prouver aussi le partage explicitement autorisé entre collaborateurs d’un même contexte. | [US-05](USER-STORIES.md#US-05) · [T-05](TODO.md#T-05) · recette `V-0502` |
| <a id="REQ-0503"></a>**REQ-0503** | **Conservation, export et restauration.** Données et métadonnées R2 persistent après redémarrage/republication ; export/restauration cohérents testés sur un jeu dédié. Désactivation et échec de mise à jour ne suppriment rien ; le retour au code précédent n’est pas une restauration SQL. | [US-05](USER-STORIES.md#US-05) · [T-05](TODO.md#T-05) · recette `V-0503` |
| <a id="REQ-0504"></a>**REQ-0504** | **Coffre et recherche native.** Secrets chiffrés/référencés côté serveur, autorisation par connexion, rotation/révocation et export sélectif ; aucun secret dans UI/widgets/logs. Recherche utile sans Meili, résultats filtrés avant agrégations, et absence de repli silencieux vers une autre base. | [US-05](USER-STORIES.md#US-05) · [T-05](TODO.md#T-05) · recette `V-0504` |

## Opérations, événements et exécutions bornées

Responsable de réalisation : équipe du lot P2, revue indépendante. Profil de recette : **local, puis appel externe hébergé**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-0601"></a>**REQ-0601** | **Une opération pour tous les canaux.** Schémas d’entrée/sortie complets, acteur, contexte, autorisations et règles métier sont communs UI/API/MCP/widgets. Pagination et références autorisées pour gros résultats ; refuser JSON tronqué, arguments invalides et accès direct contournant le registre. | [US-06](USER-STORIES.md#US-06) · [T-06](TODO.md#T-06) · recette `V-0601` |
| <a id="REQ-0602"></a>**REQ-0602** | **Concurrence et effets externes.** Idempotence/claim atomique, versions d’objet, doublons, états incertains et compensations explicites ; une requête répétée n’effectue pas deux paiements/envois. Audit distingue tentative, approbation, effet confirmé et échec. | [US-06](USER-STORIES.md#US-06) · [T-06](TODO.md#T-06) · recette `V-0602` |
| <a id="REQ-0603"></a>**REQ-0603** | **Suivi sans scheduler.** États, échéances, approbations, progression et résultats persistent. Un client externe peut reprendre une opération bornée sans navigateur ; aucun cron/daemon/poller serveur ni traitement garanti après déconnexion. Une ligne en attente n’est pas annoncée comme automatiquement exécutée. | [US-06](USER-STORIES.md#US-06) · [T-06](TODO.md#T-06) · recette `V-0603` |

## Workspace et conservation des onglets

Responsable de réalisation : équipe du lot P1, revue indépendante. Profil de recette : **navigateur local, puis Sites**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-0701"></a>**REQ-0701** | **Navigation et panneaux stables.** Dashboard épinglé, ouverture/ordre/verrouillage/doublons, historique par onglet, liens directs, sous-vues, scroll/focus et brouillons fonctionnent pour deux objets du même module. Tester query seule, cible froide et transition interrompue. | [US-07](USER-STORIES.md#US-07) · [T-07](TODO.md#T-07) · recette `V-0701` |
| <a id="REQ-0702"></a>**REQ-0702** | **Réemploi qualifié et isolation du routeur.** Reprendre les composants et tests fonctionnels adaptés ; aucun interne Next/Vinext exposé au SDK. Tout pont nécessaire reste dans l’adaptateur, versionné et testé sur le build Worker, sans patch silencieux de dépendances. | [US-07](USER-STORIES.md#US-07) · [T-07](TODO.md#T-07) · recette `V-0702` |
| <a id="REQ-0703"></a>**REQ-0703** | **États et accessibilité.** Neutraliser effets/portails inactifs, traiter réponses tardives et mutation par widget sans effacer un brouillon. Restaurer les états persistables après rechargement ; purger accès/caches au changement de session. Navigation clavier et focus restent utilisables. | [US-07](USER-STORIES.md#US-07) · [T-07](TODO.md#T-07) · recette `V-0703` |

## Registre minimal et identité de publication

Responsable de réalisation : équipe du lot P1, revue indépendante. Profil de recette : **service central et app cliente**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-0801"></a>**REQ-0801** | **Enregistrement au bon moment.** Local utilisable hors ligne ; inscription proposée à l’onboarding, propriétaire vérifié GitHub ou email et token obligatoires à la publication officielle. Tester absence/invalidité du token et empêcher une nouvelle publication, sans arrêter une app existante. | [US-08](USER-STORIES.md#US-08) · [T-08](TODO.md#T-08) · recette `V-0801` |
| <a id="REQ-0802"></a>**REQ-0802** | **Provenance et minimisation.** Enregistrer projet/installation/déploiement, URL, repo éventuel, origine et versions datées. Ne pas centraliser données métier, conversations, secrets fournisseurs ou utilisateurs finaux ; token d’installation distinct des droits premium/GitHub. | [US-08](USER-STORIES.md#US-08) · [T-08](TODO.md#T-08) · recette `V-0802` |
| <a id="REQ-0803"></a>**REQ-0803** | **Bootstrap et panne.** Documenter la première mise en service du registre avec propriétaire et identité de service préconfigurés, sans dépendance circulaire à sa propre publication. Déclaration après livraison rejouable ; panne avant vérification bloque cette livraison, panne après publication conserve un compte rendu à resynchroniser. | [US-08](USER-STORIES.md#US-08) · [T-08](TODO.md#T-08) · recette `V-0803` |

## Première tranche sur Sites

Responsable de réalisation : équipe du lot P1, revue indépendante. Profil de recette : **Site public réel**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-0901"></a>**REQ-0901** | **Qualification hébergée précoce.** Déployer la tranche minimale par le parcours GPT autorisé ; compte Creezio, D1/R2, API, fichiers et onglets réels. Front public sans session GPT ; accès protégé sans identité applicative refusé. Ne pas confondre la sonde primitive avec le CMS. | [US-09](USER-STORIES.md#US-09) · [T-09](TODO.md#T-09) · recette `V-0901` |
| <a id="REQ-0902"></a>**REQ-0902** | **Capacités sans architecture alternative.** Même code d’opérations et de modules que le local ; un couple D1/R2, pas de provisionnement multiple sur Sites. Mesurer transport et limites ; n’activer que les capacités effectivement qualifiées. | [US-09](USER-STORIES.md#US-09) · [T-09](TODO.md#T-09) · recette `V-0902` |

## MCP, OAuth et accès machine

Responsable de réalisation : équipe du lot P2, revue indépendante. Profil de recette : **clients MCP réels et Site public**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-1001"></a>**REQ-1001** | **Deux catalogues MCP.** Admin et app exposent outils/ressources/skills autorisés, mêmes services et déploiement. Le MCP app sert aussi les opérateurs internes ; son catalogue ne révèle pas les outils d’administration à un utilisateur sans droits. | [US-10](USER-STORIES.md#US-10) · [T-10](TODO.md#T-10) · recette `V-1001` |
| <a id="REQ-1002"></a>**REQ-1002** | **OAuth délégué complet.** Découverte, PKCE, issuer/audience/resource, consentement Creezio, redirections, code à usage unique, renouvellement et révocation testés avec clients réels. Préinscription/CIMD et DCR selon compatibilité ; aucun client_credentials ou clé OpenAI pour connecter un utilisateur GPT. | [US-10](USER-STORIES.md#US-10) · [T-10](TODO.md#T-10) · recette `V-1002` |
| <a id="REQ-1003"></a>**REQ-1003** | **Transport et appels externes.** Requêtes Web/JSON bornées, protocole/version et compatibilité clients retenus, schémas/limites/origines validés ; aucun SSE permanent obligatoire pour tools/call. API token et MCP fonctionnent sans navigateur, sans module n8n ; tester refus, rejeu et révocation. | [US-10](USER-STORIES.md#US-10) · [T-10](TODO.md#T-10) · recette `V-1003` |

## SDK et cycle de vie des modules

Responsable de réalisation : équipe du lot P3, revue indépendante. Profil de recette : **local et app hôte**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-1101"></a>**REQ-1101** | **Modules de toutes origines.** Natif, commun, spécifique et tiers utilisent les mêmes modèles/opérations/docs/CI. Relations et dépendances passent par contrats publics ; refuser écriture dans les tables privées d’un autre module et collision d’identifiant. | [US-11](USER-STORIES.md#US-11) · [T-11](TODO.md#T-11) · recette `V-1101` |
| <a id="REQ-1102"></a>**REQ-1102** | **Cycle de vie explicite.** Distinguer paquet présent, activation, configuration, fonctionnement et désinstallation ; désactivation conserve données/historique. Origine workspace ou paquet verrouillé unique ; ajout de code implique build/publication, jamais téléchargement de JS arbitraire à chaud. | [US-11](USER-STORIES.md#US-11) · [T-11](TODO.md#T-11) · recette `V-1102` |
| <a id="REQ-1103"></a>**REQ-1103** | **Contributions complètes.** Manifestes enregistrent API/MCP, configuration/secrets, index, événements, vues/routes/navigation, onboarding et widgets sans hardcoder de routes dans l’app. Dépendances absentes/incompatibles et fonctionnalités nécessitant un fournisseur sont diagnostiquées. | [US-11](USER-STORIES.md#US-11) · [T-11](TODO.md#T-11) · recette `V-1103` |
| <a id="REQ-1104"></a>**REQ-1104** | **Résolution et plan explicite.** Résoudre toutes les dépendances depuis des origines autorisées ; produire graphe, ordre, verrous exacts et impacts. Présenter dépendances directes/transitives et inverses, contributions facultatives et configuration manquante. Aucun ajout, changement de source, coût ou mise à jour de socle silencieux ; local hors ligne avec artefacts déjà vérifiés. | [US-11](USER-STORIES.md#US-11) · [T-11](TODO.md#T-11) · recette `V-1104` |
| <a id="REQ-1105"></a>**REQ-1105** | **Protection du cycle de vie.** Installation/activation/update/désactivation/désinstallation contrôlent la composition finale et ses consommateurs. Refuser de retirer ou rendre incompatible une dépendance obligatoire d’un module actif. Une désactivation groupée exige une décision explicite, conserve données/historique et retire les contributions dans UI/API/MCP/widgets. Revalider droits et révision du graphe à l’exécution ; tester concurrence et appel direct. | [US-11](USER-STORIES.md#US-11) · [T-11](TODO.md#T-11) · recette `V-1105` |
| <a id="REQ-1106"></a>**REQ-1106** | **Intégrations facultatives et données.** Une dépendance facultative absente ou inactive retire seulement les contributions déclarées qui en dépendent ; le module autonome reste fonctionnel. Une intégration incompatible n’est pas activée. Aucune permission implicite, table privée accédée ou relation de données obligatoire rendue orpheline. Fournisseur indisponible et module absent sont des états distincts ; préserver le reste de l’app. | [US-11](USER-STORIES.md#US-11) · [T-11](TODO.md#T-11) · recette `V-1106` |

## Documentation vivante des modules

Responsable de réalisation : équipe du lot P3, revue indépendante. Profil de recette : **package, workspace et API/MCP**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-1201"></a>**REQ-1201** | **Dossier documentaire obligatoire.** README/AGENTS/FILES/prd/interview/TODO/CHANGELOG/gate sont cohérents avec données/API/UI et version. Relier critères, tâches, tests et preuves ; décisions réelles, pas gabarit vide. Nettoyer notes privées et secrets avant publication d’un paquet ou artefact. | [US-12](USER-STORIES.md#US-12) · [T-12](TODO.md#T-12) · recette `V-1201` |
| <a id="REQ-1202"></a>**REQ-1202** | **Documentation de la version installée.** PRD et changelog embarqués à la construction, consultables avec droits via UI/API/MCP, sans lecture filesystem Node ni récupération aveugle de GitHub main. Différencier changelog éditeur, historique local d’installation et PRD de travail révisionné validé humainement. | [US-12](USER-STORIES.md#US-12) · [T-12](TODO.md#T-12) · recette `V-1202` |

## Fronts, thèmes et headless

Responsable de réalisation : équipe du lot P4, revue indépendante. Profil de recette : **navigateur et Site**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-1301"></a>**REQ-1301** | **Front facultatif et libre.** App complète via workspace seul ; thème standard ou ChatGPT-like, front personnalisé ou headless indépendant. Compte natif et droits identiques ; personnalisation front ne remplace pas le chat/workspace standard. | [US-13](USER-STORIES.md#US-13) · [T-13](TODO.md#T-13) · recette `V-1301` |
| <a id="REQ-1302"></a>**REQ-1302** | **Composition dynamique.** Installer un module conforme fait apparaître ses vues/routes/navigation/slots autorisés dans les deux thèmes sans modifier le thème ou le routeur de l’app. Conserver personnalisation et données au changement de thème ; headless peut adopter ce moteur ou le remplacer. | [US-13](USER-STORIES.md#US-13) · [T-13](TODO.md#T-13) · recette `V-1302` |

## Conversations et progression persistante

Responsable de réalisation : équipe du lot P4, revue indépendante. Profil de recette : **navigateur local et Sites**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-1401"></a>**REQ-1401** | **Chat natif complet.** Chat/Work, brouillons, historique, recherche, archive/restauration, pièces jointes, liens/panneaux et sélection modèle/effort/voix selon fournisseur. Conversations séparées par droits/surface/contexte ; état explicite sans LLM configuré. | [US-14](USER-STORIES.md#US-14) · [T-14](TODO.md#T-14) · recette `V-1401` |
| <a id="REQ-1402"></a>**REQ-1402** | **Progression, reprise et annulation.** Mesurer la réception client ; si flux groupé, utiliser événements D1 avec curseur, écritures groupées et GET autorisés depuis le client actif. Tester reprise sans doublon, fin/erreur/annulation et ancienne conversation ; aucune boucle serveur ou arrêt fournisseur non confirmé annoncé. | [US-14](USER-STORIES.md#US-14) · [T-14](TODO.md#T-14) · recette `V-1402` |

## Module OpenAI et contrat fournisseur

Responsable de réalisation : équipe du lot P4, revue indépendante. Profil de recette : **OpenAI réel et chats app/workspace**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-1501"></a>**REQ-1501** | **Connexion et appel réel.** Clé côté serveur, module activé et modèle configuré ; réponse réelle dans chats autorisés. Clé absente/invalide ou fournisseur indisponible signalés ; aucune réponse inventée, clé envoyée au navigateur ou accès implicite par compte GPT. | [US-15](USER-STORIES.md#US-15) · [T-15](TODO.md#T-15) · recette `V-1501` |
| <a id="REQ-1502"></a>**REQ-1502** | **Outils contrôlés.** Schémas stricts compatibles, appels/résultats associés, limites de tours/taille/durée/concurrence, coût/usage et annulation propagée. Revalider arguments, droits et approbations au serveur ; collisions ou trop d’outils sont diagnostiqués, jamais supprimés silencieusement. | [US-15](USER-STORIES.md#US-15) · [T-15](TODO.md#T-15) · recette `V-1502` |

## Widgets et plugins conversationnels compatibles GPT

Responsable de réalisation : équipe du lot P4, revue indépendante. Profil de recette : **chat Creezio et conversation ChatGPT**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-1601"></a>**REQ-1601** | **Projection du module.** Plugin = outils/ressources/widgets/skills du module, sans second backend ni base. Module utilisable sans chat ; publication GPT facultative. Packaging portable et overlay Codex documentés, skills de développement distincts des skills conversationnels. | [US-16](USER-STORIES.md#US-16) · [T-16](TODO.md#T-16) · recette `V-1601` |
| <a id="REQ-1602"></a>**REQ-1602** | **UI standard et état sûr.** Ressource MCP Apps, métadonnées et bridge conformes ; plusieurs instances/plugins routés sans confusion. Widget sans secret/binding direct, mêmes opérations, contrôle d’objet périmé/double clic/droits retirés ; schéma widget, révision visuelle et version métier distincts. | [US-16](USER-STORIES.md#US-16) · [T-16](TODO.md#T-16) · recette `V-1602` |
| <a id="REQ-1603"></a>**REQ-1603** | **Interopérabilité réellement prouvée.** Même objet lu/modifié dans Creezio et ChatGPT via OAuth Creezio ; outil utilisable sans UI, anciens messages/repli testés. Vérifier les limites actuelles de scan/publication/skills et consigner client/version ; endpoint fonctionnel seul insuffisant. | [US-16](USER-STORIES.md#US-16) · [T-16](TODO.md#T-16) · recette `V-1603` |
| <a id="REQ-1604"></a>**REQ-1604** | **Widgets multiples par module.** Déclarer plusieurs types nommés/versionnés avec ressources, schémas, audiences et actions. Tester deux types du même module et deux instances simultanées, plus un autre module, sans confusion d'objet, de contexte, de réponse tardive ou de pouvoirs. | [US-16](USER-STORIES.md#US-16) · [T-16](TODO.md#T-16) · recette `V-1604` |
| <a id="REQ-1605"></a>**REQ-1605** | **Demande proposée au chat.** Mode message : aperçu lisible et envoi volontaire selon capacité réelle de l'hôte ; distinguer proposé/transmis/refusé/incertain. Aucune opération métier ni approbation d'achat par simple prompt généré ; un timeout ne déclenche pas un second envoi automatique via alias. | [US-16](USER-STORIES.md#US-16) · [T-16](TODO.md#T-16) · recette `V-1605` |
| <a id="REQ-1606"></a>**REQ-1606** | **Contexte du prochain tour.** Mode context : transmettre seulement les données autorisées, sans message, réponse LLM ou mutation. Vérifier prochaine demande, remplacement/retrait, obsolescence, limites et isolation instance/conversation/acteur/surface. Hôte sans capacité : contexte non transmis explicite, sans bascule vers message. | [US-16](USER-STORIES.md#US-16) · [T-16](TODO.md#T-16) · recette `V-1606` |
| <a id="REQ-1607"></a>**REQ-1607** | **Traitement direct et parité des hôtes.** Mode direct : état visuel local ou opération serveur commune sans tour LLM, résultat dans le widget. Tester lecture/mutation, confirmation requise, refus, version périmée, double clic et effet incertain. Même contrat dans Creezio et ChatGPT ; un même widget combine les trois modes déclarés sans dupliquer la logique métier. | [US-16](USER-STORIES.md#US-16) · [T-16](TODO.md#T-16) · recette `V-1607` |

## Tâches humaines et travail

Responsable de réalisation : équipe du lot P5, revue indépendante. Profil de recette : **workspace, API et MCP**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-1701"></a>**REQ-1701** | **Tâches et validations natives.** Kanban, affectation, échéance, demandes/exécutions/quotas, clarification et approbations humaines persistantes. Sans Hermes ni agent externe, créer/traiter une tâche humaine fonctionne ; une autorisation machine ne contourne pas une validation requise. | [US-17](USER-STORIES.md#US-17) · [T-17](TODO.md#T-17) · recette `V-1701` |

## Messagerie native

Responsable de réalisation : équipe du lot P5, revue indépendante. Profil de recette : **workspace et API/MCP**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-1801"></a>**REQ-1801** | **Composition et suivi.** Brouillons, destinataires, boîtes, lecture, pièces jointes privées, HTML sûr et états d’envoi/réception fonctionnent. Un même utilisateur autorisé retrouve les mêmes boîtes, brouillons et fichiers dans le workspace et le front, dans le même contexte ; les permissions restent distinctes par audience et les autres utilisateurs/contextes restent isolés. Avec transport, vérifier réception, accusés, réconciliation et reprise ; sans transport, rédaction disponible et envoi/réception explicitement indisponibles. Rejeu ne crée pas un second envoi confirmé. | [US-18](USER-STORIES.md#US-18) · [T-18](TODO.md#T-18) · recette `V-1801` |

## Support

Responsable de réalisation : équipe du lot P5, revue indépendante. Profil de recette : **workspace et API/MCP**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-1901"></a>**REQ-1901** | **Tickets utilisables.** Création, affectation, statuts, réponses et historique testés avec droits distincts. Données et suivi disponibles sans fournisseur mail ; réponse via transport rend son résultat réel et ses erreurs visibles. | [US-19](USER-STORIES.md#US-19) · [T-19](TODO.md#T-19) · recette `V-1901` |

## CRM

Responsable de réalisation : équipe du lot P5, revue indépendante. Profil de recette : **workspace et API/MCP**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-2001"></a>**REQ-2001** | **Contacts et relations.** CRUD autorisé, entreprises, prospects, recherche et liens avec autres modules via contrats publics ; conflits/suppression/relations interdites traités. Aucun accès croisé par recherche, relation ou export. | [US-20](USER-STORIES.md#US-20) · [T-20](TODO.md#T-20) · recette `V-2001` |

## Pages et navigation

Responsable de réalisation : équipe du lot P5, revue indépendante. Profil de recette : **front, workspace et API/MCP**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-2101"></a>**REQ-2101** | **Publication éditoriale.** Éditer, prévisualiser et publier les pages/médias/navigation/SEO ; rôles et validation des contenus appliqués. Changer une navigation actualise le front dynamique ; reset explicite n’efface pas silencieusement des contenus ou données métier. | [US-21](USER-STORIES.md#US-21) · [T-21](TODO.md#T-21) · recette `V-2101` |

## Analytics et diagnostics

Responsable de réalisation : équipe du lot P5, revue indépendante. Profil de recette : **workspace et API/MCP**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-2201"></a>**REQ-2201** | **Mesures natives protégées.** Productivité, usage, erreurs, journal et diagnostics disponibles selon droits, avec définitions/périodes explicites. Agrégats ne contournent pas les contextes, journaux masquent secrets et contenu sensible ; export externe distinct et optionnel. | [US-22](USER-STORIES.md#US-22) · [T-22](TODO.md#T-22) · recette `V-2201` |

## Intentions et développement piloté

Responsable de réalisation : équipe du lot P5, revue indépendante. Profil de recette : **workspace et API/MCP**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-2301"></a>**REQ-2301** | **Cycle de spécification.** Clarifications, propositions de PRD révisionnées, validation humaine explicite, tâches/CI-QA et artefacts liés. Une révision approuvée est immuable : modifier crée une nouvelle révision exigeant nouvelle validation et preuves. Une révision de travail n’écrase pas la documentation de la version installée. | [US-23](USER-STORIES.md#US-23) · [T-23](TODO.md#T-23) · recette `V-2301` |
| <a id="REQ-2302"></a>**REQ-2302** | **Exécution déléguée explicite.** Les agents/outils de développement agissent via intégration autorisée, avec suivi et recette humaine ; demander une intention ne donne pas automatiquement accès aux dépôts, secrets ou déploiements. Distinguer proposé, codé, testé, fusionné, publié et validé. | [US-23](USER-STORIES.md#US-23) · [T-23](TODO.md#T-23) · recette `V-2302` |

## Règles et automatisation sans scheduler

Responsable de réalisation : équipe du lot P5, revue indépendante. Profil de recette : **API/MCP externe et workspace**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-2401"></a>**REQ-2401** | **Règles et événements.** Déclarer règles/conditions/actions autorisées, déduplication et exécution bornée journalisée ; reprise sur appel externe explicite. Tester cycle/récursion, double événement et permission retirée ; aucune échéance présentée comme un réveil serveur autonome. | [US-24](USER-STORIES.md#US-24) · [T-24](TODO.md#T-24) · recette `V-2401` |

## Catalogue métier réutilisable

Responsable de réalisation : équipe du lot P5, revue indépendante. Profil de recette : **app fraîche et widgets**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-2501"></a>**REQ-2501** | **Module métier commun.** Produits, catégories, attributs, fichiers privés et recherche, droits, écrans/API/MCP/widgets et docs/CI installables ; autres modules référencent les produits via contrats publics. Tester CRUD, attachements et actions chat. Installation et mise à jour ne supposent pas la structure privée d’un fork. | [US-25](USER-STORIES.md#US-25) · [T-25](TODO.md#T-25) · recette `V-2501` |

## Connecteur n8n

Responsable de réalisation : équipe du lot P5, revue indépendante. Profil de recette : **n8n réel + Site public**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-2601"></a>**REQ-2601** | **Creezio vers fournisseur.** URL/clé et accès distincts des webhooks configurés ; catalogue et opérations publiées réellement testés. Aucun n8n installé/hébergé/mis à jour/sauvegardé par Creezio, aucune synchronisation globale du coffre. | [US-26](USER-STORIES.md#US-26) · [T-26](TODO.md#T-26) · recette `V-2601` |
| <a id="REQ-2602"></a>**REQ-2602** | **Fournisseur vers Creezio.** Planification réelle n8n appelle API token puis client MCP retenu sans navigateur, résultat consultable ensuite. Même droits/idempotence ; refus après révocation. Prouver aussi cet accès entrant sans module n8n installé. | [US-26](USER-STORIES.md#US-26) · [T-26](TODO.md#T-26) · recette `V-2602` |

## Connecteur Stripe

Responsable de réalisation : équipe du lot P5, revue indépendante. Profil de recette : **Stripe en mode test**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-2701"></a>**REQ-2701** | **Paiement réel de test.** Configurer sans code propre à l’app, gérer clients/produits/prix, créer une session/paiement de test et un abonnement avec évolution/arrêt prévus au PRD, recevoir et rapprocher les événements signés puis consulter via UI/API/MCP/widget. Montants/acteurs validés serveur, test/live séparés, rejeu/doublons/erreurs sans double effet. | [US-27](USER-STORIES.md#US-27) · [T-27](TODO.md#T-27) · recette `V-2701` |

## Connecteur Meili

Responsable de réalisation : équipe du lot P5, revue indépendante. Profil de recette : **Meili réel et recherche native**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-2801"></a>**REQ-2801** | **Indexation déclarative et droits.** Configurer le service externe ; champs/index/filtres du contrat produisent l’index. Tester mises à jour/suppressions, reprise et changement de génération ; droits avant résultats/facettes/compteurs. Service absent : recherche native utilisable, aucune installation du moteur. | [US-28](USER-STORIES.md#US-28) · [T-28](TODO.md#T-28) · recette `V-2801` |

## Autres connecteurs et frontières externes

Responsable de réalisation : équipe du lot P5, revue indépendante. Profil de recette : **chaque fournisseur réel autorisé**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-2901"></a>**REQ-2901** | **Connecteurs complets et isolés.** Pour chaque fournisseur, définir opérations réellement disponibles, configuration, données, droits, UI/API/MCP/widget et erreurs ; exécuter un parcours réel. Aucun installateur/maintenance de l’app tierce ; une indisponibilité ne bloque pas les données natives. | [US-29](USER-STORIES.md#US-29) · [T-29](TODO.md#T-29) · recette `V-2901` |
| <a id="REQ-2902"></a>**REQ-2902** | **Pas de faux achèvement collectif.** Créer les sous-tâches nominatives par fournisseur avec PRD et critères avant implémentation ; consigner version/API et accès manquants séparément. Un mock ou un connecteur réussi ne valide pas les autres ; aucune capacité de la matrice n’est retirée tacitement. | [US-29](USER-STORIES.md#US-29) · [T-29](TODO.md#T-29) · recette `V-2902` |

## Starter, paquets et extension externe

Responsable de réalisation : équipe du lot P3, revue indépendante. Profil de recette : **tarball dans app de validation indépendante et démo locale**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-3001"></a>**REQ-3001** | **Paquet autonome réel.** Tester archive produite, exports serveur/client/styles/assets/peers, version/origine/intégrité et liste de fichiers. Aucune dépendance à un checkout voisin ni copie du cœur embarquée ; tests tiers exécutés sans secrets de production. | [US-30](USER-STORIES.md#US-30) · [T-30](TODO.md#T-30) · recette `V-3001` |
| <a id="REQ-3002"></a>**REQ-3002** | **Artefact de validation complet.** Archive liée exactement au runtime inclut gate/six CI/tests et fermeture de leurs références aux docs/AGENTS/FILES/skills/règles/outils nécessaires. Politique tiers ne remplace pas la politique hôte ; référence absente ou intégrité différente bloque l’installation officielle. | [US-30](USER-STORIES.md#US-30) · [T-30](TODO.md#T-30) · recette `V-3002` |
| <a id="REQ-3003"></a>**REQ-3003** | **Module externe démontrable.** Comparateur avec fournisseurs/offres/comparaisons/documents propres, ports publics optionnels catalogue/achats, écrans et plugin. Démo et paquet viennent du même code ; installation ne requiert pas de lancer un Worker séparé par module ni de publier le plugin sur GPT. | [US-30](USER-STORIES.md#US-30) · [T-30](TODO.md#T-30) · recette `V-3003` |
| <a id="REQ-3004"></a>**REQ-3004** | **Dépendances interéditeurs dans le starter.** Documenter et tester required/optional, ports publics et versions. Installer une chaîne de trois modules de plusieurs origines depuis les archives réelles ; refuser dépendance absente, mauvaise origine et conflit, sans checkout voisin ni installation implicite d’un service tiers. Docs et six suites traitent leurs impacts. | [US-30](USER-STORIES.md#US-30) · [T-30](TODO.md#T-30) · recette `V-3004` |

## Docker local persistant

Responsable de réalisation : équipe du lot P1, revue indépendante. Profil de recette : **Docker local réel**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-3101"></a>**REQ-3101** | **Développement local autonome.** Initialiser compte/modèles/fichiers sans accès Cloudflare, arrêter/redémarrer/recréer le conteneur en conservant les volumes ; intégrité et restauration vérifiées. Ce profil est dev/test, pas une certification de production locale. | [US-31](USER-STORIES.md#US-31) · [T-31](TODO.md#T-31) · recette `V-3101` |

## Publication complète Cloudflare

Responsable de réalisation : équipe du lot P6, revue indépendante. Profil de recette : **compte Cloudflare autorisé réel**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-3201"></a>**REQ-3201** | **Publication de l’app entière.** Depuis le back-office local connecter le compte, vérifier droits/quotas/destination, provisionner et publier Worker/assets/D1/R2. URL de production fonctionnelle après arrêt du local ; Docker avec données distantes est une variante, pas la preuve de ce parcours. | [US-32](USER-STORIES.md#US-32) · [T-32](TODO.md#T-32) · recette `V-3201` |
| <a id="REQ-3202"></a>**REQ-3202** | **Transfert initial sûr.** Export logique cohérent D1, fichiers/métadonnées R2 paginés/multipart avec contrôle d’intégrité ; interruption/reprise sans corruption ni collisions. Sessions exclues, secrets sélectionnés explicitement et rechiffrés ; destination existante exige stratégie non destructive. | [US-32](USER-STORIES.md#US-32) · [T-32](TODO.md#T-32) · recette `V-3202` |
| <a id="REQ-3203"></a>**REQ-3203** | **Mise à jour conservatrice.** Update code/modèles compatibles sans réimporter les données locales sur la production ; erreur/conflit bloque avant effet incompatible. Retour code et restauration données distincts, reprise documentée ; exécuteur local sans accès Docker général. | [US-32](USER-STORIES.md#US-32) · [T-32](TODO.md#T-32) · recette `V-3203` |

## Stockages distincts hors Sites

Responsable de réalisation : équipe du lot P6, revue indépendante. Profil de recette : **local puis Cloudflare direct**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-3301"></a>**REQ-3301** | **Multiressource par capacités.** Même backend/opérations utilise deux D1/R2 distincts effectivement déployés ; contexte choisi serveur, binding/quotas vérifiés, révocation sans repli silencieux. Le même module fonctionne sur le D1/R2 partagé Sites, où cette capacité est indisponible, sans modèle métier alternatif. | [US-33](USER-STORIES.md#US-33) · [T-33](TODO.md#T-33) · recette `V-3301` |

## Éditions, politiques et activation

Responsable de réalisation : équipe du lot P6, revue indépendante. Profil de recette : **service central et app**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-3401"></a>**REQ-3401** | **Droits techniques configurables.** Token registre, droits premium, capacité d’hébergement et autorisation utilisateur restent distincts. Les fonctions commerciales de test s’activent par preuve signée ; client/UI seul ne débloque pas API/MCP. Paiement/activation testés avec le fournisseur prévu. | [US-34](USER-STORIES.md#US-34) · [T-34](TODO.md#T-34) · recette `V-3401` |
| <a id="REQ-3402"></a>**REQ-3402** | **Panne, expiration et décisions différées.** Définir durée/renouvellement et refus contrôlés, préserver données/export à expiration, pas d’appel central bloquant chaque opération. Licence finale/tarifs/fonctions premium/accès SaaS restent à décider avant distribution concernée ; aucun droit MIT futur ou retrait natif déduit du prototype. | [US-34](USER-STORIES.md#US-34) · [T-34](TODO.md#T-34) · recette `V-3402` |

## Accompagnement avec accès consenti

Responsable de réalisation : équipe du lot P6, revue indépendante. Profil de recette : **dépôt de test consenti**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-3501"></a>**REQ-3501** | **Assistance sans accès implicite.** Le propriétaire sélectionne dépôt/périmètre/durée ; lecture du code ne donne ni secrets/données métier ni droit de déployer. Tester révocation effective, séparation des actions et journal ; aucune assistance activée du seul fait de l’inscription ou du paiement. | [US-35](USER-STORIES.md#US-35) · [T-35](TODO.md#T-35) · recette `V-3501` |

## Release de l’original

Responsable de réalisation : équipe du lot P7, revue indépendante. Profil de recette : **CI, Site A et artefacts publiés**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-3601"></a>**REQ-3601** | **Release et politique de distribution.** PR de préparation des versions/changelogs/lockfiles, revue/squash, revalidation SHA main et archive exacte, tag immuable par composant puis publication autorisée. Conditions de distribution et droits de reprise/contribution examinés ; aucune licence commerciale finale inventée par l’agent. | [US-36](USER-STORIES.md#US-36) · [T-36](TODO.md#T-36) · recette `V-3601` |
| <a id="REQ-3602"></a>**REQ-3602** | **Original prêt à démarrer.** Recette du socle et inventaire des capacités complets ; installation à neuf reproductible. Toute intégration non vérifiée reste explicitement bloquée, sans être annoncée prête ; un périmètre réduit exige décision utilisateur, pas une case cochée à tort. | [US-36](USER-STORIES.md#US-36) · [T-36](TODO.md#T-36) · recette `V-3602` |

## Vrai fork Creezio Lab et Site B

Responsable de réalisation : équipe du lot P7, revue indépendante. Profil de recette : **GitHub et deux Sites publics**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-3701"></a>**REQ-3701** | **Création et provenance.** Vrai fork public et parent vérifiés ; B a ses propres identités/secrets/D1/R2 et registre. Parcours sans GitHub crée une app avec provenance, puis rattachement possible ; app privée utilise dépôt indépendant sans fausse filiation. | [US-37](USER-STORIES.md#US-37) · [T-37](TODO.md#T-37) · recette `V-3701` |
| <a id="REQ-3702"></a>**REQ-3702** | **Personnalisation et modules métier.** Sur B créer demandes d’achat et validation budget via ports publics, front ChatGPT-like personnalisé, APIs/MCP/widgets autorisés. Workspace Creezio standard conservé, opérateur et administrateur distincts ; mêmes IDs d’objets sur A/B sans fuite. | [US-37](USER-STORIES.md#US-37) · [T-37](TODO.md#T-37) · recette `V-3702` |

## Adoption des mises à jour et contributions

Responsable de réalisation : équipe du lot P8, revue indépendante. Profil de recette : **A/B, Cloudflare, tarballs et GitHub**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-3801"></a>**REQ-3801** | **Updates ciblées sur Sites.** Sur demande GPT, mettre à jour socle puis un module et ses seules dépendances nécessaires, republier le même Site et vérifier. Conserver front/extensions propres/données/fichiers/autres versions ; back-office Sites n’essaie pas de se republier. | [US-38](USER-STORIES.md#US-38) · [T-38](TODO.md#T-38) · recette `V-3801` |
| <a id="REQ-3802"></a>**REQ-3802** | **Contributions et écosystème.** Une correction autorisée remonte par issue/PR revue puis release ; les dérivés adoptent explicitement après tests. Installer puis actualiser le véritable paquet externe dans B et tester sa démo ; fusion, release et déploiement restent des états distincts. | [US-38](USER-STORIES.md#US-38) · [T-38](TODO.md#T-38) · recette `V-3802` |
| <a id="REQ-3803"></a>**REQ-3803** | **Mises à jour tenant compte des consommateurs.** Sur le fork, qualifier update compatible, update de fournisseur cassant un consommateur, retrait/désactivation refusés et proposition de résolution explicite. Conserver versions hors périmètre, données et personnalisations ; après publication vérifier opérations/UI/MCP/widgets et intégrations facultatives, puis reprise d’un plan devenu périmé. | [US-38](USER-STORIES.md#US-38) · [T-38](TODO.md#T-38) · recette `V-3803` |

## Recette finale et validation utilisateur

Responsable de réalisation : équipe du lot P9, revue indépendante. Profil de recette : **deux Sites, Cloudflare et clients GPT/MCP**.

| ID | Exigence et critères positifs/négatifs | Traçabilité et recette |
|---|---|---|
| <a id="REQ-3901"></a>**REQ-3901** | **Validation complète.** Exécuter tous les critères de la matrice/exigences, deux Sites et parcours local→Cloudflare ; relier chaque preuve à sa version et son profil. Capture seule, santé HTTP, mock ou CI verte insuffisants ; aucun fork métier suivant avant validation utilisateur. | [US-39](USER-STORIES.md#US-39) · [T-39](TODO.md#T-39) · recette `V-3901` |
