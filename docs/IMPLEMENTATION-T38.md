# T-38 — contribution amont : certificats TLS du Docker local

Cette note porte sur un correctif du socle utilisé par le fork Lab. Elle ne clôt ni l'adoption du paquet, ni la mise à jour du fork prévues par [T-38](TODO.md#T-38). L'application Lab tourne avant l'adoption de la nouvelle version du module ; son Site B n'est pas encore qualifié.

## Cause observée

Sur l'image Linux Lab avant le correctif CA, le premier tour OpenAI s'est arrêté en état `unknown` sans identifiant de réponse durable. Un GET sans clé vers `https://api.openai.com/v1/models` répondait HTTP 401 JSON depuis Node, mais échouait depuis un Worker Miniflare/workerd avec `failed: TLS peer's certificate is not trusted; reason = unable to get local issuer certificate`. L'image `node:24-bookworm-slim` n'avait pas de bundle `/etc/ssl/certs/ca-certificates.crt`. Le transport ne peut enregistrer un reçu qu'après la première trame `response.created` ; cette erreur TLS survient avant toute réponse HTTP.

## Correction et exploitation

Le Dockerfile installe le paquet Debian `ca-certificates` avant `USER node`, puis retire les listes apt régénérables. La vérification TLS reste active. Reconstruire l'image après ce changement et recréer le conteneur avec le volume `.wrangler` conservé ; ne pas supprimer les données ni rejouer un tour `unknown` sans reçu. La sonde de qualification n'utilise aucune clé et n'appelle pas l'endpoint Responses.

## Preuve bornée

Après reconstruction de l'image Lab depuis [sa source `9fdb288`](https://github.com/Creez-io/Creezio-Lab/commit/9fdb2885c73086b473bacc518d75a64f064c0465), le bundle CA était présent. Une unique sonde Miniflare éphémère a reçu HTTP 401 `application/json` sur `/v1/models` sans authentification, sans erreur TLS ; elle a été disposée et l'identifiant du conteneur ainsi que celui de l'image sont restés identiques avant et après. Depuis l'hôte Linux, `/conversations` a répondu HTTP 200 en 0,117 s et la route API conversations a refusé l'accès sans session en HTTP 403. Le rapport opérateur hors dépôt `CREEZIO-T37-LAB-WORKER-CA-PROBE-2026-09-28.json` conserve les identifiants et résultats expurgés.

Cette preuve établit la sortie HTTPS du runtime Worker de l'image corrigée. Elle ne prouve pas la validité d'une clé OpenAI, une nouvelle génération, ni la fin de la recette T-38. Le premier tour `unknown` sans reçu est conservé pour inspection ; aucune répétition du même tour ou de sa clé n'est justifiée. Le [contrat Docker existant](../tests/local/docker.test.mjs) vérifie le profil et le démarrage du socle ; la sonde Worker réelle vérifie la chaîne TLS et évite un test qui ne ferait que recopier le Dockerfile. Les étapes de reconstruction et de conservation du volume restent dans la [recette Docker](../adapters/docker/README.md).
