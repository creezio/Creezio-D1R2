# Modules Creezio compatibles ChatGPT

Contrat de conception du 26 septembre 2026, précisé au fil des tranches réalisées. La compatibilité ChatGPT fait partie du contrat natif des modules. Les preuves réelles et leurs limites sont suivies dans [T16](IMPLEMENTATION-T16.md) et [T38](IMPLEMENTATION-T38.md) ; l'existence d'API ou d'un serveur MCP ne suffit pas à déclarer chaque widget compatible.

## Module métier et plugin conversationnel

**Module** et **extension Creezio** désignent la fonctionnalité complète : modèles et données propres, fichiers, logique métier, API, permissions, écrans, dépendances et relations avec d'autres modules. Le module fonctionne depuis ses écrans ou ses API sans nécessiter un chat.

Le **plugin conversationnel** est la partie du module destinée aux chats : outils MCP exposés, widgets, skills, manifeste et configuration de connexion. Cette partie adopte dès sa création la structure standard d'un plugin GPT, même lorsqu'elle est utilisée seulement dans le chat Creezio. Elle appelle les opérations du module et n'en duplique ni la base de données ni le backend. Le format GPT régit cette interface conversationnelle ; il ne remplace pas le contrat du module complet. La publication dans ChatGPT reste facultative.

Le module décrit ses modèles D1, fichiers R2, opérations, permissions, vues, widgets et skills. Ces déclarations alimentent ses interfaces dans Creezio et son intégration ChatGPT. La logique métier et les contrôles restent uniques côté serveur. Le développeur n'écrit pas un second backend pour ChatGPT.

Exemple : un module de comparaison de fournisseurs conserve fournisseurs, offres, critères, comparaisons et documents. Il peut utiliser un module catalogue ou achats par leurs contrats d'opérations et événements, avec dépendances et droits explicites. Sa partie plugin affiche un comparateur dans le chat et permet de déclencher une action autorisée sur ces mêmes données. Le module possède les données ; le widget les présente et transmet des intentions d'action. Une relation intermodule n'autorise pas des écritures arbitraires dans les tables d'un autre module.

Sur Sites, les données des modules occupent des tables et espaces de fichiers déclarés dans le couple D1/R2 de l'application, avec droits et contextes contrôlés. Un widget n'obtient ni accès direct aux bindings ni secrets. L'état durable reste dans Creezio ; une sélection visuelle temporaire appartient au composant. La connexion ChatGPT n'attribue pas implicitement de compte ou de droits Creezio.

Le même composant métier peut alimenter un widget Creezio et une ressource MCP Apps au moyen d'adaptateurs d'hôte. Les layouts complets du back-office restent propres à l'administration. Prévoir un hôte MCP Apps dans le chat Creezio, un adaptateur ChatGPT et un contrat de rendu réutilisable dans le front ; démontrer cette portabilité sans maintenir deux logiques métier.

## Deux MCP distincts pour une même application

Chaque application issue de Creezio possède son propre MCP d'administration et peut exposer un MCP destiné à ses utilisateurs métier, qu'ils utilisent son front ou directement le workspace Creezio. Le front est facultatif et l'accès au workspace n'accorde pas l'administration du système. Le socle fournit nativement cette séparation de pouvoirs. Deux routes dédiées, par exemple `/mcp/admin` et `/mcp/app`, sont servies par le même déploiement et les mêmes opérations autorisées ; aucun serveur supplémentaire n'est imposé.

| Surface | Destinataire | Contributions |
|---|---|---|
| MCP d'administration | Administrateur de cette application | Modules natifs Creezio : comptes, configuration, modules, données et administration ; fonctions administratives déclarées par les extensions métier. |
| MCP utilisateur, dit MCP du front | Utilisateurs de cette application, internes ou externes, avec ou sans front spécifique | Fonctions métier explicitement exposées, natives ou ajoutées : catalogue, compte, commandes, achats ou autres parcours, avec les droits de l'utilisateur. |

