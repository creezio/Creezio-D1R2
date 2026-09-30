# Changelog Stripe

## 0.2.1 — périodicités françaises

La vue Prix affiche les intervalles Stripe connus en français, au singulier et au pluriel. Une valeur inconnue ou incomplète reste signalée sans fréquence inventée. Montants, identifiants, requêtes et projections demeurent ceux de 0.2.0.

## 0.2.0 — produits et prix en lecture

Deux onglets dans la page Facturation existante, deux projections contextuelles et trois nouveaux parcours GET fixes pour produits, prix actifs et prix inactifs. L'état catalogue est additif et réutilise le moteur CAS, la génération de connexion, le journal et les sorties API/MCP/widget ; les anciennes tables et données restent inchangées. Les montants variables et les relations à un produit non projeté sont affichés sans calcul fictif. Cette source n'atteste ni accès fournisseur réel pour ces deux collections, ni publication, Checkout, paiement ou webhook.

## 0.1.0 — première lecture projetée

Configuration de clé scellée par contexte, ressources GET Stripe fixes, runs CAS et projection bornée des clients/abonnements/factures. La page Facturation d'origine est adaptée au SDK commun ; API, MCP et widget relisent les mêmes données locales. SDK ^1.4.0 requis ; disponibilité de son archive à vérifier sur la release GitHub. Aucune publication du module, mutation Stripe ou clôture de REQ-2701 n’est attestée.

Recette API Linux en mode test : configuration confirmée, trois GET paginés bornés, douze projections au total et dix statuts consultés sans réémission. La page originale a affiché quatre abonnements et quatre factures avec montants EUR déjà projetés, puis conservé l’état de connexion après rechargement. Aucun nouveau GET Stripe ni capture d’écran persistée pendant cette lecture. Sessions et runtime fermés ; release du module, autres actions de facturation, paiements, POST Stripe et webhooks restent à qualifier.
