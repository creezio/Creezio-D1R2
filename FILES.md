# Repères du dépôt

`scripts/modules/admit.mjs` valide l'admission des archives externes avant le plan ; `tests/modules/admit.test.mjs` couvre ses refus et la préservation de la composition. `sdk/modules/solver.mjs` conserve les droits retirés via `reconcileRetiredModules`, partagé avec l'application des profils associés. Le compilateur projette cet historique dans le catalogue d'autorisation, et `core/authorization/` refuse son utilisation ou toute nouvelle attribution. Le gestionnaire Modules affiche l'impact avant acceptation et dans le journal ; le module Access distingue les droits historiques en lecture seule.

`scripts/modules/apply.mjs` applique localement le plan de modules accepté et exporté par `plans.read`. `tests/modules/apply.test.mjs` couvre les verrous npm hors ligne, les plans périmés et l'application au checkout. Le parcours et la récupération après interruption sont décrits dans [le guide opérateur](docs/MODULES-APPLY-OPERATEUR.md) ; la publication et sa confirmation restent des étapes distinctes.

`sdk/widgets/mcp-apps-bridge.ts` raccorde les capacités MCP Apps de l'hôte interne. Le panneau natif `extensions/native/conversations/ui/widget-message.tsx` prend en charge les demandes d'ouverture de lien ; `sdk/widgets/provider.tsx` borne leur courte conservation en mémoire pendant une relecture d'accès, et `tests/widgets/host-link-continuity.test.mjs` vérifie identité, catalogue, fermeture et révocation. Le sandbox conserve ses permissions. Ce bridge et ce provider internes ne sont pas des exports du paquet public SDK ; voir [T16](docs/IMPLEMENTATION-T16.md).

Le parcours d'achat Stripe utilise les opérations du même `extensions/connectors/stripe/module/service.ts`. `ui/front.tsx` expose la vue dynamique des offres ; `ui/widgets/offers.ts`, `checkout-status.ts` et `commerce.ts` portent les interfaces conversationnelles partagées avec MCP app. Le manifeste distingue les droits administratifs et les achats app. `tests/stripe/integration.test.mjs` vérifie leur raccord D1 et les refus entre principaux ; `data/schema/stripe.sql` reste généré centralement. Voir [T27](docs/IMPLEMENTATION-T27.md) pour les preuves et limites.
`scripts/cloudflare/transfer/journal.ts` valide les checkpoints du couple principal et des captures routées, y compris leur contexte et leur clôture de route ; `tests/cloudflare/transfer-journal.test.mjs` vérifie le CAS et les refus de forme, et `tests/cloudflare/transfer-routed-source.test.mjs` couvre capture, import, vérification et reprise idempotente. Cette correction candidate T33 ne modifie ni la source applicative b9 ni les journaux distants ; voir [T33](docs/IMPLEMENTATION-T33.md).

`adapters/docker/serve.mjs` expose `--application-root <absolute path>` pour placer la source applicative vérifiée hors du code de l'opérateur ; `tests/local/docker.test.mjs` couvre refus de chemin, source altérée et verrou de dépendances différent avant les proxys, puis transmission du root exact. Le démarrage Docker sans option conserve son comportement courant.

La projection des lectures du chat est dans `core/providers/tools.ts`. `core/operations/http.ts` transmet les connecteurs compilés à `core/conversations/turn-bridge.ts`, qui reprojette les outils avant leur invocation. Les tests `tests/openai/provider-host.test.mjs` et `tests/openai/turn-bridge.test.mjs` couvrent ce chemin ; aucune nouvelle implémentation de connecteur, de moteur ou de module n'est créée pour le correctif Meili.

`app/access/operation-refusal.ts` distingue les refus des lectures facultatives du workspace/front, dont la configuration et les modèles OpenAI, des erreurs exigeant une revalidation globale. Ses appelants restent `app/workspace/host.tsx` et `app/front/host.tsx` ; `tests/workspace/operation-refusal.test.mjs` couvre les refus facultatifs, les vrais refus de session et les autres opérations. `core/providers/host.ts` rend la seule disponibilité OpenAI neutre sans droit fournisseur après contrôle de la session et du contexte ; `withTransport` reste strict. `tests/conversations/d1-integration.test.mjs` couvre lecture historique, brouillon et fichier sans OpenAI, refus du nouveau tour et révocation. Aucun contrat SDK, modèle ou manifeste de module ne change.

Relevé du 1er octobre 2026 : PR #82 est intégrée par squash sur main `7aeac0c295d5c3ce80ef211f8ae4022892e7a19e` (arbre `53325f6be2f84dc0158693a84fe4f5858ada4337`), avec 1 442/1 442 contrôles sur la CI candidate et la CI main `36793351811` ; le Worker local main est vérifié. Les paragraphes historiques ci-dessous qui la disent en brouillon décrivent son état précédent. SDK 1.8 reste non public. L'image Linux active demeure main `3d42489` ; Cloudflare Core garde son update `delivery-unknown` révision 8 et sert l'ancien Worker `cd2eeb2`. Reçu : `outputs/CREEZIO-PR82-MAIN-QUALIFIED-7AEAC0C-2026-10-01.json`.

Le reçu hors dépôt `outputs/CREEZIO-T21-LINUX-PUBLIC-RECIPE-2026-10-01.json` fixe la recette Pages T21 sur Linux main `3d42489` : publication puis révocation anonymes de la page et de son image, lectures HTTP 200 puis 404, titre et canonical de repli côté serveur. Il ne prouve pas les champs SEO éditables, Sites, Cloudflare ni un affichage navigateur 404 après révocation. Le reçu `outputs/CREEZIO-T18-T29-INBOUND-ATTACHMENTS-FREEZE-2026-10-01.json` fixe les 18 fichiers Messaging et l'intégration synthétique D1/R2 des pièces entrantes ; la candidate SDK 1.9/Resend 0.2 attend intégration et recette fournisseur. `tests/modules/messaging-delivery-integration.test.mjs` est la preuve D1/R2 locale 0/1/50 et des refus au commit ; elle ne vaut pas recette Resend réelle.

