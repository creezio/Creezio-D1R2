# T27 — Connecteur Stripe

## Première tranche en développement

Le module optionnel reprend l'écran de facturation de Creezio : état de la connexion, clients et abonnements, factures, événements et resynchronisation. Le transport et le stockage sont adaptés au SDK commun et à D1. Aucun service Stripe n'est embarqué dans Creezio et aucune base WinHub n'est importée. Les événements restent indisponibles tant que le webhook signé n'est pas implémenté ; un MRR non calculable n'est pas fabriqué.

Le descripteur fixe l'origine `https://api.stripe.com`, la version `2026-08-26.dahlia` et les trois ressources GET clients, abonnements et factures. La clé est scellée par le coffre côté serveur. Le handler reçoit un port de lecture borné, sans clé ni URL libre. Les nouvelles options de protocole demandent le SDK 1.4 candidat ; elles préservent les déclarations n8n existantes.

Une commande lit au plus une page de huit objets, puis projette les champs utiles et le curseur dans un commit D1. Chaque objet et l'état du parcours utilisent leur comparaison de révision. La configuration et la version de clé qui ont servi au GET sont vérifiées dans ce même commit, avec les droits courants. Une erreur, une révocation ou une rotation de clé n'avance pas silencieusement le parcours. Un changement de clé crée une génération de connexion distincte : les anciennes projections quittent les listes actives et un ancien curseur ne peut pas reprendre sur un autre compte. L'interface conserve une commande incertaine dans le journal partagé et propose la lecture de son statut. La fin des pages parcourues ne prétend pas être un instantané immuable de Stripe.

Les montants gardent leurs unités mineures et leur devise. Le formatage respecte les particularités du fournisseur, notamment ISK et UGX ; un abonnement annuel, à paliers ou à l'usage ne devient pas automatiquement un montant mensuel. Les données restent dans leur contexte et les opérations de cette première tranche sont administratives.

La composition de quatorze modules dépasse les 100 000 nœuds lors de la capture de l'inventaire statique, qui contient deux copies des descripteurs validés. Cette capture dispose d'un budget explicite de 300 000 nœuds, toujours limité à 4 Mio et 24 niveaux ; le budget des entrées de requête reste inchangé. Les intégrités des descripteurs, verrous et documents restent vérifiées.

## Preuves et limites

Une clé de test existante de WinHub a été retrouvée par lecture seule, puis conservée hors dépôt sous chiffrement local. Le 29 septembre 2026, trois lectures directes limitées à un objet ont répondu HTTP 200 avec `livemode=false` sur la version fixée. La preuve opérateur `CREEZIO-T27-STRIPE-READONLY-2026-09-29.json` conserve seulement les statuts et types des réponses, sans identifiant client ni secret. Cette vérification qualifie l'accès de test, pas le module encore en développement.

REQ-2701 reste ouverte : produits/prix, Checkout, paiements, création et évolution des abonnements, événements signés, déduplication et recettes de ces effets feront l'objet de leurs propres tranches. Aucun paiement réel ni webhook n'a été créé par la vérification d'accès. La qualification du module par ses API, MCP, widget et interface reste à effectuer après intégration de cette première tranche.

Références du fournisseur : [versionnement](https://docs.stripe.com/api/versioning), [pagination](https://docs.stripe.com/api/pagination), [devises](https://docs.stripe.com/currencies). Le PRD et les exigences approuvées restent inchangés ; cette tranche en réalise une partie sans clôturer le lot.
