# Client navigateur des opérations déclarées

Ce SDK consomme uniquement les routes `contracts.api` sélectionnées par la composition. L'hôte fournit le catalogue statique `httpBindings`, l'origine et l'audience du contrôleur `sdk/access`. Le navigateur utilise les cookies natifs de cette audience ; le SDK ne lit ni ne stocke de jeton, ne fabrique pas de rôle et n'ouvre aucun endpoint universel d'invocation.

```ts
const client = createOperationClient({
  origin: access.origin,
  audience: access.audience,
  access,
  bindings: httpBindings.filter(binding =>
    binding.audience === access.audience && binding.auth.includes('session')),
});

const result = await client.invoke({
  bindingId: 'example.notes:save-http', // module contributeur : id contracts.api
  contextId: 'workspace-a',
  input: {noteId: 'note-1', revision: 7, title: 'Brouillon'},
  isCurrent: () => currentProjection === projectionAtStart,
});
```

Le binding détermine méthode, chemin, audience, contexte, codecs des paramètres et opération cible. Le client place les paramètres déclarés dans le chemin, la query ou les headers et les autres champs dans le corps JSON des mutations. Un GET ne porte aucun corps. Les requêtes restent sur la même origine avec `credentials: same-origin`, `cache: no-store` et refus des redirections. Les mutations envoient `X-Creezio-Request: 1` ; `X-Creezio-Context` porte le contexte sélectionné que le serveur autorise. Le client ne transmet pas `Authorization` et ne lit pas les cookies HttpOnly.

`invoke` et `status` renvoient trois familles :

- `execution` : une exécution connue, avec son état, son identifiant, sa sortie et son éventuel code d'erreur ; `failed` est un état connu.
- `rejected` : refus certain avant effet, notamment entrée locale invalide, accès absent ou erreur HTTP qualifiée. Un `501 unsupported` ou `capability_unavailable` déclaré par le transport est un refus certain.
- `unknown` : issue non confirmée, notamment réponse perdue ou malformée après émission d'une mutation, état serveur `unknown`, session ou projection devenue périmée.

Le SDK ne relance jamais une mutation. `status` accepte exactement une cible : `executionId` pour lire `/api/operations/status/{contributorModuleId}/{bindingId}/{executionId}`, ou `requestKey` pour lire `/api/operations/lookup/{contributorModuleId}/{bindingId}` avec l'en-tête `X-Creezio-Request-Key`. Ce dernier porte le base64url sans padding des octets UTF-8 de la clé, afin de conserver exactement espaces, Unicode et caractères de contrôle ; le serveur vérifie puis décode cette représentation. Les deux lectures utilisent la session, le contexte et les droits courants ; elles n'émettent aucun POST. La clé de demande doit être celle de l'entrée de l'opération à idempotence requise, non vide et limitée à 512 octets UTF-8 comme dans le moteur. La conserver tant que l'issue n'est pas confirmée. Un lookup `404` signifie seulement que l'exécution n'a pas été observée par cette lecture : le client renvoie `unknown / execution_not_observed`, jamais une preuve de non-commit ni une autorisation de réessayer avec une nouvelle clé. L'autorisation du serveur, y compris à la lecture du statut, reste décisive.

La réponse d'une opération est écartée si l'identité native a changé entre l'envoi et la réception. L'hôte peut fournir `isCurrent` pour lier également la réponse au snapshot de projection du workspace. Cette projection sert à l'affichage ; elle ne donne jamais le droit d'écrire plus tard. Le moteur T-06 vérifie ses propres droits frais et ses gardes D1 au commit.

Preuves locales ciblées : `node --test tests/workspace/client.test.mjs tests/workspace/authorization.test.mjs tests/workspace/composition.test.mjs`. Ces tests couvrent le contrat client, une projection sur D1 synthétique et la composition statique. Ils ne valent ni recette navigateur, ni preuve d'appel hébergé, ni qualification des modes OAuth, webhook ou anonymes du moteur T-06.
