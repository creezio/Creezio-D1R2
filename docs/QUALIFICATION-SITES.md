# Qualification de GPT Sites

## État courant — 2 octobre 2026

Sur le compte courant, Original est publié sur `https://creezio-original.domix429943.chatgpt.site` en version 4 (source Site `3a1b34842d6f985b956c3e519336451f4c65ee71`, environnement 4) et Lab sur `https://creezio-lab.domix429943.chatgpt.site` en version 2 (environnement 3). Les deux déclarations au registre sont synchronisées. Leurs données, ressources et recettes restent distinctes.

Original a conservé avant mise à jour le témoin conversation (réponse OpenAI réelle, brouillon et fichier) et les fiches CRM cloisonnées entre les contextes A/B. Après PR #97, Core main `6921f5debd4a07801bbe2d87744a0555a08954db` et sa CI 1 501/1 501, une recette navigateur sur Original version 4 a relu le même brouillon, la même réponse et les octets du fichier après un seul rechargement, sans resélection ni nouveau tour ; déconnexion 200 et session 401 confirmées. La conservation CRM après cette publication n'est pas requalifiée par ce contrôle navigateur. Voir les reçus hors dépôt `CREEZIO-T20-OCT2-ORIGINAL-PREUPDATE-FINAL.json`, `CREEZIO-T09-OCT2-ORIGINAL-PR97-{PUBLISHED,REGISTRY}.json` et `CREEZIO-T09-OCT2-ORIGINAL-PR97-RELOAD-2026-10-02T1430Z.json`.

Sur Lab version 2, la recette a qualifié lectures, navigation et déconnexion, sans nouveau tour LLM. Le plugin ChatGPT de ces Sites sur le compte courant n'est pas qualifié ; les preuves ChatGPT historiques portent sur d'autres cibles et gardent leur portée propre.

État au 27 septembre 2026 : le Worker commun Creezio est publié sur une nouvelle cible publique du compte courant, les anciennes cibles restant préservées. La recette du candidat intermédiaire T15 `c133bf1` a vérifié la connexion native, le workspace original, le front ChatGPT-like, une vraie réponse OpenAI sur chaque interface, le brouillon, la pièce jointe R2 et le PRD livré. La publication finale `af63cb3c` a conservé ces données et corrigé le statut du catalogue ; PR #24 intégrée, main `42efa820` et CI 993/993. Les API et les deux MCP refusent l'accès anonyme ; la route de l'opérateur temporaire renvoie 404. Le fork n'est pas encore créé ; la connexion réelle ChatGPT et les widgets restent T16. Les résultats de sonde du 26 septembre ci-dessous gardent leur portée distincte. Voir le [parcours d'installation Sites](INSTALLATION-SITES.md) et la [réalisation T15](IMPLEMENTATION-T15.md).

## Périmètre retenu

Les Sites du projet et de sa recette sont **publics**, par choix utilisateur. Le front est accessible sans connexion GPT ; les fonctions protégées utilisent selon leur canal une session native Creezio, une autorisation machine API/MCP ou un webhook signé, avec leurs droits propres. Un cookie de navigateur n'est pas exigé pour un client externe autorisé. Une identité GPT ne crée aucun compte, session ou droit applicatif. La [documentation Sites](https://learn.chatgpt.com/docs/sites) décrit le mode public de l'hébergement.

Chaque Site utilise **un couple D1/R2 natif commun à son application**, avec cloisonnement logique par contexte et autorisations serveur. Le provisionnement de plusieurs ressources dans un même Site est abandonné ; ce n'est plus une question ouverte. Docker conserve la possibilité de ressources D1/R2 distinctes, à éprouver dans son propre parcours. Les deux applications de recette sur A et B gardent chacune leurs ressources et secrets indépendants.

Le chat appelle son LLM via le **module OpenAI activé et configuré avec une clé API serveur**. Interface, conversations, outils et widgets restent Creezio. La sonde initiale puis le module T15 ont été vérifiés séparément. Le produit conserve la clé chiffrée en D1, avec clé de coffre en secret serveur ; la réponse réelle et les données du chat ont été relues après publication. Les widgets et outils associés restent T16.

La planification est **externe** : n8n ou un autre service appelle les opérations Creezio par API token/MCP sans navigateur. Les points à vérifier portent sur ces appels réels, les autorisations, les résultats et les reprises ; aucun scheduler ou Cron Trigger Sites n'est à rechercher. Les API/MCP entrants appartiennent au socle, sans dépendance obligatoire au plugin n8n.

## Ce qui a été vérifié sur un Site hébergé

Une sonde minimale a été publiée avec un Worker, une base D1 et un bucket R2. Elle ne contient aucun compte ni document métier. Initialement testée avec l'audience privée par défaut, elle a été passée en public conformément à la clarification utilisateur, puis retestée le 26 septembre à 12:29 UTC **sans aucun jeton d'accès GPT/Sites**. Le Worker publié est inchangé ; les opérations sensibles gardent leur protection applicative.