Complément vérifié au 1er octobre 2026 : les reçus Linux `outputs/CREEZIO-T18-T20-LINKS-RECIPE-2026-09-30.json` et `outputs/CREEZIO-T20-CRM-UI-RECIPE-2026-10-01.json` portent sur Core main `3d42489`, pas sur PR #82. Le premier qualifie la recherche/lecture CRM puis le lien Support conservé après rechargement, avec les messages du ticket, deux boîtes et le brouillon Messaging préservés ; aucun message réel n'a permis d'essayer le lien Support→Messaging. Le second qualifie l'édition et le retrait de la ville CRM, la relation d'entreprise intacte et la conservation du brouillon non enregistré entre onglets ; la fiche sélectionnée se réinitialise après rechargement. À ce relevé antérieur, PR #82 était en brouillon avec CI candidate en correction ; les assertions ciblées de `tests/data/composition-schema.test.mjs` (8/8) et `tests/runtime/composition-build.test.mjs` (31/31) passaient localement, tandis que `tests/mcp/workerd.test.mjs` attendait un nouveau build. Aucun gain de bundle n'était alors établi. SDK 1.8 n'est pas public ; l'état Cloudflare `delivery-unknown` et l'ancien Worker servi restent ceux décrits ci-dessous.

`scripts/build/compose-runtime.mjs` partage au build les segments strictement identiques des scripts de widgets d'un même module ; une ancre ambiguë ou absente conserve les ressources sans partage ; `tests/runtime/widget-script-sharing.test.mjs` vérifie l'égalité exacte du HTML, de l'ordre et des digests, le roundtrip UTF-8 et la conservation sans partage des tags avec attributs ou multiples. Ce correctif candidat ne prouve encore aucun gain sur le bundle Linux construit.

État vérifié : PR #81 est intégrée sur main `3d4248960f4ff56d9fdf5e956abe26d6e202f174` après CI main 1 428/1 428. L'image Linux `sha256:caff5af853c3670c43cc9d64f4955af10d7b456c79e28bf9dd2fc286864cf523` a adopté le schéma additif dans le volume conservé ; `tests/data/install-composition-physical.test.mjs` et les reçus de livraison distinguent cette adoption de la topologie T33 isolée encore non exécutée sur deux ressources réelles. La recette navigateur/API Linux a confirmé Sidebar T21 (titre, ordre, reset, reload) et rétention T22 (3 650 jours, aperçu vide, sans purge). Le [SDK 1.7.0 public](https://github.com/creezio/Creezio-D1R2/releases/download/sdk-v1.7.0/creezio-sdk-1.7.0.tgz) issu de main a SHA-256 `469287af6d3c81a9d6a71c003cc950dab2be160b0ee97fdd823ee323c501c403`, 78 537 octets/84 fichiers ; dix consommateurs Linux ont été vérifiés sur 60 suites dont 58 réussies et deux non applicables, 234 tests. Core Cloudflare est en `delivery-unknown` révision 8 : ajouts D1 attestés, ancien Worker `cd2eeb2` servi, aucune nouvelle publication confirmée. Voir [T21](docs/IMPLEMENTATION-T21.md), [T22](docs/IMPLEMENTATION-T22.md) et [T33](docs/IMPLEMENTATION-T33.md).

État antérieur : PR #80 est intégrée sur Core main `684901c46cff026dc0209f3e2deabbf894826af9` après 1 360/1 360 contrôles sur candidat et main. Le [SDK 1.6.0 public](https://github.com/creezio/Creezio-D1R2/releases/download/sdk-v1.6.0/creezio-sdk-1.6.0.tgz) vient de cette source : SHA-256 `d1d8dba645f4a710cd8c5a37f9eaabdeb15c6745c08a8bd5922d2fbcf2a53be8`, 78 067 octets, 82 entrées, huit consommateurs et 48 suites. SDK 1.7.0 est une archive candidate locale de 78 922 octets et 84 entrées (SHA-256 `3b302ad2fc09e05879e8d624d2975ee3b072d962ba6fa66c99f78293e3eae66c`), qualifiée sur dix consommateurs et 60 suites, sans publication. Le Worker Cloudflare applicatif sert toujours `cd2eeb2`. Une image Linux `684901c` a été construite sans activation : son schéma requiert des ajouts de colonnes aux tables existantes Messaging, Stripe et Support dont le correctif central d'ajout passe ses tests locaux ; l'omission d'index relevée en revue est corrigée et relue sans autre finding moteur. Le raccord de l'installation composée est qualifié localement et revu ; intégration et CI sont nécessaires avant activation, sans migration de module ni DDL forcé. Les tranches T33 installation/cutover, n8n webhook/widgets, Hermes widgets, rétention Analytics et navigation T21 restent dans le checkout de travail avec leurs qualifications propres ; voir le [backlog](docs/TODO.md).

`core/operations/intermodule.ts` borne les lectures publiques entre modules ; `core/operations/service.ts` leur conserve les credentials, le contexte et l'audience du serveur en réutilisant l'exécuteur commun. `tests/operations/intermodule.test.mjs` et `intermodule-d1.test.mjs` vérifient ses limites et la révocation réelle D1. Le contrat d'auteur reste dans `@creezio/sdk/operations/handler`.

`core/operations/diagnostics.ts` fournit au module Analytics les métadonnées du journal et des routes compilées. `extensions/native/analytics/ui/export.ts` borne les exports ; `tests/analytics/integration.test.mjs` exerce D1/HTTP/MCP.

`core/runtime/public-pages.ts` applique la visibilité anonyme des publications et des médias. La composition produit `.creezio/generated/public-pages.ts` et son renderer ESM autonome avec déclaration TypeScript depuis `entrypoints.publicPage` ; le rendu source reste dans `extensions/native/pages-navigation/ui/public-document.tsx`. Les tests `tests/runtime/public-pages.test.mjs` couvrent les lectures réelles D1/R2 et `tests/modules/pages-navigation-public.test.mjs` vérifie le rendu sous la condition RSC ainsi que le retrait des artefacts sans Pages.

