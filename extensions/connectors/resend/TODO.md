# T29 Resend — état exact

- [x] Module candidat indépendant : configuration par contexte, clé scellée, droits admin, GET domaines projeté, query publique d’éligibilité `resend.use` et descripteur POST `/emails` déclaré sans envoi public.
- [ ] Intégrer le port mutateur B et qualifier la composition/les six suites sur le SDK 1.6 final.
- [ ] Raccorder `message.send` à un snapshot D1 immuable et à l’outbox canonique ; dispatch hôte borné, settlement et projection Messagerie, y compris résultat inconnu.
- [ ] Ajouter un transport de pièces jointes privées R2 déclaré et borné ; le JSON 64 KiB actuel ne couvre pas les fichiers.
- [ ] Raccorder accusés signés/déduplication et réception autorisée au moteur canonique, puis widget de statut fidèle.
- [ ] Recette réelle vers un destinataire test explicitement autorisé ; refus de droits, révocation, perte d’accusé et reprise contrôlée.

Le module candidat seul ne clôt ni T18 ni REQ-2901/2902.
