# PRD T29-MAIL — transports de messagerie externes

REQ-2901/2902 ; US-29 et messagerie T18. Premier fournisseur HTTP : Resend, dont les comportements existent dans la messagerie Creezio de référence. Les autres passerelles SMTP/IMAP restent externes ; aucune bibliothèque de connexion persistante ni scheduler ne devient une dépendance du socle.

Messagerie demeure propriétaire des boîtes, messages, brouillons, identifiants et états de livraison rapprochés et fichiers partagés entre workspace et front selon les droits. Le connecteur est propriétaire de sa configuration et de ses références de secrets. Il ne réplique pas le modèle métier de Messagerie.

L'utilisateur autorisé prépare son brouillon et ses pièces jointes. Une commande explicite crée l'intention durable avec contenu/révision/destinataires vérifiés avant émission. L'envoi HTTP utilise une clé d'idempotence issue du journal hôte. Un timeout après tentative n'est jamais présenté comme un échec certain ni renvoyé sous une nouvelle clé. L'état local, l'accusé d'acceptation et la livraison réelle sont distincts.

Le callback signé valide les octets bruts, les en-têtes et la fenêtre temporelle du fournisseur avant déduplication ; les accusés sont rapprochés d'un envoi connu, sans confiance dans un contexte fourni par l'événement. Les callbacks désordonnés ne régressent pas un état confirmé. Une réception entrante autorisée relit le message par l'API du fournisseur puis l'insère par le contrat Messagerie, sans texte HTML exécutable. Les pièces jointes passent par le port R2 déclaré et les quotas existants.

Les tentatives de reprise sont explicites et bornées, déclenchées par API/MCP/UI ou un planificateur externe déjà autorisé. Le connecteur ne promet pas de livraison future simplement parce qu'une ligne est en attente. L'interface conserve boîtes/brouillons/messages lorsque le fournisseur est absent et explique l'indisponibilité de l'envoi.

TODO de réalisation :

- [ ] Déclarer dépendance et contrat public Messagerie, provenance des messages et écritures atomiques nécessaires.
- [ ] Configurer clé/API, expéditeur autorisé et secret de signature dans le coffre.
- [ ] Adapter l'envoi Resend au port mutateur hôte et au journal/outbox commun, sans client HTTP privé.
- [ ] Implémenter lecture de statut, accusés signés, doublons, réception et reprise sans rejeu incertain.
- [ ] Raccorder widgets et panneaux existants ; six suites backend/ui/api-mcp/widgets/package/docs.
- [ ] Recette réelle avec expéditeur vérifié et destinataire de test explicitement autorisé, réception et refus intercontextes.

La tranche locale candidate couvre configuration et éligibilité Resend, snapshot texte/HTML, intention d’outbox et suivi UI sans émission. Les fixtures D1 `tests/connectors/resend-integration.test.mjs` et `tests/modules/messaging-delivery-integration.test.mjs` vérifient respectivement les droits d’éligibilité et le commit unique message/snapshot/outbox, avec refus d’un second envoi du brouillon. Elles n’appellent pas Resend. La recette fournisseur réelle est différée à la demande de l’utilisateur ; elle ne conditionne pas ces preuves locales.

Sources fournisseur vérifiées le 30 septembre : [envoi](https://resend.com/docs/api-reference/emails/send-email), [vérification des webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests). Ne pas élargir cette recette aux destinataires métier existants sans instruction.

## Contrat de livraison candidat — 30 septembre 2026

`creezio.messaging:message.send` crée en un commit D1 le message `queued`, `send_snapshot` immuable et l’intention d’outbox canonique. `send_snapshot` est indexé par `(context_id,owner_id,box_id,intentId)` et contient draft/révision, from/to/cc/bcc, sujet, texte/HTML, révision de config Resend et SHA-256. Le brouillon conserve `send_intent_id` pour refuser un second envoi de la même révision. Le corps HTTP sérialisé doit rester sous 60 KiB ; les pièces jointes entraînent un refus préalable sans modification du brouillon. L’outbox garde seulement `{kind,boxId,messageId,snapshotDigest,configRevision}` (moins de 32 KiB), provider `resend.api.v1` et `providerIdempotencyKey=intentId`; le header HTTP sera dérivé de l’intention par l’hôte.

Le manifest doit déclarer `contracts.deliveries[]` dès que le schéma SDK est intégré : `id:'mail.send.v1'`, opération émettrice `message.send`, fournisseur `{moduleId:'creezio.resend',connectorId:'resend.api.v1',resourceId:'email.send'}`, préparateur interne `message.delivery.prepare`, projecteur code `module/delivery.ts::projectDeliveryReceipt`, modèles propres autorisés `box/message/draft/send_snapshot`, schéma de reçu typé `accepted|rejected|unknown|delivered|bounced`. Le compilateur découvre cette déclaration, la dépendance facultative `creezio.resend` et son contrat public `delivery-readiness` v1. La query readiness exige `resend.use` indépendamment de `messaging.use` et ne rend que `state/from/configRevision`. L’hôte vérifie à nouveau droits, clé scellée, config et correspondance expéditeur avant l’effet.

L’exécuteur générique conserve le lease et l’identité d’origine, réclame l’intention via `claimDelivery`, appelle le transport mutateur déclaré avec `intentId` stable, puis règle `settleDelivery` avec les plans CAS produits par le projecteur. Une réponse inconnue n’est pas rejouée aveuglément. Le projecteur n’a ni route API/MCP ni credential/fetch/claim ; il transforme seulement un reçu immuable validé en changement de message. Le webhook signé/dédupliqué réutilisera la même projection pour les accusés. Rien de ce contrat candidat ne qualifie encore l’émission réelle, les fichiers R2, les accusés ni la réception.
