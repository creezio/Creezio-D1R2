# Changelog

## 0.0.0 — candidat source T19

Tickets et messages communs entre deux audiences contrôlées, statuts, réponses locales, prise en charge personnelle, pagination, API/MCP et deux vues workspace. Aucune release ni installation déclarée.

Les vues utilisent le journal de commandes du SDK public depuis 1.2.0 : persistance préalable des métadonnées, blocage des doublons après issue inconnue et vérification de statut sans réémission. Les deux layouts préservent les repères visuels du Support original compatibles avec la file locale.

Les brouillons survivent à la vérification de session lors du retour dans l'onglet. L'interface reste masquée pendant une identité non résolue ; une déconnexion confirmée ou un nouveau scope purge les états. La confirmation d'une création sélectionne le ticket réel, et celle d'une réponse ne supprime pas une saisie commencée depuis l'envoi.

Quatre widgets MCP Apps ajoutent la liste et le fil, chacun décliné pour app et admin. Les commandes directes reprennent les dix opérations existantes, avec des alias de lecture pour les cartes ; aucun modèle ni SQL n'est ajouté. Le pont natif conserve sa clé avant envoi ; l'hôte externe reçoit une protection de session conservatrice et n'émet jamais de commande au montage. Cette version source n'atteste pas encore une recette navigateur/MCP externe des nouvelles cartes.

Les widgets exigent le correctif candidat SDK 1.4.1 du champ d'idempotence et le Core correspondant ; le SDK public 1.4.0 reste inchangé jusqu'à une publication distincte.
