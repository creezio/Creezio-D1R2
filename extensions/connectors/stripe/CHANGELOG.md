# Changelog Stripe

## 0.1.0 — première lecture projetée

Configuration de clé scellée par contexte, ressources GET Stripe fixes, runs CAS et projection bornée des clients/abonnements/factures. La page Facturation d'origine est adaptée au SDK commun ; API, MCP et widget relisent les mêmes données locales. SDK ^1.4.0 requis ; disponibilité de son archive à vérifier sur la release GitHub. Aucune publication du module, mutation Stripe ou clôture de REQ-2701 n’est attestée.

Recette API Linux en mode test : configuration confirmée, trois GET paginés bornés, douze projections au total et dix statuts consultés sans réémission. La page originale a affiché quatre abonnements et quatre factures avec montants EUR déjà projetés, puis conservé l’état de connexion après rechargement. Aucun nouveau GET Stripe ni capture d’écran persistée pendant cette lecture. Sessions et runtime fermés ; release du module, autres actions de facturation, paiements, POST Stripe et webhooks restent à qualifier.
