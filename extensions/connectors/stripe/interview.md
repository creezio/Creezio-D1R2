# Décisions de périmètre

- Original conservé : cartes Facturation, liste clients/abonnements, factures, événements et bouton « Resynchroniser Stripe ».
- Données réellement raccordées : clients, abonnements, factures et états de parcours projetés ; cartes MRR et événements restent explicitement indisponibles.
- Une commande = une page GET Stripe, huit objets maximum, puis CAS D1 ; `partial` n'est pas « synchronisé ».
- URL, version Stripe, méthodes et paramètres sont figés par le descripteur ; clé dans le coffre par contexte.
- La première tranche n’avait ni POST fournisseur, ni webhook, ni paiement ; les tranches suivantes ont ajouté Checkout test, webhook signé et arrêt programmé réversible. Le périmètre courant n’ajoute ni flotte `host_id`, ni email/adresse dans la projection, ni mode live.
- Produits et prix s'ajoutent dans la même page Facturation ; l'écran original n'avait pas ces deux sections. Deux parcours prix distinguent actifs et inactifs, sans prix inline.
- L'état des trois parcours historiques garde son `CHECK` SQL ; un état catalogue additif sert produits et prix avec le même moteur CAS et le même journal.
- Le prix conserve `product_id` sans clé étrangère locale : le produit peut ne pas encore figurer dans une page projetée. Aucun montant variable n'est affiché comme une charge fixe.
- La tranche 0.5 expose une offre Stripe administrée, fondée sur un produit et un prix fixes TEST projetés. Un client app n'envoie que `offerId` et sa clé de demande ; identité, prix, quantité 1 et retour viennent du serveur. Le principal et la révision d'offre restent liés à sa session.
- Le retour app suit un chemin local administré, `/offers` par défaut ; ni ce retour ni un e-mail ne prouvent la propriété ou le paiement. Les sessions administratives historiques n'ont pas de propriétaire app. Catalogue, panier, abonnement client modifiable et mode live demandent leurs tranches distinctes.