| Vérification | Résultat |
|---|---|
| Publication Worker et ressources natives | Publication réussie ; D1 `DB` et R2 `BUCKET` présents sans clé Cloudflare personnelle. |
| Front public | Requête anonyme sur la page de présentation : HTTP 200, sans connexion GPT ni jeton Sites. |
| Autorisation applicative | Requête sans clé applicative refusée avec HTTP 401 ; requête autorisée acceptée. Aucune identité GPT reçue pendant cette sonde. |
| Transport des sessions | `Set-Cookie` Secure/HttpOnly transmis ; retour du cookie accepté par l'application sans son bearer ; révocation vérifiée. |
| D1/R2 | Écriture et relecture indépendantes, correspondance des empreintes du contenu vérifiée. |
| Corps brut et signature | Requête HMAC correctement reçue sur le Site public, sans cookie ni bearer applicatif/GPT ; rejeu identifié et modification des octets refusée. |
| HTTP sortant | Requête HTTPS vers une documentation publique réussie depuis le Worker. |
| Streaming synthétique | Les événements arrivent, mais groupés après environ 4 secondes sur le chemin public testé. Le passage public ne suffit pas à valider leur affichage progressif. |

Ces tests qualifient les transports nécessaires à une authentification native. Ils ne remplacent pas la future recette de comptes Creezio : invitation/inscription, mot de passe, session navigateur, permissions, expiration et protection des actions. Aucun scaffold d'authentification GPT n'est utilisé comme identité applicative de substitution.

## Évolution SQL, continuation et streaming prolongé

Une seconde version a été publiée avec un champ nullable supplémentaire, produit par Drizzle depuis le modèle. Le nouveau champ est présent et l'enregistrement D1 ainsi que l'objet R2 créés avant la publication restent accessibles avec la même empreinte. Cette preuve couvre une évolution additive sur données synthétiques ; elle ne qualifie pas encore toutes les évolutions de modèles, la reprise après échec ou les mises à jour de plugins du futur produit.

Une continuation `waitUntil` a écrit en D1 après une réponse HTTP 202. Cette preuve concerne uniquement une tâche courte déclenchée par requête. La planification et les relances restent externes conformément au périmètre, sans besoin de qualification d'un ordonnanceur natif.

**L'affichage progressif du chat n'est pas validé.** Lors de la qualification privée initiale, cinq événements SSE espacés d'une seconde ont été reçus groupés après environ 5,4 secondes. Ajouter du remplissage (environ 20 Ko au total) a produit plusieurs fragments réseau, tous reçus en moins de 10 ms vers la fin de la réponse. Les en-têtes de non-transformation et d'encodage `identity` n'ont pas changé ce résultat. Un second client indépendant, `curl --no-buffer`, les a également reçus groupés. Après ouverture publique, le test Node sans jeton Sites reçoit encore le flux groupé en un fragment vers 4 secondes.

Le 26 septembre, le navigateur a lui aussi reçu les cinq événements en un fragment à 4 039 ms, alors que les horodatages serveur sont espacés d'une seconde. Le regroupement est donc confirmé sur ce trajet navigateur. Il ne peut plus être attribué à la seule porte GPT privée ; les mesures ne localisent pas le composant responsable et ne démontrent aucune impossibilité générale de Sites.

## Qualification OpenAI réelle et progression persistée

Deux appels réels à l'API Responses ont réussi depuis le Worker public, sans autorisation GPT/Sites pour le client machine, avec `gpt-4.1-nano-2025-04-14` et une clé en variable d'environnement secrète. Le premier appel impose un outil borné lisant la disponibilité effective des bindings D1/R2 ; le second reçoit son résultat et produit une vraie réponse en français. Un appel sans autorisation applicative est refusé par HTTP 401 avant tout accès payant au fournisseur. La sonde utilise 189 tokens au total selon les compteurs retournés, ne reçoit pas de prompt libre et ne prétend pas fournir les permissions complètes du produit.

Le Worker reçoit 18 fragments textuels du fournisseur entre 3 968 et 4 206 ms, puis la fin à 4 269 ms. Le client machine reçoit les deux fragments réseau ensemble vers 4 560 ms. L'accès au fournisseur et son émission progressive sont établis ; la parité du chat côté utilisateur reste à construire.

Une seconde sonde protégée a vérifié le recours aux événements persistés : un POST borné écrit cinq étapes en D1 ; des GET autorisés concurrents les lisent avant la réponse finale. La première étape est visible à 2 730 ms, puis les suivantes pendant l'appel ; la réponse finale arrive à 7 020 ms. Aucun scheduler, daemon ou tâche autonome n'intervient. La consultation périodique appartient au client actif qui observe une opération déjà déclenchée, pas à un ordonnanceur serveur.

