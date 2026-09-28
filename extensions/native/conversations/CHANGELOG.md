# Changelog

## 0.0.0 — T40, état du fournisseur dans un panneau vide

- Le panneau Conversations lit la configuration publique OpenAI pour afficher son état, y compris avant la sélection d’une conversation. Le verdict `no_provider` initial du contrôleur ne masque plus un fournisseur prêt.
- Un fournisseur manquant ou désactivé reste explicite ; une lecture incertaine, une configuration invalide ou un modèle absent de la liste autorisée n’active pas l’envoi. Aucun contrat serveur, modèle de données ou rendu du chat n’est modifié.

## 0.0.0 — T16 en qualification

- Messages à plusieurs instances de widgets MCP Apps et lecture du résultat métier durable lié à leur affichage.
- Actions distinctes : proposition de message, contexte du prochain tour, opération directe avec journal préalable et réconciliation.
- Contexte de widget privé, remplaçable et supprimable ; capture du contexte autorisé lors du démarrage du tour.
- Même hôte public du SDK dans le panneau original, le workspace et les thèmes de front. Qualification navigateur et ChatGPT suivie séparément.

## 0.0.0 — T15

- Tours OpenAI explicites avec événements persistants, arrêt et reprise ; le panneau Creezio reste commun au workspace et au front.
- Conservation des échanges déjà chargés lors des envois successifs et de la réception du message final.
- Diagnostics des outils non proposés visibles dans la zone d'état, sous forme de codes et compteurs sans identifiants inaccessibles.
- Le bouton flottant ne couvre plus l'envoi d'un panneau Conversations actif. L'arrêt sans reçu fournisseur est présenté comme incertain, sans bouton de reprise qui ferait croire à une récupération possible.
- La boucle automatique s'arrête sur un état fournisseur inconnu ; une reprise reste une action explicite.

## 0.0.0 — T14

- Contrats des conversations, messages, brouillons, tours, événements et pièces jointes privés.
- Opérations HTTP déclarées pour les audiences admin et app, contrôleur SDK commun et deux vues composables.
- Pagination bornée, recherche par titre puis contenu et état `no_provider` explicite.
