# T27 — Connecteur Stripe

## Première tranche de lecture et projection

Le module optionnel reprend l'écran de facturation de Creezio : état de la connexion, clients et abonnements, factures, événements et resynchronisation. Le transport et le stockage sont adaptés au SDK commun et à D1. Aucun service Stripe n'est embarqué dans Creezio et aucune base WinHub n'est importée. Les événements restent indisponibles tant que le webhook signé n'est pas implémenté ; un MRR non calculable n'est pas fabriqué.

Le descripteur fixe l'origine `https://api.stripe.com`, la version `2026-08-26.dahlia` et les trois ressources GET clients, abonnements et factures. La clé est scellée par le coffre côté serveur. Le handler reçoit un port de lecture borné, sans clé ni URL libre. Les nouvelles options de protocole demandent SDK ^1.4.0 et préservent les déclarations n8n existantes. La disponibilité de l’archive se vérifie sur la release GitHub du SDK.

Une commande lit au plus une page de huit objets, puis projette les champs utiles et le curseur dans un commit D1. Chaque objet et l'état du parcours utilisent leur comparaison de révision. La configuration et la version de clé qui ont servi au GET sont vérifiées dans ce même commit, avec les droits courants. Une erreur, une révocation ou une rotation de clé n'avance pas silencieusement le parcours. Un changement de clé crée une génération de connexion distincte : les anciennes projections quittent les listes actives et un ancien curseur ne peut pas reprendre sur un autre compte. L'interface conserve une commande incertaine dans le journal partagé et propose la lecture de son statut. La fin des pages parcourues ne prétend pas être un instantané immuable de Stripe.

Les montants gardent leurs unités mineures et leur devise. Le formatage respecte les particularités du fournisseur, notamment ISK et UGX ; un abonnement annuel, à paliers ou à l'usage ne devient pas automatiquement un montant mensuel. Les données restent dans leur contexte et les opérations de cette première tranche sont administratives.

La composition de quatorze modules dépasse les 100 000 nœuds lors de la capture de l'inventaire statique, qui contient deux copies des descripteurs validés. Cette capture dispose d'un budget explicite de 300 000 nœuds, toujours limité à 4 Mio et 24 niveaux ; le budget des entrées de requête reste inchangé. Les intégrités des descripteurs, verrous et documents restent vérifiées.

## Preuves et limites

Une clé de test existante de WinHub a été retrouvée par lecture seule, puis conservée hors dépôt sous chiffrement local. Le 29 septembre 2026, trois lectures directes limitées à un objet ont répondu HTTP 200 avec `livemode=false` sur la version fixée. La preuve opérateur `CREEZIO-T27-STRIPE-READONLY-2026-09-29.json` conserve seulement les statuts et types des réponses, sans identifiant client ni secret. Cette vérification qualifie l’accès de test, distincte de la recette du module.

La recette API Linux du module, sur clé Stripe en mode test, a confirmé quatre étapes de configuration (révision finale 3), puis un démarrage et une page explicite pour chacune des trois collections. Les trois GET bornés à huit objets ont projeté quatre clients, quatre abonnements et quatre factures ; chaque parcours s’est terminé à pages_exhausted, révision 2. Dix lectures de statut ont retrouvé les commandes confirmées sans les réémettre. Les quatre factures observées étaient en EUR et testonly. Cette preuve ne concerne pas un compte live.

La recette navigateur du candidat 4148c60 a repris l’interface originale, affiché quatre abonnements et quatre factures et comparé les montants EUR aux projections locales. La section Connexion et son état sont restés visibles après rechargement. L’inspection visuelle n’a fait aucun nouveau GET Stripe ni testé d’autre action de facturation ; aucune capture n’a été conservée. Les sessions ont été déconnectées et le runtime arrêté, données préservées. Voir le reçu hors dépôt CREEZIO-T27-LINUX-UI-RECIPE-4148C60-2026-09-29.json.

REQ-2701 reste ouverte : produits/prix, Checkout, paiements, création et évolution des abonnements, événements signés, déduplication et recettes de ces effets nécessitent leurs propres tranches. La publication du module, les profils hébergés et l’adoption par une application restent à qualifier séparément. Les preuves API, MCP, widget, D1 et navigateur de cette première tranche ne les remplacent pas.

Références du fournisseur : [versionnement](https://docs.stripe.com/api/versioning), [pagination](https://docs.stripe.com/api/pagination), [devises](https://docs.stripe.com/currencies). Le PRD et les exigences approuvées restent inchangés ; cette tranche en réalise une partie sans clôturer le lot.
