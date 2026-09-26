# T-03 — Runtime commun et qualification locale

Réalisation sur `core/t03-runtime`, depuis le checkpoint T-02 `72c7f3f`. [T-03](TODO.md#T-03) suit le statut du lot et ses dépendances. Ce document décrit les preuves locales de [REQ-0301](EXIGENCES.md#REQ-0301), [REQ-0302](EXIGENCES.md#REQ-0302) et [REQ-0303](EXIGENCES.md#REQ-0303), sans annoncer un CMS complet ni une qualification hébergée.

## Code et composition

- `worker.ts` raccorde le dispatch commun au rendu Vinext. Le runtime ne lance aucun serveur Node, moteur tiers ou processus par module. Les imports Node du framework sont limités à sa compatibilité Worker ; le code sélectionné du cœur et des modules passe un contrôle de graphe distinct.
- `core/runtime/` résout le profil et les bindings, compile les routes statiques, limite les entrées et la durée des opérations. Le dispatch génère son propre identifiant de requête. Le contexte appartient au propriétaire de l'opération, même si une route est déclarée par un autre module.
- `scripts/build/compose-runtime.mjs` vérifie composition, verrou, contrats et sources confinées, puis produit des imports statiques serveur et UI. Le dépôt démarre avec une composition vide. Le module témoin est sélectionné explicitement dans une configuration de qualification et n'est pas une capacité native du CMS.
- `scripts/build/worker-boundary.mjs` est appelé par le vrai parcours Vite avant compilation. Il inspecte le graphe importé du cœur, des handlers et des vues UI sélectionnés, sans exécuter leurs fonctions ; un import Node incompatible direct ou transitif bloque le build, y compris dans une vue rendue côté serveur. Chaque source résolue est confinée au checkout, sans jonction/lien ni code importé par URL, avant sa lecture par le bundler. Cette vérification ne prétend pas détecter tout comportement dynamique arbitraire d'un paquet tiers.
- `app/` fournit la page d'installation et le montage des vues publiques déclarées. Le bouton d'état appelle le dispatch réel, mais vérifie uniquement la présence et la forme des bindings. Il ne prouve pas la disponibilité de D1/R2, des droits métier ou d'un fournisseur.

Les profils Sites, local et Cloudflare utilisent le même dispatch. Les accès applicatifs protégés répondent encore `401` avant le handler : l'identité native, les sessions et les jetons autorisés relèvent de T-04. Les champs `oai-authenticated-user-*`, un cookie ou un Bearer ne créent aucun droit.

Le budget porte sur le délai de production de la réponse par le handler ; un `AbortSignal` accompagne l'annulation. Il n'interrompt pas du JavaScript synchrone ni un flux déjà retourné. Les budgets de flux du chat, la validation complète des entrées/sorties métier, les effets, approbations et transactions appartiennent aux lots concernés. Le contexte de ce témoin sans modèle ne reçoit ni binding brut ni accès aux secrets. Le profil de composition `docker-local` désigne le développement Miniflare ; sa variable runtime `local` est commune au lancement natif et au futur adaptateur Docker.

## Recette workerd et stockage

Versions figées : Vinext `1.0.0-beta.5`, Vite `8.0.13`, Wrangler `4.92.0`, Miniflare `4.20260515.0`, React `19.2.6`. Le profil Worker utilise la date de compatibilité `2026-05-15`. Node reste un outil de build/test ; les requêtes qualifiées tournent dans workerd.

`npm run check` compose, contrôle les types, construit le bundle complet, puis lance les suites obligatoires. `npm run test:runtime` attend un `dist` complet déjà construit ; l'absence de build échoue. Les tests ne remplacent pas silencieusement le Worker intégral par un petit serveur Node.

`tests/runtime/workerd.test.mjs` distingue deux preuves :

1. **Artefact Vinext complet**, composition vide : rendu SSR de `/`, octets d'un asset émis, santé JSON, absence du module témoin et erreurs JSON des routes API/MCP inconnues.
2. **Petit bundle de qualification**, même dispatch avec imports issus de la composition témoin : opération publique exécutée, méthode interdite, refus d'une opération protégée avant son handler et refus de bindings absents. Ce bundle n'est pas présenté comme le rendu intégré d'une vue Vinext.

Un troisième Worker, `tests/runtime/harness/storage-worker.mjs`, possède uniquement un accès interne au harnais Miniflare. Il écrit une valeur synthétique dans D1 et R2, relit les deux résultats, puis les retrouve après destruction et redémarrage du processus workerd. Aucune route d'écriture de qualification n'est ajoutée au produit. Les ressources de test portent des noms distincts ; leurs fichiers vivent seulement dans `.wrangler/state/qualification-t03`.

Après `dispose`, le harnais vérifie son marqueur de propriété, le confinement et l'absence de liens avant nettoyage. Un dossier réservé déjà présent entraîne un refus, jamais sa suppression aveugle. La base locale utilisée par le développement demeure indépendante. Le test négatif du vrai build utilise seulement une petite copie du module témoin dans `.quality/runtime-incompatible`, la supprime et restaure la composition par défaut ; son échec doit laisser l'empreinte du `dist` valide identique.

La première recette complète locale a réussi : neuf contrôles, sans échec ni test ignoré. Le refus du **vrai build** d'un module sélectionné important `node:fs` a ensuite été exécuté avec conservation de l'artefact, séparément dans son handler puis dans sa vue UI avec le handler rétabli. Les ajouts ultérieurs de métriques, budgets et assertions repassent dans l'agrégat final ; seuls son SHA et ses empreintes font foi pour le checkpoint livré.

Un build complet supplémentaire avec la composition témoin a effectivement rendu `/witness` et son lien vers l'API, sans ajout manuel de route métier. Le navigateur a affiché cette contribution ; le bouton d'état de la page initiale a déclenché au clavier un appel réel réussi. Cette vérification ponctuelle reste distincte des tests automatisés et de la future recette exhaustive des interactions du workspace. Le build final conserve la composition de départ, sans témoin.

## Mesures et plafonds locaux

Première mesure réelle du bundle par défaut : 39 fichiers JavaScript Worker, **714 720 octets** au total et **223 816 octets gzip** en compressant les fichiers individuellement ; 14 assets, **391 345 octets**. Le graphe applicatif cœur+témoin inspecté comporte 6 entrées. Ces mesures n'incluent pas un SDK de contrôle dans le Worker.

Sur la machine de qualification : initialisation workerd autour de **525 ms**, redémarrage **519 ms**, réponse SSR **76 ms**, asset **51 ms**, santé **5 ms**, témoin **13 ms**, écriture/lecture synthétique D1/R2 **65 ms**. Ce sont des observations locales d'une exécution, pas des percentiles ou des garanties réseau. Les temps de route vont de l'appel à la réponse ; les assertions consomment ensuite son corps.

`scripts/quality/runtime.mjs` applique des plafonds volontairement plus larges pour détecter une régression :

| Mesure | Plafond local |
|---|---:|
| JavaScript Worker total | 1 500 000 octets |
| Somme gzip JavaScript Worker | 500 000 octets |
| Entrées du graphe applicatif sélectionné | 32 |
| Initialisation ou redémarrage workerd | 15 000 ms |
| Chaque route qualifiée, y compris le roundtrip interne | 3 000 ms |

Ces plafonds sont des critères locaux de T-03, **pas les quotas d'une offre Cloudflare ni un SLA**. Une nouvelle composition peut nécessiter un budget explicitement revu et mesuré ; elle ne supprime pas le contrôle. Les limites de durée d'opération et de taille des entrées du dispatch restent indépendantes de ces budgets de recette.

## Preuves et limites

`.quality/runtime-latest.json` conserve début/fin ISO, état, mesures, composition témoin et empreintes des fichiers du build. `.quality/latest.json` lie la recette aux sources contrôlées. L'agrégateur exige un rapport réussi produit dans l'exécution actuelle et des artefacts inchangés après les tests ; un ancien résultat vert ne valide pas un nouveau bundle. Une compilation seule ne prouve pas son exécution.

Le module témoin sert à qualifier le contrat et le raccordement. Les archives de distribution et leurs signatures ne sont pas produites ni vérifiées ici. L'authentification, les données métier, les modules natifs, onglets persistants, chat, widgets, Docker complet et les deux Sites restent dans leurs lots respectifs. Les assertions HTTP de cette recette ne prouvent pas l'hydratation, les interactions ni la conservation d'état dans un navigateur. Aucune publication sur Sites ou sur un compte Cloudflare n'est réalisée par ces tests.

Après reprise d'Actions, la [PR #3](https://github.com/creezio/Creezio-D1R2/pull/3) a synchronisé main sans changer l'arbre du checkpoint revu `4d97e9e`. Le [run de PR](https://github.com/creezio/Creezio-D1R2/actions/runs/36265776647) sur `c3f6028` réussit les 245 tests, types/build et contrôle d'artefact courant. Squash `b14cef7994e16b7ad6aa78073b04c1f1128b159b`, puis [CI du nouveau main](https://github.com/creezio/Creezio-D1R2/actions/runs/36265890126) réussie. Ces contrôles Linux complètent le local Windows ; aucun déploiement hébergé n'est ajouté à la portée du lot.

Références primaires : [Miniflare dans workers-sdk](https://github.com/cloudflare/workers-sdk/blob/main/packages/miniflare/README.md), [démarrage Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/get-started/), [binding Static Assets](https://developers.cloudflare.com/workers/static-assets/binding/). Les options exécutées sont celles de la version locale verrouillée.
