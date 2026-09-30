# Suivi Stripe

La première tranche T27 fournit la source du module 0.1.0, six suites, l’écran administratif original adapté, API/MCP et widget de lecture. La recette API Linux en mode test a confirmé connexion, une page des trois collections et douze projections ; le navigateur a affiché quatre abonnements et quatre factures avec montants EUR concordants, puis conservé l’état de connexion après reload. Aucun autre appel fournisseur ou paiement n’a été exercé pendant cette recette visuelle. Le paquet et la publication du module restent à qualifier ; les tests simulés ne sont pas présentés comme accès fournisseur réel.

La candidate 0.2.0 ajoute les lectures/projections produits et prix actifs/inactifs dans la même Facturation, avec état catalogue additif. Les suites ciblées, la composition du schéma et la recette D1 synthétique passent ; la recette sur Stripe en mode test reste à faire. Les preuves de la tranche 0.1.0 ne qualifient pas ces nouveaux parcours.

Restent ouverts pour REQ-2701 : gestion mutatrice des produits/prix, Checkout, mutations d'abonnements, outbox/idempotence distantes, webhook signé/dédupliqué, paiement de test, images/notifications et publication d'application. Aucune clé n'est conservée dans ce dépôt.