`adapters/storage/resources.ts` résout les couples de bindings statiques hors Sites ; `core/runtime/environment.ts`, les configurations locales et Cloudflare refusent les mappings incomplets. PR #80 intègre au runtime le routage métier T33 vers le D1/R2 sélectionné. `tests/runtime/storage-resources.test.mjs` et `tests/local/storage-resources.test.mjs` contrôlent la configuration ; l'installation et le cutover multi-paires gardent leurs preuves distinctes.

Le connecteur `extensions/connectors/stripe/` conserve un seul moteur dans `module/service.ts` pour les six parcours clients, abonnements, factures, produits et prix actifs/inactifs. `module/projection.ts` valide leurs données, `module/storage.ts` décrit les modèles additifs et `ui/index.tsx` rassemble les onglets de Facturation. Le SQL généré est dans `data/schema/stripe.sql` ; les preuves et limites figurent dans [T27](docs/IMPLEMENTATION-T27.md).

Le pont privé d'images déclarées dans `linkedRead.mcpImage` utilise `core/files/mcp.ts` pour réemployer le service de fichiers liés depuis MCP. `core/files/admission.ts` partage les quotas HTTP/MCP existants. `sdk/widgets/private-image.ts` forme le résultat transitoire `_meta` pour l'hôte natif, et `sdk/widgets/proxy/sandbox.js` borne son transport. `extensions/common/catalog/ui/widgets/image-view.ts` gère les images visibles et leurs URL Blob. Les tests de transport, de pont et de widgets sont séparés ; la [note T25](docs/IMPLEMENTATION-T25.md) conserve leurs limites de qualification.

`sdk/widgets/proxy/profile-policy.mjs` définit les en-têtes CSP du sandbox commun, dont les images Blob ; les tests HTTP du sandbox vérifient que cette autorisation ne s'étend pas aux scripts, connexions ou cadres.

La projection du chat dans `core/providers/tools.ts` conserve les droits des opérations et borne les définitions envoyées au fournisseur. `scripts/build/provider-output-description.mjs` extrait les annotations JSON Schema de sortie pour cette projection ; `tests/openai/provider-host.test.mjs` et `tests/runtime/provider-composition.test.mjs` vérifient leurs limites et leur raccord. `tests/catalog/tool-identifiers.test.mjs` vérifie que la projection Catalogue distingue le SKU de recherche de l'identifiant interne de lecture. Les diagnostics restent dans le panneau Conversations original.

`scripts/modules/validate-archives.mjs` vérifie puis assemble les archives runtime/validation des modules du dépôt avec un paquet SDK public identifié par SHA-256. La CI exécute leurs six suites depuis cet assemblage et refuse les imports externes non déclarés, fichiers manquants ou générateurs non reproductibles. Ce contrôle ne remplace pas l'isolation nécessaire pour exécuter du code tiers non approuvé.

Les connecteurs optionnels déclarent `contracts.connectors`, validé par `sdk/contracts/schemas/v1/connectors.schema.json` et composé dans le catalogue généré des fournisseurs. `sdk/connectors/types.ts` définit le port public ; `core/connectors/host.ts` applique ses gardes et son transport. `extensions/connectors/n8n/` contient le premier module, `data/schema/n8n.sql` son SQL central, et `tests/connectors/` / `tests/n8n/` les recettes hôte et D1/HTTP/MCP. Le profil `configuration/composition.connectors.json` et la [note T26](docs/IMPLEMENTATION-T26.md) distinguent les capacités réalisées et les limites.

Le raccord Stripe utilise les options de protocole du SDK 1.4 public et la projection de lectures externes par le moteur d'opérations. `tests/connectors/command-commit.test.mjs` vérifie les preuves de configuration et de clé dans le commit D1 ; `tests/contracts/connectors.test.mjs` couvre les déclarations refusées. La [note T27](docs/IMPLEMENTATION-T27.md) distingue les produits/prix 0.2.0 et le correctif 0.2.1 livré dans Core `cd2eeb2`, de Stripe 0.3 avec Checkout, mutation d'abonnement et webhooks intégrés par PR #81 puis dans l'image Linux. Les tests D1 utilisent un fournisseur simulé ; recette fournisseur réelle et publication Cloudflare/Sites de cette tranche restent ouvertes.

`extensions/connectors/meili/` contient la connexion, les diagnostics d'index, les lots d'indexation et la recherche à partir des sources déclarées. `core/search/projection.ts` impose la relecture autorisée des données sources ; `sdk/search/` porte ce contrat public. `data/schema/meili.sql` est l'artefact de création central et `tests/meili/` qualifie D1 et le fournisseur simulé. `tests/runtime/search-composition.test.mjs` exerce la découverte, le retrait et les sources multiples. Le profil Connecteurs inclut la source Catalogue optionnelle ; la [note T28](docs/IMPLEMENTATION-T28.md) distingue cette candidate des recettes fournisseur et publications acquises.

`core/connectors/webhooks.ts`, `webhook-proof.ts`, `webhook-resolver.ts` et `webhook-http.ts` assurent signature bornée, preuve opaque et résolution des secrets déclarés. Les modules Stripe et Granola fournissent leurs mappers ; le Worker n'embarque pas de branche par fournisseur. `extensions/connectors/granola/`, `resend/` et `hermes/` possèdent chacun les mêmes documents, manifestes et six suites que les autres modules ; leurs SQL sont générés sous `data/schema/`. Les tests D1 hôte résident dans `tests/granola/` et `tests/connectors/`.

`scripts/data/runtime-models.mjs` rassemble les modèles techniques fixes des opérations et de l'autorité des stockages pour le générateur SQL central. `core/storage-authority/` porte les générations, reçus et gardes des ressources ; ses tests sont dans `tests/storage-authority/`. `scripts/local/{storage-installation,install,schema,database}.mjs` tient l'identité physique et l'installation locale ; `scripts/cloudflare/{pipeline,storage-cutover,provisioning}.mjs` orchestre capture, publication et cutover multi-paires dans le checkout courant. Les tests `tests/local/` et `tests/cloudflare/{pipeline-routed,storage-cutover,transfer-routed-source}.test.mjs` restent des preuves locales. Aucune activation T33 réelle n'en découle ; [T33](docs/IMPLEMENTATION-T33.md) conserve ses prérequis.