Les deux surfaces possèdent des catalogues d'outils, ressources, widgets et skills distincts, ainsi que leurs politiques d'accès. Une extension déclare ses contributions à l'administration, au front ou aux deux. L'installation n'expose pas automatiquement toutes ses capacités aux clients. Le serveur filtre la découverte et vérifie chaque appel, chaque lecture de ressource et chaque écriture ; modifier un paramètre de surface ou appeler directement un outil ne permet pas d'obtenir des droits supplémentaires.

« Public/front » désigne le public utilisateur de l'application. Certaines lectures peuvent être anonymes ; les comptes, commandes et actions protégées exigent l'autorisation native appropriée. Le MCP client ne révèle pas le catalogue administratif. Les portées et l'audience de l'autorisation doivent empêcher qu'un accès accordé au front soit accepté pour l'administration.

Le fork possède ses URL, sa configuration et ses identités de plugins. Prévoir deux profils de connexion/distribution distincts : administrer l'application et utiliser l'application. Chaque profil compose les seules contributions autorisées des modules installés ; leur publication dans ChatGPT reste un choix séparé. Les deux profils partagent le backend et les données de l'application, avec des droits différents. Ils ne créent ni une flotte de services ni un runtime par plugin.

## Creezio comme hôte de plusieurs plugins

Le chat Creezio charge les outils, skills et widgets de plusieurs plugins installés selon la surface et les droits de l'acteur. Le chat du workspace peut servir un administrateur ou un opérateur métier : seul le premier, avec ses permissions effectives, accède aux contributions de gestion système. Le chat du front utilise les contributions destinées à ses utilisateurs. L'hôte assure des identifiants sans collision, le routage des messages vers la bonne instance de widget et la vérification des appels. Le plugin conserve ses mêmes schémas, opérations et ressources quel que soit l'hôte.

Les styles et dispositions du front restent personnalisables. Le protocole commun des widgets et leurs données ne nécessitent pas de réécrire le plugin pour le chat de chaque application. Le module OpenAI fournit le LLM du chat Creezio ; la composition des autres plugins est indépendante de ce fournisseur.

## Contrat UI et outils

