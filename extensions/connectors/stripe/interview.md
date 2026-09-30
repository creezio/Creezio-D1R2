# Décisions de périmètre

- Original conservé : cartes Facturation, liste clients/abonnements, factures, événements et bouton « Resynchroniser Stripe ».
- Données réellement raccordées : clients, abonnements, factures et états de parcours projetés ; cartes MRR et événements restent explicitement indisponibles.
- Une commande = une page GET Stripe, huit objets maximum, puis CAS D1 ; `partial` n'est pas « synchronisé ».
- URL, version Stripe, méthodes et paramètres sont figés par le descripteur ; clé dans le coffre par contexte.
- Pas de flotte `host_id`, d'email ou adresse dans la projection, de POST fournisseur, de webhook ou de paiement dans cette tranche.
- Produits et prix s'ajoutent dans la même page Facturation ; l'écran original n'avait pas ces deux sections. Deux parcours prix distinguent actifs et inactifs, sans prix inline.
- L'état des trois parcours historiques garde son `CHECK` SQL ; un état catalogue additif sert produits et prix avec le même moteur CAS et le même journal.
- Le prix conserve `product_id` sans clé étrangère locale : le produit peut ne pas encore figurer dans une page projetée. Aucun montant variable n'est affiché comme une charge fixe.
