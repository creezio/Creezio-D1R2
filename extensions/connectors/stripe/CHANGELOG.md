# Changelog Stripe

## 0.6.0 — candidate d’évolution d’un abonnement TEST

`subscription.plan.set` remplace le prix et la quantité (1–100) de l’unique item d’un abonnement actif TEST. Prix fixe récurrent actif, même devise et même intervalle, projection et génération courantes, `stripe.manage`, révision CAS et clé de demande sont obligatoires. Le POST fixe `proration_behavior=none` et `payment_behavior=error_if_incomplete` ; aucun prorata ni facture immédiate n’est demandé. Une réponse incohérente ou une issue réseau inconnue ne déclenche pas de second POST. La Facturation originale expose ce choix dans la ligne d’abonnement. L’identifiant d’item ajouté à la projection est nullable pour les lignes antérieures : elles exigent une synchronisation native avant cette mutation. Aucun changement d’intervalle, abonnement multi-items, action app, mode live ni tarification Stripe n’est introduit. Tests locaux et schéma central seulement ; recette fournisseur et publication distinctes.

## 0.5.0 — candidate d’achat d’offres Stripe en audience app

Une offre administrée lie un produit et un prix Stripe projetés, actifs, fixes et TEST de la même génération. L’app découvre les offres éligibles et crée un Checkout avec `offerId` et `requestKey` seuls : prix, quantité unitaire, identité et retour sont choisis côté serveur. La session D1 porte le principal propriétaire, l’offre et sa révision ; la lecture app vérifie cette propriété avant le GET fournisseur. Le webhook signé rapproche le client et l’abonnement de cette seule session. Les Checkout et abonnements administratifs antérieurs ne deviennent pas lisibles par l’app. Le retour app utilise le chemin local administré `checkoutAppReturnPath`, par défaut `/offers`. Les droits `stripe.purchase` et `stripe.purchase.read` restent séparés de la gestion. Cette tranche ne fournit ni Catalogue/panier, ni mode live, ni mutation d’abonnement client ; les tests locaux ne valent pas recette Stripe fournisseur de 0.5.

## 0.4.0 — candidate de réversibilité de l’arrêt programmé

Ajout non cassant de `subscription.cancel.set` (`cancelAtPeriodEnd` booléen) sur le POST Stripe déclaré, avec refus d’un état projeté identique, terminé, hors génération, live ou sans révision courante. L’état de retour est vérifié avant le CAS D1 ; le journal commun garde les issues inconnues sans nouveau POST. `subscription.cancel.schedule` demeure inchangé. UI/API/MCP admin sont raccordés au même contrat ; aucun tarif, quantité, abonnement déjà résilié, port app ou mode live n’est ajouté. Tests locaux seulement ; publication et recette fournisseur de cette version restent à qualifier. Voir [Stripe — arrêter ou retirer un arrêt programmé](https://docs.stripe.com/billing/subscriptions/cancel).

## 0.3.1 — correction du contrat de réception signée

`webhook.receive` est déclaré sur `connector_config`, `stripe_event` et `stripe_checkout`, les trois modèles utilisés par son handler. Le coffre garde ses permissions propres : le jeton machine dédié ne reçoit aucun droit général de lecture ou gestion. Le garde hôte de ses références est limité à la préparation d'une lecture conditionnelle ; un échec de construction après le claim clôt l'exécution en échec au lieu de laisser un `running` orphelin. Le test local exerce un POST signé jusqu'au commit D1 et le refus après révocation de la configuration webhook. La version est livrée et un nouvel événement réel signé a été projeté ; le reçu 0.3.0 resté inconnu n'est pas déclaré réparé et sa redélivrance reste ouverte.

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
