# Décisions de périmètre

- Original conservé : cartes Facturation, liste clients/abonnements, factures, événements et bouton « Resynchroniser Stripe ».
- Données réellement raccordées : clients, abonnements, factures et états de parcours projetés ; cartes MRR et événements restent explicitement indisponibles.
- Une commande = une page GET Stripe, huit objets maximum, puis CAS D1 ; `partial` n'est pas « synchronisé ».
- URL, version Stripe, méthodes et paramètres sont figés par le descripteur ; clé dans le coffre par contexte.
- Pas de flotte `host_id`, d'email ou adresse dans la projection, de POST fournisseur, de webhook ou de paiement dans cette tranche.
