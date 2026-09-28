# Changelog

## 0.0.0 — candidat source T19

Tickets et messages communs entre deux audiences contrôlées, statuts, réponses locales, prise en charge personnelle, pagination, API/MCP et deux vues workspace. Aucune release ni installation déclarée.

Les vues utilisent le journal de commandes du SDK candidat 1.2.0 : persistance préalable des métadonnées, blocage des doublons après issue inconnue et vérification de statut sans réémission. Les deux layouts préservent les repères visuels du Support original compatibles avec la file locale.

Les brouillons survivent à la vérification de session lors du retour dans l'onglet. L'interface reste masquée pendant une identité non résolue ; une déconnexion confirmée ou un nouveau scope purge les états. La confirmation d'une création sélectionne le ticket réel, et celle d'une réponse ne supprime pas une saisie commencée depuis l'envoi.
