# Contrats JSON Creezio v1

Ces schémas définissent la représentation portable des modules et de leur composition pour [T-02](../../../../docs/TODO.md#T-02). Ils complètent le [standard des modules](../../../../docs/STANDARD-MODULE.md), les [interactions des widgets](../../../../docs/INTERACTIONS-WIDGETS.md) et le [standard de développement](../../../../docs/DEVELOPMENT-STANDARD.md). Les fonctions du produit et leurs recettes restent suivies séparément : accepter un document ne prouve ni l'exécution du module ni son fonctionnement dans ChatGPT.

## Format et autorité

Le dialecte est JSON Schema 2020-12. Les `$id` sont des URN `urn:creezio:contracts:v1:<nom>` ; le contrôleur enregistre ces schémas locaux approuvés et ne les télécharge pas. Les trois points d'entrée sont `module.schema.json`, `composition.schema.json` et `composition-lock.schema.json`. Leur champ `schemaVersion` vaut `1.0.0`.

Tous les objets métier sont fermés : un champ inconnu est refusé, sans suppression silencieuse ni coercition. Les seules frontières de données extensibles sont les valeurs JSON déclarées et les documents JSON Schema embarqués. Ces derniers doivent également passer la métaschema 2020-12 et la compilation stricte, avec limites de taille, profondeur et coût. Leur simple présence dans `contracts.schemas` ne les valide pas. Le contrôleur v1 n'autorise pas de résolution distante ; il diagnostique explicitement les constructions récursives qu'il ne qualifie pas. Cette limite de schéma ne prohibe pas les relations de modèles autoréférencées ou les relations métier cycliques valides.

Un validateur de forme ne résout pas les références et ne remplace pas les contrôles sémantiques. Les politiques, profils d'hébergement, capacités effectivement disponibles et règles de dispense viennent du consommateur approuvé. Les déclarations du candidat ne peuvent pas modifier cette autorité. Aucun script, point d'entrée, skill ou handler du module n'est exécuté pour analyser son descripteur.

Le descripteur est la sortie portable des déclarations SDK. Les fichiers `models.ts`, `operations.ts`, etc. peuvent fournir ces déclarations et leurs handlers ; le générateur devra vérifier leur concordance lors des lots SDK. Ne pas entretenir deux définitions indépendantes et contradictoires. Les fixtures JSON actuelles qualifient ce format, pas ce générateur futur.

## Schémas et références

| Schéma | Responsabilité |
|---|---|
| `common` | Identifiants, versions/plages, références, chemins, provenance, intégrités et valeurs JSON. |
| `module` | Identité, compatibilités, points d'entrée, dépendances, contrats, docs, validation, paquet et cycle de vie. |
| `models` / `files` | Données actuelles, clés/index/relations/contextes ; catégories de fichiers, métadonnées et accès. |
| `permissions` / `operations` | Acteurs, portées, audiences et refus ; opérations communes, schémas, effets, concurrence, approbations, audit et exécution bornée. |
| `api` / `mcp` | Projections HTTP et conversationnelles des opérations : outils, ressources, prompts et skills. |
| `events` / `settings` / `search` | Événements durables et appels externes ; configuration typée et références de secrets ; projections et reprise de recherche. |
| `ui` / `widgets` | Contributions workspace/front ; collection de widgets et modes d'action. |
| `documentation` / `validation` / `packaging` | Documents de version, six suites, politique et séparation des artefacts runtime/validation. |
| `composition` / `composition-lock` | Sélection demandée, profils/capacités, exposition ; versions, origines et intégrités réellement résolues. |
| `artifact-receipt` | Reçu détaché liant l'identité/source du module, son descripteur, son runtime et son artefact de validation. |

Une référence métier a la forme `{ "moduleId": "creezio.tasks", "kind": "operation", "id": "get" }`. Le type attendu dépend aussi de son emplacement : un `metadataModel` doit désigner un modèle et une action serveur une opération. Une référence ne permet ni de lire une table privée d'un autre module ni de contourner ses permissions. Le contrôleur vérifie l'existence, le type, la visibilité publique, l'origine sélectionnée et la compatibilité du contrat public déclaré dans la dépendance.

Une référence de schéma a la forme `{ "schemaId": "get-input" }` et désigne une entrée locale `contracts.schemas[]`. Les liaisons API/MCP utilisent les mêmes schémas que leurs opérations. Un chemin est relatif à son artefact, au format POSIX ; une référence de code ajoute un nom d'export. Le contrôle filesystem doit vérifier confinement, existence et absence de liens/jonctions, en plus du contrôle syntaxique.

## Dépendances et transitions

Toutes les origines utilisent le même contrat de dépendance : module natif, commun, applicatif ou tiers. `optional: false` signifie obligatoire ; `optional: true` permet l'absence uniquement avec `whenAbsent: "disable-contributions"`. Une dépendance obligatoire utilise `whenAbsent: "block"`. `autoInstall: false` interdit à un paquet d'imposer une installation non sélectionnée par le consommateur.

Chaque sélection de module dans la composition contient `integrations: [{moduleId, enabled}]`, avec une entrée explicite par dépendance facultative et aucune dépendance obligatoire. La présence d'un fournisseur n'active pas l'intégration. Une dépendance obligatoire ou une intégration facultative sélectionnée avec un fournisseur incompatible bloque ; une intégration non sélectionnée n'impose pas ses versions ou ports au fournisseur utilisé par ailleurs. Une intégration sélectionnée mais sans fournisseur actif retire ses contributions gardées. Tous les paquets sélectionnés restent soumis aux contrôles structurels, de sécurité et de confinement, même si une intégration est éteinte. Les références depuis une contribution active vers une intégration indisponible restent refusées.

Chaque dépendance déclare `moduleId`, `origin`, `versionRange` et les ports publics nécessaires dans `contracts[]`, chacun avec une plage de versions du contrat. La compatibilité du paquet et celle du port sont vérifiées séparément. Les références vers un autre module doivent passer par ces ports ; son simple nom dans la liste de dépendances ne rend pas ses ressources internes publiques.

Une contribution conditionnée par une dépendance facultative déclare `requiresModules: [moduleId]`. Ce champ existe sur les opérations, API, widgets et leurs actions individuelles, événements, recherches, réglages, contributions MCP et contributions UI. Une garde sur le widget retire toutes ses actions ; une garde sur une action seule conserve le widget et ses autres actions. Son mode message/contexte/direct reste distinct de son activation. Une référence absente non gardée reste une erreur. Si une garde retire une opération locale, ses consommateurs actifs ne peuvent pas continuer à la référencer ; l'analyse couvre aussi cette propagation. Les modèles et catégories de fichiers ne possèdent pas cette garde : une relation persistante ne disparaît pas implicitement avec un connecteur. Les exports publics doivent refléter les contributions effectivement disponibles.

La composition résout une seule origine/version par identité de module. Elle ne crée pas de copies privées des dépendances à l'intérieur des modules ; un type `peer` supplémentaire n'est donc pas nécessaire. Le graphe transitif doit être résolu, sans cycle de dépendances, et verrouillé. Chaque arête du lock désigne un nœud exact `{moduleId, version}` ; ce nœud porte origine, provenance, contrat et intégrités des artefacts. Les contrats publics retenus et états d'intégration sont verrouillés via les empreintes du descripteur et de la composition, sans seconde liste contradictoire. Les modules sélectionnés mais désactivés restent verrouillés pour conserver leur provenance. Ils ne satisfont pas une dépendance active et ne sont pas exposés dans les catalogues.

`lifecycle.dependencyChanges` fixe le comportement attendu : installation par sélection explicite, activation avec dépendances disponibles et actives, mise à jour compatible avec les dépendants, désactivation/suppression bloquées en cas de rupture sans plan explicite pour les dépendants. Les données sont conservées. Ces déclarations ne réalisent pas elles-mêmes les transitions ; leurs exécuteurs et recettes sont qualifiés dans les lots consommateurs. Une désinstallation n'implique jamais une destruction implicite des données.

Exemple : un panier peut déclarer une dépendance obligatoire vers un contrat catalogue. Si le catalogue manque, est désactivé, possède une autre origine ou expose une version incompatible du port, le panier ne peut pas être activé. Un connecteur facultatif absent retire seulement les contributions qui en dépendent ; il ne transforme pas un appel indisponible en réussite factice.

## Données, autorisations et hébergement

Les opérations restent communes à l'API, au MCP et aux widgets. Le contexte demandé n'est jamais une preuve de droit. Les permissions, audiences, approbations, versions d'objet et clés d'idempotence sont vérifiées à l'exécution et au commit. Les effets déclarent lectures, écritures, événements, appels et fournisseurs ; une opération `query` ne peut pas déclarer de mutation. Les approbations requises sont liées à l'acteur, au contexte, à l'opération, aux entrées et à la version pertinente de l'objet.

Les modèles décrivent directement les données actuelles. Aucun champ de script SQL de transformation n'est prévu par module. Le SQL est généré et examiné par la chaîne centrale. Les tâches, événements et progrès peuvent être persistés, mais les appels et reprises sont déclenchés de l'extérieur : aucun scheduler interne.

Sites conserve un couple D1/R2 partagé. Les capacités distinctes des profils `sites`, `docker-local` et `cloudflare` ne modifient pas les modèles métier. La liste `host.capabilities` est une demande à confronter au profil approuvé, jamais un moyen d'inventer un binding ou d'activer une fonction par paiement. Les clés fournisseurs, jetons d'accès, droits d'activation et token d'inscription ne figurent pas dans ces documents.

## Widgets et surfaces

`contracts.widgets` est une collection. Chaque widget possède ses identifiants/version, ressources, schémas entrée/état/résultat, audiences, permissions et une collection d'actions. Les trois modes sont déclarés par action et peuvent coexister dans un même widget :

- `message` : texte préparé, aperçu et envoi volontaire ; états proposé/transmis/refusé/incertain, sans déduction de succès métier.
- `context` : champs autorisés, namespace module/instance, portée acteur/conversation/surface, révision, durée et remplacement/retrait ; aucun tour LLM ni effet métier.
- `direct` : effet visuel local ou appel d'une opération serveur commune. La publication d'un contexte après succès est explicite et ne déclenche pas un message.

Un repli conserve l'effet demandé. Un timeout n'autorise pas de second envoi via un alias ; l'état est rapproché de la requête initiale avant reprise. Les identités du widget, de son instance, du message, de la conversation et de l'objet métier restent distinctes. Ces champs décrivent les garanties attendues ; leur réalisation doit être testée sur l'hôte réel.

Le plugin est la projection conversationnelle du module. Ses manifestes portables, outils, ressources et skills restent distincts de la totalité du backend métier. Le front spécifique peut être absent ; le workspace, une composition thémée ou une application headless utilisent les mêmes opérations autorisées. Une audience `app` n'autorise aucune contribution `admin` automatiquement.

## Documents, preuves et intégrités

`documentation.installed` référence README, PRD et changelog de la version distribuée. Les documents de travail sont identifiés séparément, éventuellement dans un artefact de validation privé accessible au contrôleur autorisé. Les révisions locales approuvées et l'historique effectif d'installation ne remplacent jamais les documents du paquet.

Les six suites `backend`, `ui`, `api-mcp`, `widgets`, `package`, `docs` et le gate sont présents dans le contrat. `not-applicable` exige un motif et une règle approuvée ; cela n'est pas un succès de test. La politique du consommateur contrôle l'applicabilité et les preuves. Aucun chemin de script ou tableau de tests ne prouve à lui seul une exécution.

Le paquet runtime et l'artefact de validation fournissent des inventaires et des références explicites. Le contrôle de fermeture inclut les chemins découverts dans les contrats et les références transitives des fichiers ; un inventaire autodéclaré n'est pas suffisant. Les scripts/tests ne sont pas inclus dans le Worker. Le manifeste runtime publié ne doit pas pointer vers un fichier de développement absent de son artefact : le contexte assemblé doit indiquer explicitement l'artefact de validation pour ces références.

`packaging.validationBinding` porte seulement l'identité, la version et la révision source. Les empreintes exactes des deux artefacts sont liées par le verrou ou un reçu détaché `artifact-receipt`, extérieur à ces archives. Une archive ne contient pas sa propre empreinte et les deux archives ne s'incorporent pas réciproquement leurs empreintes : cela rendrait la construction circulaire. La provenance approuvée du reçu et les octets effectivement reçus devront être vérifiés dans le parcours de distribution ; un JSON conforme ne prouve ni une signature ni l'identité d'un registre distant. Aucun de ces contrôles réseau n'est annoncé acquis par T-02.

`sha256-<64 caractères hexadécimaux>` est le format d'intégrité Creezio. Il ne s'agit pas du format SRI npm. La source et les archives sont hachées sur leurs octets exacts. Deux champs ont une définition spécifique : `compositionIntegrity` et `contractIntegrity` utilisent le JSON canonique du document correspondant, clés d'objets triées récursivement par unités UTF-16, ordre des tableaux conservé, primitives sérialisées par `JSON.stringify`, sans espaces, encodé en UTF-8. Aucune normalisation d'ordre de tableau n'est implicite.

Les fixtures `tests/contracts/fixtures/valid-*.json` sont des données de test de contrat. Leurs empreintes de composition et descripteur sont calculées ; les empreintes nulles de source et d'archives identifient des valeurs factices de fixture, pas des paquets construits, testés ou publiés. Les tests d'archives ultérieurs devront produire et vérifier de vrais octets et couvrir toute la fermeture des références.
