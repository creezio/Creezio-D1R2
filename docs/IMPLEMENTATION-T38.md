# T-38 — adoption des mises à jour et contributions

Cette note suit les adoptions du socle dans le fork Lab et conserve la preuve historique du correctif TLS. L’adoption du module 0.1.2 et sa conservation sont également suivies dans [T40](IMPLEMENTATION-T40.md).

## Adoption du 29 septembre 2026

Lab PR #13 est intégrée sur `7ebf53215287297ed1c1fb4405039b527eaed884`, avec 1 282 tests réussis sur la candidate puis sur main. Cette source adopte Core `af602626`, SDK 1.4.1 et le module d'achats 0.1.3 ; le front propre au fork reste conservé. Les deux Sites du compte courant servent leur version 4 : Original est construit depuis Core `af602626`, Lab depuis `7ebf532`. Leurs comptes, conversations, brouillons et fichiers témoins ont été relus par les API natives, puis les sessions déconnectées.

Le même Lab a été construit et adopté sur Linux, avec zéro DDL et conservation du volume. Sa mise à jour Cloudflare `1eb95535-8ffb-475f-a674-b5a4b87fc2b9` est `delivered`, Worker version `ed1fafdf-558c-44cb-9b69-2485de4896d8`, et synchronisée au registre. Le publisher a comparé 71 modules et 41 assets. Après arrêt du Docker et du tunnel de qualification, la lecture distante a retrouvé demande rev5, fichier de 43 octets identique, trois tours app réussis, ancien tour inconnu inchangé et témoin admin donnant le montant correct. Aucun nouvel appel LLM ni réimportation des données n'a été nécessaire. Les reçus opérateur `CREEZIO-T38-LAB-LINUX-7EBF532-*` et `CREEZIO-T38-LAB-CF-UPDATE-7ebf53215287297ed1c1fb4405039b527eaed884-*` du 29 septembre lient source, image, plan, artefact, publication et persistance.

Sur le Site Lab version 4, deux previews refusent le retrait (`dependency.missing`) et la désactivation (`dependency.disabled`) de Conversations. Aucun plan n'est accepté ; catalogue, relations, versions, données et fichier restent identiques avant/après. Ce résultat ne qualifie pas une mise à jour vers une version fournisseur incompatible, absente de cet inventaire.

Les limites restent explicites : l'interface Linux a montré navigation et demandes mais n'a pas permis de conclure sur l'affichage de tout l'historique, dont les données sont présentes par API. La recette visuelle connectée de la version 4 des Sites et le plugin ChatGPT du nouveau Site restent distincts. Les trois modes du widget ont été exercés sur Site Lab version 3 avant cette adoption ; leur contrôle du contexte suivant n'est pas déduit de cette mise à jour. Le lot T-38 exhaustif demeure ouvert.

## Historique antérieur, distinct de la preuve TLS

Le correctif TLS était intégré dans Core main `f1c1943` et Lab main `78a6018`. Au jalon Lab `26180ed`, après PR #4 et CI 1 165/1 165, le module 0.1.2 était utilisé sur Docker Linux et sur le même Site B du compte courant. La publication Sites est synchronisée au registre. Les lectures après adoption confirment comptes, demandes, fichiers, messages et brouillon ; les anciens widgets restaient alors indisponibles. Leur restauration a depuis été vérifiée sur Site B et sur le Worker Lab publié. Le plan Linux révision 1, `4a3c56cb-8b77-4243-bea5-f745522d9ff3`, correspond à la cible publiée, sans événement durable de confirmation dans l’ancien contrat. Les trois tours OpenAI et les actions direct/message/contexte exercés auparavant conservent leurs preuves séparées. Le snapshot du troisième tour Linux prouve la capture du contexte, pas son usage par le modèle lorsque le texte de l’historique contenait déjà cette information. Le checkout Lab a depuis adopté SDK 1.2 et module 0.1.3 dans la PR #9, avec son front et ses données conservés ; le Worker Cloudflare Lab publié garde la provenance `949f028`, SDK 1.1 et module 0.1.2. Voir les limites de cette preuve TLS et [T40](IMPLEMENTATION-T40.md).

## Cause observée

Sur l'image Linux Lab avant le correctif CA, le premier tour OpenAI s'est arrêté en état `unknown` sans identifiant de réponse durable. Un GET sans clé vers `https://api.openai.com/v1/models` répondait HTTP 401 JSON depuis Node, mais échouait depuis un Worker Miniflare/workerd avec `failed: TLS peer's certificate is not trusted; reason = unable to get local issuer certificate`. L'image `node:24-bookworm-slim` n'avait pas de bundle `/etc/ssl/certs/ca-certificates.crt`. Le transport ne peut enregistrer un reçu qu'après la première trame `response.created` ; cette erreur TLS survient avant toute réponse HTTP.

## Correction et exploitation

Le Dockerfile installe le paquet Debian `ca-certificates` avant `USER node`, puis retire les listes apt régénérables. La vérification TLS reste active. Reconstruire l'image après ce changement et recréer le conteneur avec le volume `.wrangler` conservé ; ne pas supprimer les données ni rejouer un tour `unknown` sans reçu. La sonde de qualification n'utilise aucune clé et n'appelle pas l'endpoint Responses.

## Preuve bornée

Après reconstruction de l'image Lab depuis [sa source `9fdb288`](https://github.com/Creez-io/Creezio-Lab/commit/9fdb2885c73086b473bacc518d75a64f064c0465), le bundle CA était présent. Une unique sonde Miniflare éphémère a reçu HTTP 401 `application/json` sur `/v1/models` sans authentification, sans erreur TLS ; elle a été disposée et l'identifiant du conteneur ainsi que celui de l'image sont restés identiques avant et après. Depuis l'hôte Linux, `/conversations` a répondu HTTP 200 en 0,117 s et la route API conversations a refusé l'accès sans session en HTTP 403. Le rapport opérateur hors dépôt `CREEZIO-T37-LAB-WORKER-CA-PROBE-2026-09-28.json` conserve les identifiants et résultats expurgés.

Cette preuve établit la sortie HTTPS du runtime Worker de l'image corrigée. Elle ne prouve pas la validité d'une clé OpenAI, une nouvelle génération, ni la fin de la recette T-38. Le premier tour `unknown` sans reçu est conservé pour inspection ; aucune répétition du même tour ou de sa clé n'est justifiée. Le [contrat Docker existant](../tests/local/docker.test.mjs) vérifie le profil et le démarrage du socle ; la sonde Worker réelle vérifie la chaîne TLS et évite un test qui ne ferait que recopier le Dockerfile. Les étapes de reconstruction et de conservation du volume restent dans la [recette Docker](../adapters/docker/README.md).