Adopter MCP Apps pour les nouveaux widgets : ressource HTML `text/html;profile=mcp-app`, URI versionnée et liaison `_meta.ui.resourceUri`. Le pont `ui/*` échange avec l'hôte ; `window.openai` fournit seulement les capacités spécifiques détectées à l'exécution. Les outils doivent rester utiles sans composant. Séparer les opérations de données du rendu lorsque cela évite de remonter inutilement une interface. [UI MCP Apps dans ChatGPT](https://developers.openai.com/plugins/build/chatgpt-ui).

Déclarer schémas d'entrée/sortie, annotations, identité stable, droits et périmètre d'exposition. Retourner des résultats structurés utilisables par le modèle et l'UI, avec pagination. Les métadonnées réservées au composant ne sont jamais un coffre à secrets. Les domaines de ressources/connexion, l'origine du composant et ses capacités d'affichage font partie du profil d'hébergement. La soumission publique avec UI exige une origine dédiée unique au plugin : qualifier cette exigence pour chaque paquet exposé, sans imposer un Worker par module. [Référence UI](https://developers.openai.com/plugins/reference).

Les bundles de widgets sont construits et versionnés avec leurs styles/assets. Le Worker expose les ressources depuis le build ou les assets autorisés ; il ne lit pas un dossier Node local à l'exécution. Fixer ensemble les versions du SDK MCP et des helpers MCP Apps compatibles. Les exemples sont des références de composition ; un serveur Node de démonstration n'est pas le runtime serverless du produit. [Exemples officiels](https://github.com/openai/openai-apps-sdk-examples).

### Lectures privées réservées au composant

`_meta.ui.visibility: ['app']` réserve l'appel d'un outil au composant ; cela ne rend pas son `content` privé. La référence OpenAI distingue `content` et `structuredContent`, accessibles au modèle, de `_meta` de résultat, réservé au composant. Une image privée destinée seulement au widget se transmet donc sous `_meta['creezio/linkedImage']`, avec un texte neutre sans octets dans `content`. Aucune clé, cookie, URL signée ou liaison D1/R2 n'entre dans le widget. [Résultats d'outils et métadonnées](https://developers.openai.com/plugins/reference).

La candidate SDK 1.5 ajoute l'opt-in `contracts.files[].linkedRead.mcpImage` : nom d'outil et widgets autorisés du même module. Il réutilise les contrôles de fichier lié (acteur, contexte, permission, parent publié, référence et empreinte) dans le chat natif et le MCP app. Les images PNG/JPEG/WebP sont bornées à 2 Mio ; l'enveloppe vérifiée dispose d'un plafond de 3 Mio, sans élargir les autres messages du relais. Les octets restent transitoires et les URL Blob sont révoquées quand le composant change. La [note T25](IMPLEMENTATION-T25.md) suit les tests et les profils réellement qualifiés ; cette déclaration ne vaut pas une recette ChatGPT.

Pour une opération commune appelée depuis plusieurs widgets sans nouveau rendu, `contracts.mcp.tools[].widgetCalls` associe la même opération à leurs actions directes. `widget` garde son rôle de rendu initial. Cette distinction évite de générer une nouvelle fiche lors de la simple lecture de ses médias ; elle ne crée ni opération métier supplémentaire ni second stockage.

## Plusieurs widgets et trois modes par action

Un module peut déclarer plusieurs types et instances de widgets : fiche produit, ajout rapide au panier, panier, critères de recherche, comparaison ou confirmation. Chaque action déclare son mode : **message proposé au chat**, **contexte pour le prochain tour** ou **traitement direct dans le widget**. Un même widget peut combiner ces modes ; aucun mode global ni second backend par widget.

Le [contrat des interactions](INTERACTIONS-WIDGETS.md) fixe leur choix, les capacités nécessaires, l'envoi volontaire, les états incertains et les replis. `ui/message`, `ui/update-model-context` et `tools/call` servent ces intentions selon les capacités de l'hôte ; les alias ChatGPT restent facultatifs. Un contexte ne lance pas une réponse ni une mutation ; une action directe n'a pas besoin d'un tour LLM ; un prompt généré n'est pas une confirmation de commande. Le chat interne Creezio doit fournir les mêmes effets et contrôles sur les mêmes opérations.

## Identité et appels

L'accès ChatGPT aux données protégées utilise OAuth délégué vers les comptes Creezio : découverte, PKCE, portées, audience, consentement, renouvellement et révocation. ChatGPT ne fournit pas une clé API personnalisée ni un grant `client_credentials` pour ce parcours. Déclarer les schémas de sécurité des outils et les erreurs de liaison attendues. Les appels d'automatisation compatibles conservent leurs tokens API ; les différents canaux utilisent les mêmes opérations autorisées. [Authentification Plugins](https://developers.openai.com/plugins/build/auth).

La clé du module OpenAI sert au LLM du chat intégré à Creezio. Elle n'est pas utilisée pour connecter un utilisateur de ChatGPT au MCP de l'application. Inversement, installer un plugin dans ChatGPT ne fournit pas une clé OpenAI au chat Creezio.

## Skills et paquet distribuable

Chaque module prévoit des workflows `skills/<nom>/SKILL.md`, avec références et ressources nécessaires. Ils expliquent comment employer les outils ; autorisations et données réelles restent au serveur. Leur qualité et leurs déclenchements font partie de la recette. L'import depuis MCP pendant Scan Tools produit une copie des skills dans le plugin, pas une lecture dynamique à chaque utilisation. [Skills](https://developers.openai.com/plugins/build/skills).

Ces skills conversationnels sont distincts du pack de développement livré aux auteurs d'applications/modules pour respecter l'architecture et exécuter les contrôles de conformité. Le [cadre produit et communauté](CADRE-PRODUIT-ET-COMMUNAUTE.md) décrit ce second pack, ses commandes de validation et le parcours de contribution.

L'import MCP des skills repose actuellement sur un sous-ensemble de l'extension draft SEP-2640, avec découverte, ressources et empreintes déclarées. La limite documentée est de cinq skills par scan : le générateur sélectionne et valide une composition explicite, sans omettre silencieusement des workflows. Épingler ce contrat versionné et revérifier ses limites avant distribution. Une modification exige un nouveau scan puis une nouvelle version, revue et publication. [Import des skills MCP](https://developers.openai.com/plugins/build/mcp-server#import-skills-from-the-mcp-server).

Le starter fournit un module complet et sa partie plugin standard. Le paquet de plugin portable contient `plugin.json` à sa racine, `mcp.json` et `skills/`, avec `extensions.com.openai` pour les réglages OpenAI ; le format `.codex-plugin/plugin.json` reste un mécanisme de compatibilité. Le paquet de module Creezio contient en plus ses modèles, opérations, relations, configuration et interfaces. Il ne faut pas confondre ces deux périmètres de distribution : installer le plugin dans ChatGPT connecte à un module déjà hébergé et ne déploie pas sa base ni son backend. La même source conversationnelle sert au chat Creezio et à ChatGPT/Codex, avec URL et surface explicites, sans seconde logique métier. Une application de démonstration consomme le module complet. Les identités de connexion attribuées par la plateforme sont propres à l'installation. [Packaging](https://developers.openai.com/plugins/build/plugins).

Un profil de publication peut sélectionner un module ou un ensemble cohérent de modules, avec noms sans collision, skills choisis et endpoint HTTPS défini. Le parcours public courant utilise un endpoint fixe ; les URL templates par client nécessitent un accord OpenAI. Un plugin publié n'accepte donc pas automatiquement l'URL de n'importe quel fork. Qualifier l'identité et les origines de chaque publication. Les outils réservés à l'administration ne sont pas exposés automatiquement. [Destinations MCP publiques](https://developers.openai.com/plugins/deploy/app-review#template-mcp-server-urls).

La publication du code Creezio, du paquet npm et du plugin ChatGPT sont des étapes distinctes. Les changements de skills nécessitent la mise à jour de leur distribution. Préserver la compatibilité d'un schéma encore connu du client pendant une évolution serveur. Vérifier les limites et procédures courantes de scan/soumission au moment de publier ; ne pas promettre qu'installer un module Creezio l'inscrit automatiquement dans l'annuaire OpenAI.

## Preuve requise

Le module de recette possède un objet D1 et une pièce jointe R2. Depuis le front Creezio puis depuis ChatGPT, le même utilisateur autorisé retrouve cet objet, affiche le widget, exécute une action et relit le résultat. Un skill guide le workflow sans inventer les données. Tester utilisateur interdit, révocation, objet modifié, double action, widget historique et fonctionnement sans UI. Vérifier le paquet produit et sa mise à jour, ainsi que le rendu réel dans ChatGPT ; un simulateur de pont ou un test MCP seul ne suffit pas. Cette recette complète celle des deux Sites A/B.

La recette distingue les deux connexions : un administrateur gère l'application par son MCP ; un utilisateur utilise une fonction métier par le MCP du front sans découvrir ni appeler les outils administratifs. Installer au moins deux plugins dans le chat Creezio, afficher leurs widgets dans la même conversation et vérifier le routage et les droits de chaque action. Une extension avec contributions admin et front doit fonctionner dans les deux catalogues sans fuite entre eux. Le même plugin doit rester installable dans Creezio sans publication dans ChatGPT.

Vérifier aussi les scénarios des exigences REQ-1604 à REQ-1607 : deux types d'un même module et plusieurs instances, aperçu/envoi du message, contexte remplacé/retiré au prochain tour sans réponse spontanée, action directe sans LLM, hôte sans capacité et timeout sans double exécution. Recette réelle dans les deux hôtes, sans assimiler un pont simulé à ChatGPT.

Vérifier aussi une relation entre deux modules : une action du widget utilise une opération autorisée de l'autre module, retrouve les mêmes données dans l'interface applicative et conserve les contrôles d'accès. Désactiver l'exposition conversationnelle ne supprime ni le module, ni ses données, ni ses API et écrans autorisés.
