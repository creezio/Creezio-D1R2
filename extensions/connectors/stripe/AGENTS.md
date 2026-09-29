# Périmètre du connecteur Stripe

Respecter `docs/STANDARD-MODULE.md`, REQ-2701 et le contrat de première tranche T27. Toutes les lectures externes passent par le port GET déclaré ; aucun `fetch` métier, POST Stripe, webhook, paiement, flotte ou valeur de clé dans les réponses. Une page distante maximum par commande, journal et CAS du run/projections obligatoires. Garder six suites et distinguer la recette fournisseur réelle des tests simulés.