`core/runtime/operation-host.ts` sélectionne les services du contexte pour HTTP et MCP en réutilisant le même moteur d'opérations. Les identités restent dans le D1 principal ; données, journal, fichiers et configuration des fournisseurs suivent le couple du contexte. `tests/runtime/storage-operation-host.test.mjs` couvre cette sélection. `core/data/service.ts` fournit au seul hôte le pont de gardes de lecture intermodules ; `tests/data/host-read-guards.test.mjs` vérifie les refus et l'atomicité du règlement d'une livraison après lecture du fournisseur.

Le journal public des mutations de panneau réside dans `sdk/operations/command-journal.ts`, avec ses contrôles dans `tests/operations/command-journal.test.mjs` et `command-journal-package.test.mjs`. Il partage le client d'opérations existant ; son export et ses déclarations appartiennent au SDK 1.2, dont le [README](sdk/README.md) décrit la distribution et les limites. Aucun nouveau runtime ou stockage n'est ajouté par la préparation de release.

Le [CRM natif](extensions/native/crm/README.md) porte les modèles, opérations et vues dans `extensions/native/crm/`. Son SQL central est `data/schema/crm.sql` ; les tests D1 et HTTP/MCP résident dans `tests/crm/integration.test.mjs` et `tests/modules/crm-transports.test.mjs`. Le [suivi T20](docs/IMPLEMENTATION-T20.md) distingue interfaces originales, contrats et recettes restantes.

Le module de [messagerie native](extensions/native/messaging/README.md) est adapté dans `extensions/native/messaging/` : données et opérations dans `module/`, webmail dans `ui/`, trois cartes conversationnelles dans `ui/widgets/`, projection MCP dans `plugin/`, six suites dans `ci/` et `tests/`. `tests/widgets/runtime.test.mjs` vérifie leurs lectures explicites et leur rendu. Son intégration au moteur D1/R2 est exercée par `tests/modules/messaging-integration.test.mjs`, et son schéma est généré centralement dans `data/schema/messaging.sql`. Le [suivi T18](docs/IMPLEMENTATION-T18.md) distingue source, qualification et livraison.

Les repères historiques de livraison Core/Lab sont détaillés dans [T32](docs/IMPLEMENTATION-T32.md), [T38](docs/IMPLEMENTATION-T38.md) et le [TODO](docs/TODO.md). Ils restent attachés à leurs versions publiées et ne qualifient pas les nouveaux fichiers du checkout courant.

| Emplacement | Responsabilité |
|---|---|
| [README.md](README.md) | Présentation et parcours de lecture. |
| [AGENTS.md](AGENTS.md) | Instructions applicables et invariants. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Point d'entrée des contributions. |
| [scripts/local/schema.mjs](scripts/local/schema.mjs) | Inspection du plan central local ; le correctif central d'ajout des colonnes requises de Messaging, Stripe et Support passe ses tests locaux, avec l'index manquant corrigé et relu ; le raccord de l'installation composée est qualifié localement et revu. Le cutover T33 multi-D1 est testé localement et reste à qualifier sur deux couples réels ; l'image Linux PR #81 a adopté séparément le schéma du couple principal. |
| [LICENSE](LICENSE) | Licence du contenu déjà publié ; ne préjuge pas des conditions du futur produit. |
| [.gitignore](.gitignore) | Exclusion des secrets, données locales et sorties régénérables. |
| [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) | Contenu demandé pour les PR ; ne remplace pas une protection distante. |
| [.github/ISSUE_TEMPLATE/bug.yml](.github/ISSUE_TEMPLATE/bug.yml) | Reproduction et traçabilité des anomalies. |
| [.github/ISSUE_TEMPLATE/change.yml](.github/ISSUE_TEMPLATE/change.yml) | Besoin, critères et dépendances des évolutions/tâches. |
| [skills/README.md](skills/README.md) | Registre et routage des neuf skills de développement canoniques. |
| [docs/PRD.md](docs/PRD.md) | Vision, utilisateurs, périmètre et réussite. |
| [docs/EXIGENCES.md](docs/EXIGENCES.md) | Exigences stables et recettes attendues. |
| [docs/USER-STORIES.md](docs/USER-STORIES.md) | Parcours utilisateur/développeur reliés aux exigences. |
| [docs/TODO.md](docs/TODO.md) | Backlog canonique, dépendances, jalons et états. |
| [docs/IMPLEMENTATION-T12.md](docs/IMPLEMENTATION-T12.md) | Documents installés, lecture et limites de qualification T12. |
| [docs/PLAN-IMPLEMENTATION.md](docs/PLAN-IMPLEMENTATION.md) | Architecture détaillée et lots. |
| [docs/MATRICE-CAPACITES.md](docs/MATRICE-CAPACITES.md) | Inventaire fonctionnel et scénarios de conservation. |
| [docs/ARCHITECTURE-DEPOTS.md](docs/ARCHITECTURE-DEPOTS.md) | Socle/fork/tiers/registre, modules natifs et propriété. |
| [docs/STANDARD-MODULE.md](docs/STANDARD-MODULE.md) | Contrat uniforme, documentation et six CI par module. |
| [docs/DEVELOPMENT-STANDARD.md](docs/DEVELOPMENT-STANDARD.md) | Méthode, impact documentaire, confiance et preuves. |
| [docs/GIT-FLOW.md](docs/GIT-FLOW.md) | Branches, commits, PR, revue, fusion et releases. |
| [docs/CADRE-PRODUIT-ET-COMMUNAUTE.md](docs/CADRE-PRODUIT-ET-COMMUNAUTE.md) | Usages, communauté, registre et création. |
| [docs/EXTENSIONS-THEMES-ECOSYSTEME.md](docs/EXTENSIONS-THEMES-ECOSYSTEME.md) | SDK, paquets, thèmes, starter et updates. |
| [docs/DEPENDANCES-MODULES.md](docs/DEPENDANCES-MODULES.md) | Déclarations, graphe résolu, impacts et cycle de vie intermodules. |
| [docs/INTERACTIONS-WIDGETS.md](docs/INTERACTIONS-WIDGETS.md) | Widgets multiples et trois modes par action ; hôte interne et GPT. |
| [docs/COMPATIBILITE-CHATGPT.md](docs/COMPATIBILITE-CHATGPT.md) | MCP, widgets, plugins et skills conversationnels. |
| [docs/STOCKAGE-ET-HEBERGEMENT.md](docs/STOCKAGE-ET-HEBERGEMENT.md) | Local, Sites, Cloudflare et transfert D1/R2. |
| [docs/IMPLEMENTATION-T30.md](docs/IMPLEMENTATION-T30.md) | Paquets publics SDK/starter, démo indépendante et limites de la recette locale. |
| [docs/IMPLEMENTATION-T32.md](docs/IMPLEMENTATION-T32.md) | Première publication et premier update réels de l'original, puis publication du Lab sur Cloudflare avec provenance, conservation et limites des recettes. |
| [docs/IMPLEMENTATION-T36.md](docs/IMPLEMENTATION-T36.md) | Préparation de la release initiale de l’original : versions, usage, preuves et limites. |
| [docs/IMPLEMENTATION-T38.md](docs/IMPLEMENTATION-T38.md) | Adoptions du socle dans Lab sur Sites/Linux/Cloudflare, refus de dépendances et preuve historique TLS. |
| [docs/IMPLEMENTATION-T39.md](docs/IMPLEMENTATION-T39.md) | Checkpoints du flux OpenAI, observation Site A et limites de la recette T39. |
| [docs/IMPLEMENTATION-T40.md](docs/IMPLEMENTATION-T40.md) | Mise à jour Lab 0.1.2, restauration des widgets historiques, cycle durable des plans et qualifications réelles. |
| [docs/LICENCES-ET-OFFRES.md](docs/LICENCES-ET-OFFRES.md) | Politiques/activation/accompagnement et décisions commerciales différées. |
| [docs/QUALIFICATION-SITES.md](docs/QUALIFICATION-SITES.md) | Preuves techniques limitées, distinctes du CMS. |
| [docs/INSTALLATION-LOCALE.md](docs/INSTALLATION-LOCALE.md) | Inspection, premier compte local, configuration commune et reprises sans écrasement. |
| [docs/AUDIT-AVANT-DEVELOPPEMENT.md](docs/AUDIT-AVANT-DEVELOPPEMENT.md) | Audit croisé et conditions de démarrage/livraison. |

