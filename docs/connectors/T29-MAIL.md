# PRD T29-MAIL — transports de messagerie externes

REQ-2901/2902 ; US-29 et messagerie T18. Premier fournisseur HTTP : Resend, dont les comportements existent dans la messagerie Creezio de référence. Les autres passerelles SMTP/IMAP restent externes ; aucune bibliothèque de connexion persistante ni scheduler ne devient une dépendance du socle.

Messagerie demeure propriétaire des boîtes, messages, brouillons et fichiers partagés entre workspace et front selon les droits. Le connecteur est propriétaire de sa configuration, des références de secrets et des identifiants/états fournisseur. Il consomme les contrats publics de Messagerie et ne réplique pas son modèle métier.

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

Sources fournisseur vérifiées le 30 septembre : [envoi](https://resend.com/docs/api-reference/emails/send-email), [vérification des webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests). Ne pas élargir cette recette aux destinataires métier existants sans instruction.
