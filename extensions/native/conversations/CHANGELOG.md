# Changelog

## 0.0.0 — T14/T16, lecture du brouillon avant saisie (correctif candidat)

- Le panneau attend la lecture du brouillon du fil sélectionné avant d’activer la saisie et l’envoi. Une lecture refusée ou incomplète ne fabrique plus une révision 0 et ne peut plus écrire à la place d’un brouillon D1 existant.
- Le texte local reste lié au fil et reprend après une relecture réussie avec la révision courante. Les tests ciblés couvrent lecture différée, refus, aller-retour entre fils et absence d’écriture ou de nouveau tour avant hydratation. Aucun schéma, droit, opération ou transport fournisseur ne change.

## 0.0.0 — T09, reprise du fil après rechargement (correctif candidat)

- Si une transition d’accès ou d’activité interrompt la lecture après affichage du titre, le contrôleur relit le fil sélectionné sous la session et le contexte courants pour restaurer messages et brouillon. Une nouvelle sélection explicite garde la priorité ; aucune opération métier ni appel au fournisseur n’est rejoué.
- Le panneau charge les pièces jointes après cette restauration. Les tests ciblés reproduisent l’interruption des lectures et la reprise. La recette sur Original hébergé reste distincte de ce correctif local.

## 0.0.0 — T27, ouverture de lien MCP Apps dans l’hôte

- Le pont interne annonce `openLinks` quand Conversations fournit une confirmation native. Il accepte une URL HTTPS absolue et bornée, refuse identifiants intégrés et caractères de contrôle, puis vérifie encore l’instance et la session après la décision.
- Le panneau affiche l’URL dans son propre DOM ; seul un clic explicite sur l’ancre de l’hôte ouvre un nouvel onglet. Annulation, expiration, changement de session et démontage refusent la demande. La sandbox reste inchangée. Le pont n’est pas un export du paquet SDK public et aucun contrat serveur Conversations ne change.

## 0.0.0 — T16, reprise d'un contexte retiré (correctif local)

- La lecture d'un contexte de widget retiré conserve sa révision et signale `removed: true` avec une valeur nulle. Une nouvelle sélection peut ainsi remplacer la ligne retirée avec sa vraie révision, sans conflit artificiel.
- La lecture reste soumise à l'instance, à l'action courante, à l'audience, aux droits et aux validateurs ; un contexte retiré ou expiré n'est pas transmis au modèle. Les tests D1 couvrent retrait, lecture et reprise. La livraison et la recette hébergée restent à faire.

## 0.0.0 — T16, statut après retrait du contexte

- L'hôte affiche « Contexte retiré pour les prochains tours » quand le contrôleur confirme le retrait. Il conserve les états de remplacement, refus et résultat incertain. Le service et le contrat de contexte ne changent pas.

## 0.0.0 — T15/T16, diagnostic du catalogue d'outils

- Le panneau distingue les outils omis par nombre ou taille et la borne d'inspection du catalogue, sans révéler les noms d'opérations refusées.
- Une reprise du même tour utilise le dernier snapshot de diagnostics ; elle n'additionne pas plusieurs fois les mêmes omissions. L'interface et l'historique existants sont conservés.

## 0.0.0 — T40, historique des widgets après mise à jour

- La requête protégée `widget.render.read` retrouve le résultat durable d’une instance depuis son message natif et laisse l’hôte vérifier l’exécution, le propriétaire, l’acteur, l’audience, le contexte et les droits actuels. Le panneau utilise le renderer courant uniquement si sa compatibilité est déclarée ; aucune ancienne ressource HTML ni opération métier n’est rejouée.
- Les contextes enregistrés conservent la version de leur instance et ne sont réinjectés qu’après validation des champs conservés par l’action courante. Les commandes incertaines et approbations anciennes restent bloquées si leur contrat a changé.

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
