# Changelog Stripe

## 0.3.0 — candidate Checkout test et événements signés

La réception signée possède le droit machine distinct `creezio.stripe:webhook.receive`. Il couvre seulement les modèles lus ou écrits par `event.receive` ; il ne confère ni gestion Stripe, ni création Checkout, ni gestion des clés. Le texte de configuration du jeton dans l'interface indique ce droit dédié. La qualification Stripe réelle reste ouverte.

Création de sessions Checkout de paiement ou d'abonnement, lecture de leur état, arrêt d'abonnement en fin de période et réception des événements Stripe signés. Ces fonctions reprennent la page Facturation et les mêmes opérations API/MCP. Deux projections D1, `stripe_checkout` et `stripe_event`, complètent les neuf modèles précédents. Le coffre conserve séparément la clé Stripe, les secrets webhook courant/précédent et le jeton machine Creezio.

Les mutations de cette candidate acceptent uniquement le mode test. Le journal fournit l'idempotence et conserve une issue inconnue sans second envoi ; les événements reçus vérifient les droits, la signature et la configuration jusqu'au commit. Les tests locaux couvrent le moteur D1 avec transport simulé. Paiement et webhook Stripe réels, mode live, autres mutations du catalogue et du cycle d'abonnement, paquet final et publication restent à qualifier. SDK ^1.6.0 candidat requis.

## 0.2.1 — périodicités françaises

La vue Prix affiche les intervalles Stripe connus en français, au singulier et au pluriel. Une valeur inconnue ou incomplète reste signalée sans fréquence inventée. Montants, identifiants, requêtes et projections demeurent ceux de 0.2.0.

## 0.2.0 — produits et prix en lecture

Deux onglets dans la page Facturation existante, deux projections contextuelles et trois nouveaux parcours GET fixes pour produits, prix actifs et prix inactifs. L'état catalogue est additif et réutilise le moteur CAS, la génération de connexion, le journal et les sorties API/MCP/widget ; les anciennes tables et données restent inchangées. Les montants variables et les relations à un produit non projeté sont affichés sans calcul fictif. Cette source n'atteste ni accès fournisseur réel pour ces deux collections, ni publication, Checkout, paiement ou webhook.

## 0.1.0 — première lecture projetée

Configuration de clé scellée par contexte, ressources GET Stripe fixes, runs CAS et projection bornée des clients/abonnements/factures. La page Facturation d'origine est adaptée au SDK commun ; API, MCP et widget relisent les mêmes données locales. SDK ^1.4.0 requis ; disponibilité de son archive à vérifier sur la release GitHub. Aucune publication du module, mutation Stripe ou clôture de REQ-2701 n’est attestée.

Recette API Linux en mode test : configuration confirmée, trois GET paginés bornés, douze projections au total et dix statuts consultés sans réémission. La page originale a affiché quatre abonnements et quatre factures avec montants EUR déjà projetés, puis conservé l’état de connexion après rechargement. Aucun nouveau GET Stripe ni capture d’écran persistée pendant cette lecture. Sessions et runtime fermés ; release du module, autres actions de facturation, paiements, POST Stripe et webhooks restent à qualifier.