## MCP et OAuth natifs T-10

- [core/mcp](core/mcp/) : catalogue vérifié, transport officiel stateless, authentification native et découverte filtrée.
- [core/oauth](core/oauth/) : protocole, consentement, clients, codes, rotation et révocation D1.
- [sdk/oauth](sdk/oauth/) et [consentement Access](extensions/native/access/ui/consent.tsx) : client de transaction et carte originale adaptée ; montage [hôte](app/oauth/consent/).
- [scripts/mcp](scripts/mcp/) : compilation des contributions ; [tests/oauth](tests/oauth/) et [tests/mcp](tests/mcp/) : suites obligatoires du contrôle global.
- [Réalisation T-10](docs/IMPLEMENTATION-T10.md) : contrats, provenance et limites de qualification.

## Contrôleurs P0 en cours

- [package.json](package.json) et [.node-version](.node-version) : commandes locales et runtime des outils de développement.
- [scripts/quality](scripts/quality/) : documentation, gouvernance, empreintes et observation distante en lecture seule.
- [tests/quality](tests/quality/) : cas positifs/négatifs des contrôleurs, fixtures temporaires nettoyées.
- [Workflow P0](.github/workflows/p0-validation.yml) : tests sans secrets et agrégation ; origine réelle vérifiée par le mainteneur avant fusion.
- [sdk/contracts](sdk/contracts/) : schémas versionnés, validation déclarative et analyse des compositions/transitions ; aucune exécution de module.
- [tests/contracts](tests/contracts/) : fixtures de contrats et cas intermodules, widgets et chargement JSON borné.
- [État P0](docs/IMPLEMENTATION-P0.md), [T-02](docs/IMPLEMENTATION-T02.md) et [CHANGELOG](CHANGELOG.md) : périmètre, preuves et limites.

Tout ajout structurel met ce repère à jour. Chaque module construit fournit ensuite son propre FILES et ses instructions locales, conformément au standard commun.

## Runtime commun T-03

- [worker.ts](worker.ts) : entrée fetch unique, API Creezio puis rendu Vinext.
- [core/runtime](core/runtime/) : routage des opérations statiques, environnement, refus des appels protégés et erreurs bornées.
- [adapters](adapters/) : reconnaissance des bindings D1/R2 et profils d'hébergement ; aucun service tiers installé.
- [configuration](configuration/) : composition explicite et verrou de l'application ; pas de module témoin inclus par défaut.
- [scripts/build](scripts/build/) : génération des imports sélectionnés et contrôle de compatibilité Worker, sans installation implicite.
- [app](app/) : entrées natives `/access/admin` et `/access/app`, workspace et front facultatif composé ; sessions et projections autorisées précèdent les vues protégées.
- [vite.config.ts](vite.config.ts), [tsconfig.json](tsconfig.json), [scripts/run-framework.mjs](scripts/run-framework.mjs) : outillage figé et build commun avec génération Vite de `dist/client/licenses.md` ; un seul `dist` et un seul état local `.wrangler/state`.
- [.openai/hosting.json](.openai/hosting.json) : noms logiques DB/BUCKET, sans identité de Site ni ressource distante créée.
- [tests/runtime](tests/runtime/) : contrôles de composition, environnement, routage et workerd ; module témoin avec ses propres docs et six suites.
- [État T-03](docs/IMPLEMENTATION-T03.md) : périmètre vérifié, commandes et limites ; `.creezio`, `.quality`, `.wrangler` et `dist` restent locaux et ignorés.