Cette preuve justifie un adaptateur de transport avec événements persistés, curseur et consultation bornée lorsque le streaming est regroupé. Dans le produit, grouper les fragments pour limiter les écritures D1 ; vérifier droits sur chaque lecture, annulation, déconnexion, reconnexion et reprise sans second appel fournisseur involontaire. La sonde ne prouve pas une exécution durable après fermeture du navigateur ni des traitements longs. Le parcours complet OpenAI + conversations + widgets + progression navigateur reste une recette du socle.

## Capacités non établies par le contrat actuel

| Capacité | Limite de ce qui est vérifié | Conséquence de conception |
|---|---|---|
| Appels planifiés depuis l'extérieur | Les primitives HTTP autorisées fonctionnent ; le workflow n8n réel et le serveur MCP du produit restent à construire/tester. | Vérifier une planification externe appelant une opération sans navigateur, avec accès limité, état/résultat, rejeu sûr et révocation. Aucune recherche de scheduler Sites. |
| Connecteurs fournisseurs réels | L'entrée publique signée est vérifiée sans accès GPT ; les événements Stripe/n8n et leurs signatures exactes restent à tester lors de l'implémentation des modules. | L'accès à un Site privé n'est plus une contrainte du projet. Une sonde HMAC synthétique ne remplace pas la recette réelle de chaque connecteur. |
| MCP complet | Le connecteur Sites prévoit une URL MCP en HTTP streamable lorsque la publication est prête pour MCP. La sonde vérifie les transports HTTP, pas un serveur MCP/OAuth complet. | Recette distincte découverte/PKCE/consentement/portées/refresh/révocation, avec les comptes Creezio. |
| WebSocket, tâches longues | Pas de preuve hébergée réalisée. | Aucun engagement de durée ou d'exécution durable implicite. |

L'absence de contrat disponible n'est pas présentée comme une impossibilité de la plateforme. La publication Cloudflare directe dispose de sa propre qualification ; ses capacités ne doivent pas être attribuées automatiquement à Sites.

## Contraintes établies

- La sonde protégée version 6 (`54b5d6950434674dca684686d7ec83ab037e720a`) refuse PBKDF2-HMAC-SHA256 à 600 000 itérations avec un plafond annoncé de 100 000. Entrées synthétiques fixes, aucun compte créé ; sans clé de sonde, refus HTTP 401. La primitive de mots de passe sera qualifiée séparément sans abaisser silencieusement son coût ; voir [T-04](IMPLEMENTATION-T04.md).
- En version 7 (`890b2a7aa9d378c107c3207e53f2c3c6329d4f8e`), les profils fixes Argon2id 19 MiB/t2/p1 et scrypt N32768/r8/p3 réussissent avec les mêmes résultats qu'en local. Le premier est retenu pour la primitive Creezio. Ce test ne qualifie ni comptes, ni sessions, ni mémoire totale/concurrence d'un CMS complet ; les durées externes ne mesurent pas le CPU facturé.
- Le runtime Worker dispose de 128 Mo par isolate selon le profil Sites portable, partagés entre les requêtes concurrentes.
- La version 8 (`17d84ec3b7462c10f4189baf60c336130b864138`) observe le transport de métadonnées réseau, sans compte ni calcul KDF : `request.cf` absent sur le chemin testé, CF-Connecting-IP et X-Real-IP présents et stables ; X-Forwarded-For, True-Client-IP et Forwarded peuvent conserver une valeur envoyée par le client. Une tentative de CF-Connecting-IP explicite reçoit 403 avant la sonde, sans attribution de la couche de refus. Aucun de ces constats ne prouve un contrat de provenance du visiteur pour tous les chemins Sites. Aucun repli vers les en-têtes falsifiables ; admission HTTP à qualifier avant exposition du login natif. La preuve ne conserve aucune adresse ou empreinte stable.
- Les sockets TCP bruts ne sont pas pris en charge par les Sites hébergés selon les instructions du fournisseur ; les connecteurs utilisent HTTPS.
- Les chemins `/signin-with-chatgpt`, `/signout-with-chatgpt` et `/callback` appartiennent au dispatcher. Les routes Creezio utilisent un préfixe distinct.
- Le SQL généré est appliqué avant l'upload Worker. Il faut conserver la compatibilité avec le code en service pendant la publication ; revenir au code précédent n'annule pas le SQL déjà appliqué.
- Les ressources, secrets et identités d'un Site ne sont pas incorporés au dépôt générique à forker.

## Portée de la validation

La sonde est un outil de qualification de l'hébergement, pas le Site A final du CMS ni l'application forkée. Son identité est conservée pour réutiliser cet environnement lors des prochaines qualifications. Pas de multiplication de Sites ni d'installations de dépendances pour chaque essai. Les productions et sources des applications existantes sont préservées.
