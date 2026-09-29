# PRD local — Stripe T27

Source : `docs/EXIGENCES.md#REQ-2701`, `docs/USER-STORIES.md#US-27` et écran original `packages/admin/ui/billing-admin-client.tsx` au commit `6bd6507`. Première tranche indépendante : connexion clé scellée, trois lectures GET déclarées, projection D1 bornée par contexte, UI admin, API/MCP et widget d'état. Le bouton de resynchronisation ne lance aucun paiement ; chaque page utilise un commit CAS et une clé de demande durable. La page rend les résultats partiels honnêtement.

REQ-2701 complet exige encore produits/prix, Checkout et cycle d'abonnement, webhooks signés, événements, paiement de test et leurs recettes réelles. Ces étapes nécessitent un contrat de mutation distante/idempotence et un secret webhook distinct ; elles ne sont pas simulées ici. Aucun calcul MRR ou division uniforme des monnaies n'est autorisé dans cette tranche.