## Fondations de l'identité T-04

- [sdk/access](sdk/access/) : contrat public de session navigateur, client HTTP, contrôleur et coordination, composants React réutilisables ; aucune lecture directe de cookie, table ou secret, aucun couplage au routeur hôte.

- [core/identity](core/identity/) : credentials opaques, cryptographie, stockage D1 et services natifs de comptes, droits et impersonation ; transport natif login/session/logout dans http.ts et ses règles d'origine, corps et cookies dans http-policy.ts.
- [extensions/native/access](extensions/native/access/) : vingt-deux modèles privés d'identité, de droits et d'audit, contrat, documentation et six suites ; vue native Rôles & accès déclarée et dix opérations HTTP administratives. MCP reste à raccorder.
- [sdk/access/admin-client.ts](sdk/access/admin-client.ts) et [admin-controller.ts](sdk/access/admin-controller.ts) : accès paginés au graphe, aux comptes et au journal, commandes avec clé persistée avant émission et réconciliation sans nouvel envoi.
- [sdk/ui](sdk/ui/) : primitives publiques reprises du Creezio original ; les modules n'importent pas les composants privés de l'administration.
- [core/identity/audit.ts](core/identity/audit.ts) et [audit-store.ts](core/identity/audit-store.ts) : pages du journal et détails des changements sous garde native fraîche.
- [core/authorization/delta.ts](core/authorization/delta.ts) : changements explicites du graphe sans écraser les autres contextes, audiences ou rôles.
- [tests/identity/harness/serve-access-ui.mjs](tests/identity/harness/serve-access-ui.mjs) : recette de l'écran produit sur données synthétiques en mémoire ; aucune base utilisateur ouverte.
- [scripts/data](scripts/data/) et [data/schema/access.sql](data/schema/access.sql) : génération centrale inspectable, contrôle de dérive et moteur d'installation opérateur explicite ; aucune application SQL au démarrage du Worker.
- [scripts/local](scripts/local/) : configuration et stockage locaux communs, verrou des commandes officielles, saisie terminal sans écho et parcours opérateur ; aucun accès fournisseur.
- [core/authorization](core/authorization/) : moteur pur, résolveur natif partagé, contrat de politique, lecture D1 cohérente et service de remplacement des droits protégé par session/epoch/claim ; décision pure distincte d'une écriture autorisée.
- [tests/identity](tests/identity/) : tokens, droits et qualification cryptographique ; données exclusivement synthétiques.
- [État T-04](docs/IMPLEMENTATION-T04.md) : tranches, portée des contrôles et garanties restant à raccorder.

## Fondations des données T-05

- [core/data](core/data/) : catalogue runtime, capacités par module/contexte et plans D1 sous garde fraîche ; aucune API SQL publique.
- [core/files](core/files/) : métadonnées de fichiers privés, préparation R2, publication D1 et reprise explicite.
- [core/operations](core/operations/) : registre canonique, exécutions internes, validation statique, stockage technique et transport HTTP déclaré intégré.
- [core/operations/native-access.ts](core/operations/native-access.ts) : raccordement hôte fermé des services Access existants aux mêmes transactions d'exécution ; aucun SQL ni accès privilégié ajouté aux handlers publics de modules.
- [scripts/operations](scripts/operations/) : compilation centrale des validateurs d'opérations pour le Worker.
- [data/schema/runtime.sql](data/schema/runtime.sql) et [scripts/data/prepare-runtime.mjs](scripts/data/prepare-runtime.mjs) : cinq modèles techniques des exécutions et approbations, avec contrôle central de leur SQL ; aucun changement automatique de base.
- [tests/operations](tests/operations/) : registre, schémas compilés, exécutions D1 et Worker, refus et idempotence ; famille obligatoire de l'agrégat.
- [docs/IMPLEMENTATION-T06.md](docs/IMPLEMENTATION-T06.md) : périmètre, progression et critères du registre commun.
- [core/vault](core/vault/) : références opaques et chiffrement des secrets côté serveur.
- [tests/data](tests/data/) : recettes synthétiques SQL/D1/R2/coffre et intégration indépendante aux comptes natifs.
- [État T-05](docs/IMPLEMENTATION-T05.md) : travail, contrats et limites de cette première tranche.

## Tranches T-06 et T-07 en cours

