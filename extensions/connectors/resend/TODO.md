# T29 Resend — état exact

- [x] Module candidat indépendant : configuration par contexte, clé scellée, droits admin, GET domaines projeté, query publique d’éligibilité `resend.use` et descripteur POST `/emails` déclaré sans envoi public.
- [x] Port mutateur hôte intégré, manifeste compatible SDK 1.8 ; composition et suites locales vérifiées. Qualification CI finale à confirmer.
- [x] `message.send` figé en snapshot D1 immuable et outbox canonique ; dispatch hôte borné, settlement et projection Messagerie, y compris résultat inconnu sans rejeu.
- [x] Envoi déclaré et borné de 50 pièces privées R2 / 10 Mio cumulés, avec octets dans le POST hôte et non dans l’outbox.
- [x] Accusés signés dédupliqués, rapprochement explicite et import autorisé d’un reçu sans pièce jointe, vérifiés localement.
- [ ] Ajouter l’ingestion hôte bornée des pièces jointes entrantes vers R2 privé ; l’import les refuse intégralement jusque-là. Qualifier ensuite le widget de statut sur ChatGPT réel.
- [ ] Recette réelle vers un destinataire test explicitement autorisé ; refus de droits, révocation, perte d’accusé et reprise contrôlée.

Le module candidat seul ne clôt ni T18 ni REQ-2901/2902.
