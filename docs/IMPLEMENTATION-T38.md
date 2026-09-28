# T-38 — contribution amont : certificats TLS du Docker local

Cette note conserve la preuve du correctif TLS utilisé par le fork Lab. L’adoption ultérieure du module 0.1.2 et sa conservation sont suivies dans [T40](IMPLEMENTATION-T40.md) ; elles ne sont pas déduites de la sonde TLS.

## État actuel, distinct de la preuve TLS

Le correctif TLS était intégré dans Core main `f1c1943` et Lab main `78a6018`. Lab main `26180ed`, après PR #4 et CI 1 165/1 165, utilise désormais le module 0.1.2 sur Docker Linux et sur le même Site B du compte courant. La publication Sites est synchronisée au registre. Les lectures après adoption confirment comptes, demandes, fichiers, messages et brouillon ; les anciens widgets sont en revanche indisponibles et leur correction reste ouverte. Le plan Linux révision 1, `4a3c56cb-8b77-4243-bea5-f745522d9ff3`, correspond à la cible publiée, sans événement durable de confirmation dans l’ancien contrat. Les trois tours OpenAI et les actions direct/message/contexte exercés auparavant conservent leurs preuves séparées. Le snapshot du troisième tour Linux prouve la capture du contexte, pas son usage par le modèle lorsque le texte de l’historique contenait déjà cette information. Voir l’état courant et les limites dans [T40](IMPLEMENTATION-T40.md).

## Cause observée

Sur l'image Linux Lab avant le correctif CA, le premier tour OpenAI s'est arrêté en état `unknown` sans identifiant de réponse durable. Un GET sans clé vers `https://api.openai.com/v1/models` répondait HTTP 401 JSON depuis Node, mais échouait depuis un Worker Miniflare/workerd avec `failed: TLS peer's certificate is not trusted; reason = unable to get local issuer certificate`. L'image `node:24-bookworm-slim` n'avait pas de bundle `/etc/ssl/certs/ca-certificates.crt`. Le transport ne peut enregistrer un reçu qu'après la première trame `response.created` ; cette erreur TLS survient avant toute réponse HTTP.

## Correction et exploitation

Le Dockerfile installe le paquet Debian `ca-certificates` avant `USER node`, puis retire les listes apt régénérables. La vérification TLS reste active. Reconstruire l'image après ce changement et recréer le conteneur avec le volume `.wrangler` conservé ; ne pas supprimer les données ni rejouer un tour `unknown` sans reçu. La sonde de qualification n'utilise aucune clé et n'appelle pas l'endpoint Responses.

## Preuve bornée

Après reconstruction de l'image Lab depuis [sa source `9fdb288`](https://github.com/Creez-io/Creezio-Lab/commit/9fdb2885c73086b473bacc518d75a64f064c0465), le bundle CA était présent. Une unique sonde Miniflare éphémère a reçu HTTP 401 `application/json` sur `/v1/models` sans authentification, sans erreur TLS ; elle a été disposée et l'identifiant du conteneur ainsi que celui de l'image sont restés identiques avant et après. Depuis l'hôte Linux, `/conversations` a répondu HTTP 200 en 0,117 s et la route API conversations a refusé l'accès sans session en HTTP 403. Le rapport opérateur hors dépôt `CREEZIO-T37-LAB-WORKER-CA-PROBE-2026-09-28.json` conserve les identifiants et résultats expurgés.

Cette preuve établit la sortie HTTPS du runtime Worker de l'image corrigée. Elle ne prouve pas la validité d'une clé OpenAI, une nouvelle génération, ni la fin de la recette T-38. Le premier tour `unknown` sans reçu est conservé pour inspection ; aucune répétition du même tour ou de sa clé n'est justifiée. Le [contrat Docker existant](../tests/local/docker.test.mjs) vérifie le profil et le démarrage du socle ; la sonde Worker réelle vérifie la chaîne TLS et évite un test qui ne ferait que recopier le Dockerfile. Les étapes de reconstruction et de conservation du volume restent dans la [recette Docker](../adapters/docker/README.md).