- [core/operations/http.ts](core/operations/http.ts), [sdk/operations](sdk/operations/) et [scripts/operations/http-bindings.mjs](scripts/operations/http-bindings.mjs) : transport HTTP et client d'opérations intégrés par PR #16 ; hébergements encore à qualifier.
- [core/workspace](core/workspace/) : projection de navigation sous session, contexte et droits natifs cohérents ; sa lecture ne remplace pas la garde des mutations.
- [sdk/workspace](sdk/workspace/) : panneaux, historique, navigation, conservation et restauration bornée en session ; seules les données déclarées par un schéma d'état sont restaurables, pas les brouillons React arbitraires.
- [app/workspace](app/workspace/) : routes et hôte natif par audience. [admin/workspace](admin/workspace/) adapte les composants du Creezio original (sidebar, barre d'onglets, recherche, chrome de page), distincts du SDK public. Parité produit complète encore à qualifier.
- [tests/workspace](tests/workspace/) : recettes ciblées de composition, droits, contrôleur, client et interface ; [état T-07](docs/IMPLEMENTATION-T07.md) pour leurs limites.

## Registre séparé et Docker local

- [sdk/registry](sdk/registry/) : protocole public partagé, sans serveur embarqué.
- [services/registry](services/registry/) : service central à déployer séparément, page propriétaire et lectures bornées du candidat web ; [état T-08](docs/IMPLEMENTATION-T08.md).
- [core/registry](core/registry/) : client serveur et contrôle de publication, distincts du runtime métier.
- [scripts/registry](scripts/registry/) : build indépendant, configuration sans secret et opérateur explicite du D1 dédié.
- [tests/registry](tests/registry/) et [tests/local](tests/local/) : protocoles et refus du registre, callback GitHub dans le Worker compilé, journal de reprise et adaptateur Docker ; suites obligatoires dans le contrôle global.
- [adapters/docker](adapters/docker/) : démarrage local persistant ; [état T-31](docs/IMPLEMENTATION-T31.md).

## Gestion des modules T-11

- `extensions/native/modules-settings/` : catalogue, fiches issues du Product Hub Creezio, plans et journal D1 ; six suites et docs propres.
- `sdk/modules/`, `sdk/module-settings/`, `sdk/operations/handler.ts` : solveur, inventaire vérifié au build, client/contrôleur et surface publique des handlers.
- `scripts/modules/` : archives déterministes, verrou et plan local ; aucun téléchargement ou lancement de code tiers.
- `configuration/module-inventory.json` : origines autorisées et candidats présents supplémentaires ; inventaire compilé injecté par le cœur.
- `core/operations/host-inventory.ts` : capture immuable liée à la composition et au module natif exact.
- `scripts/data/prepare-modules-settings.mjs`, `data/schema/modules-settings.sql` : création actuelle centralisée des trois modèles.
- `tests/modules/`, [IMPLEMENTATION-T11](docs/IMPLEMENTATION-T11.md) : recette du graphe, du service et des interfaces.

## Fronts et thèmes T13

- [sdk/front](sdk/front/) : types de thème/projection et client headless, codecs partagés avec [sdk/operations/protocol.ts](sdk/operations/protocol.ts).
- [core/front](core/front/) et [app/front](app/front/) : projection ACL app et raccord de rendu.
- [themes/standard](themes/standard/) et [themes/chatgpt-like](themes/chatgpt-like/) : modules de thème et six suites propres.
- [application/frontend](application/frontend/) et [application/config](application/config/) : fichiers appartenant à l’application, préservés par les mises à jour.
- [tests/front](tests/front/) : contrats de transport, données et accès du front ; [réalisation T13](docs/IMPLEMENTATION-T13.md).

## Conversations natives T14

- [extensions/native/conversations](extensions/native/conversations/) : modèles, opérations, UI originale, API/MCP et six suites du module.
- [sdk/conversations](sdk/conversations/) : contrôleur des conversations, brouillons et commandes incertaines partagé entre interfaces.
- [sdk/files](sdk/files/) : client binaire natif, publication des pièces jointes et lecture liée candidate `downloadLinked` (SDK 1.3).
- [core/files](core/files/) : catalogue compilé, intentions privées D1/R2, transport propriétaire et garde de lecture liée déclarée. `tests/data/files*.test.mjs`, `tests/contracts/files.test.mjs` et `tests/conversations/files-client.test.mjs` en vérifient les frontières hôte, contrat et navigateur.
- [scripts/data/prepare-native-module.mjs](scripts/data/prepare-native-module.mjs) : création SQL centrale des modèles natifs, sans accès à une base.
- [tests/conversations](tests/conversations/) et [réalisation T14](docs/IMPLEMENTATION-T14.md) : preuves du module, de son SDK et recettes synthétiques.

## OpenAI et publication Sites

- [extensions/native/openai](extensions/native/openai/) et [sdk/providers](sdk/providers/) : module optionnel, configuration, transport Responses et contrat public fournisseur ; [réalisation T15](docs/IMPLEMENTATION-T15.md).
- [core/providers](core/providers/) et [core/conversations](core/conversations/) : résolution du coffre, projection autorisée d'outils et étapes des tours ; la continuation d'outil remet un tour récupéré en cours sous CAS, sans ordonnanceur.
- [tests/openai](tests/openai/) : recettes D1 du fournisseur ; suites obligatoires du contrôle commun.
- [adapters/sites](adapters/sites/) et [scripts/sites](scripts/sites/) : opérateur temporaire, configuration et schéma central ; [installation Sites](docs/INSTALLATION-SITES.md).
- `scripts/sites/artifacts.mjs` et `scripts/sites/export.mjs` : inclusion du manifeste et de tout l’historique DDL central dans `dist/.openai`, export des seuls artefacts construits, reçu lié à Git et vérification des octets archivés.
- `scripts/sites/source.mjs` et `tests/local/sites-source.test.mjs` : plan durable de source Sites, staging Git du même projet sans écrasement inconnu, et vérification du commit Site distinct du constructeur.
- `configuration/composition.sites.json` et son verrou : composition Sites sans données ni identifiant personnel de Site.

## Widgets et plugins conversationnels T16

- [sdk/widgets](sdk/widgets/) : contrats catalogue/instances, provider public, pont MCP Apps, approbation native et relais statique.
- [core/widgets](core/widgets/) : snapshots autorisés, projection HTTP, ressources et grants d'approbation consommés par le moteur commun.
- [scripts/widgets](scripts/widgets/) : compilation du relais statique pour les adaptateurs locaux et hébergés.
- `scripts/local/widget-sandbox.mjs` et `widget-handshake.mjs` : démarrage et arrêt du relais local depuis le catalogue fraîchement composé ; contrôlés dans `tests/local/widget-sandbox.test.mjs` et les tests du verrou local.
- `configuration/composition.widgets-local.json`, `composition.widgets-sites.json` et leurs verrous : compositions explicites de la recette multiwidgets.
- `app/approvals/` : entrée native de décision humaine, indépendante du client MCP qui a demandé l'action.
- [extensions/widgets-witness](extensions/widgets-witness/) : module optionnel de recette avec plusieurs widgets, absent du démarrage standard.
- [tests/widgets](tests/widgets/) et [réalisation T16](docs/IMPLEMENTATION-T16.md) : contrôles des transports, droits, hôtes et périmètres à qualifier.

## Modules natifs et catalogue T19–T25

- `extensions/native/pages-navigation/ui/published-images.ts` : chargement borné des images privées pour les préfabriqués et l'aperçu ; références du snapshot publié et refus D1/R2 vérifiés dans `tests/pages-navigation/integration.test.mjs`.
- `extensions/native/support/`, `extensions/native/pages-navigation/` et `extensions/native/analytics/` : modèles, opérations, contributions workspace/front et six suites propres ; interfaces adaptées des composants Creezio originaux. Analytics ajoute deux widgets admin de lecture sous `extensions/native/analytics/ui/widgets/`, validés par la suite du module et `tests/analytics/integration.test.mjs`.
- `extensions/common/catalog/` : extension métier optionnelle, port `catalog.products`, interfaces et deux widgets. `configuration/composition.catalog.json` compose sa recette sur le thème standard.
- `data/schema/{support,pages-navigation,analytics,catalog}.sql` : artefacts du générateur central ; aucun script de transformation dans les modules.
- `tests/{support,pages-navigation,analytics,catalog}/` : intégrations D1/R2 et transports selon le module ; inclusion obligatoire dans l'agrégat qualité.
- [T19](docs/IMPLEMENTATION-T19.md), [T21](docs/IMPLEMENTATION-T21.md), [T22](docs/IMPLEMENTATION-T22.md) et [T25](docs/IMPLEMENTATION-T25.md) : périmètres réalisés et recettes encore ouvertes.

## Distribution indépendante T30

- [sdk/package.json](sdk/package.json), `sdk/public-declarations/` et [scripts/sdk](scripts/sdk/) : paquet SDK public compilé, types autonomes, exports contrôlés et licence embarquée.
- `sdk/workspace/*-impl.tsx` et `sdk/ui/assistant-provider-impl.tsx` : contextes uniques partagés par l'hôte et ses modules installés ; les anciens points d'entrée réexportent le paquet.
- [tests/runtime/sdk-package-resolution.test.mjs](tests/runtime/sdk-package-resolution.test.mjs) : résolution des imports publics dans le graphe Worker, le chargement de la configuration Vite et la barre d'outils, sans parcours des wrappers source du SDK.
- [scripts/modules/package-receipt.mjs](scripts/modules/package-receipt.mjs) : vérification du reçu détaché et des octets installés ; préflight sans effet d'un candidat externe plus récent avant son ajout explicite à l'inventaire. `module-inventory.json` relie le reçu installé à son module.
- `scripts/build/compose-runtime.mjs`, `scripts/modules/lock.mjs`, `scripts/modules/archives.mjs` et `sdk/modules/inventory.mjs` : projection des métadonnées externes vérifiées depuis `externalPackages`, adoption explicite de la validation détachée en cache par empreinte et compatibilité des verrous précédents ; aucun chargement du code candidat avant installation.
- [scripts/data/install-composition.mjs](scripts/data/install-composition.mjs) : installation locale du schéma composé complet et du premier compte natif, avec inspection et conservation des états existants.
- [tests/data/install-composition-physical.test.mjs](tests/data/install-composition-physical.test.mjs) : couverture locale du raccord physique de l'installation composée et de la conservation des données ; les refus complémentaires sont qualifiés localement ; cette preuve ne vaut pas activation Linux.
- `tests/modules/package-receipt.test.mjs`, `tests/modules/three-publishers.test.mjs`, `tests/workspace/package-context.test.mjs` et `tests/local/composed-installation.test.mjs` : preuves ciblées ; [réalisation T30](docs/IMPLEMENTATION-T30.md) pour la portée d'intégration.

## Livraison locale T32

- `scripts/cloudflare/transfer/source.ts` et `types.ts` : préflight des effets sous verrou, capture fidèle des historiques OpenAI incertains admissibles et compteur dans le manifeste ; `tests/cloudflare/transfer-source.test.mjs` qualifie conservation et refus.

- `scripts/cloudflare/{config,composition,build}.mjs` : projection de la composition et build du même code sur le profil Cloudflare ; `scripts/cloudflare/{pipeline,provisioning,sandbox,publisher}.mjs` orchestre les effets et vérifications distants. Le pipeline porte aussi la candidate d'update REQ-3203.
- `scripts/cloudflare/{local-service,operator-http,local-journal,target-vault}.mjs` : service loopback limité, session et jobs, journaux locaux et clé de coffre de production par transfert ; `scripts/cloudflare/artifact-path.mjs` isole les artefacts d'update par intention ; `scripts/cloudflare/{transfer,remote}/` contient la capture D1/R2 et les ports distants.
- `scripts/local/{serve,runtime-supervisor,source-manifest}.mjs` : cycle de vie de l'application locale, arrêt cohérent du runtime pendant le transfert et inventaire de la source Docker ; [core/delivery](core/delivery/) garde l'autorisation native fraîche.
- [admin/delivery/transport.ts](admin/delivery/transport.ts) et [app/workspace/host.tsx](app/workspace/host.tsx) : transport navigateur vers l'opérateur loopback, y compris les appels d'update, et injection dans le workspace.
- [sdk/delivery](sdk/delivery/) et [extensions/native/delivery](extensions/native/delivery/) : contrat de transport injecté, contrôleurs et modèles de vue de première publication et d'update, vue admin, manifest et suites du module optionnel. `sdk/delivery/update-controller.ts` et `sdk/delivery/update-view-model.ts` portent REQ-3203, exercée sur une première mise à jour réelle ; la distribution SDK 1.1.0 est publique.
- `admin/workspace/workspace-shell.tsx` : la navigation livraison autorisée rejoint le groupe Admin existant ; l'hôte fournit le transport local.
- [tests/cloudflare](tests/cloudflare/) et [tests/local/docker-source.test.mjs](tests/local/docker-source.test.mjs) : contrôles ciblés du pipeline, du transport, des refus et de l'identité de source embarquée ; `tests/cloudflare/update-pipeline.test.mjs` couvre la candidate d'update.
- [réalisation T32](docs/IMPLEMENTATION-T32.md) : reçus de première publication et de premier update, et qualifications encore à réaliser.
