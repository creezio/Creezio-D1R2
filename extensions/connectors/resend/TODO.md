# T29 Resend — état exact

- [x] Module candidat indépendant : configuration par contexte, clé scellée, droits admin, GET domaines projeté, query publique d’éligibilité `resend.use` et descripteur POST `/emails` déclaré sans envoi public.
- [x] Port mutateur hôte intégré ; la version 0.2.0 candidate requiert SDK 1.9.0. Composition et suites locales à qualifier avec ce couple exact.
- [x] `message.send` figé en snapshot D1 immuable et outbox canonique ; dispatch hôte borné, settlement et projection Messagerie, y compris résultat inconnu sans rejeu.
- [x] Envoi déclaré et borné de 50 pièces privées R2 / 10 Mio cumulés, avec octets dans le POST hôte et non dans l’outbox.
- [x] Accusés signés dédupliqués, rapprochement explicite et import autorisé d’un reçu sans pièce jointe, vérifiés localement.
- [x] Ingestion hôte bornée des pièces jointes entrantes vers R2 privé, liste exacte et gardes config/coffre au commit ; scénarios D1 synthétiques 0/1/50 vérifiés. Aucune recette Resend réelle.
- [ ] Qualifier le widget de statut sur ChatGPT réel.
- [ ] Recette réelle vers un destinataire test explicitement autorisé ; refus de droits, révocation, perte d’accusé et reprise contrôlée.

Le module candidat seul ne clôt ni T18 ni REQ-2901/2902.
