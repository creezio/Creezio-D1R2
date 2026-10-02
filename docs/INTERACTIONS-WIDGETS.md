# Widgets multiples et modes d'interaction

Contrat cible du 26 septembre 2026, complément du [contrat GPT](COMPATIBILITE-CHATGPT.md) et du [standard module](STANDARD-MODULE.md). Réalisation : [T-16](TODO.md#T-16), [US-16](USER-STORIES.md#US-16), exigences REQ-1604 à REQ-1607. Les recettes acquises sont suivies séparément dans [T16](IMPLEMENTATION-T16.md) et [T38](IMPLEMENTATION-T38.md) ; ce document décrit les comportements attendus.

## Un module, plusieurs widgets, plusieurs actions

Un module déclare **une collection de widgets**, pas une unique vue conversationnelle. Chaque type possède identifiant qualifié par module, version de schéma, ressources UI, données attendues, audiences et actions déclarées. Plusieurs instances d'un même type peuvent coexister dans une conversation. Le type de widget, son instance, le message, la conversation, l'objet métier et sa version sont des identités distinctes.

Exemple : un module commerce peut fournir une fiche produit, un ajout rapide au panier, une liste de résultats, un panier éditable et une confirmation de commande. L'interface d'ajout d'un article est un widget du module concerné ; elle n'impose pas de créer un module ni une base par widget. Un module de comparaison peut avoir des widgets de critères, résultats comparatifs et sélection de fournisseurs.

**Le mode est déclaré par action.** Un même formulaire peut proposer « appliquer ces filtres », « retenir ces critères » et « demander conseil dans le chat ». Son comportement n'est pas fixé globalement à un seul des trois modes. L'utilisateur ou le parcours choisit parmi les actions déclarées ; un modèle ne peut inventer un mode ou transformer une demande de conseil en achat.

## Trois effets explicites

| Mode Creezio | Intention et exemple | Effet attendu et correspondance de l'hôte |
|---|---|---|
| `message` — proposer une demande au chat | « Compare les fournisseurs selon ces critères » ou « aide-moi à vérifier ce panier ». | Construire une demande intelligible, la montrer et proposer explicitement de l'envoyer. Une action volontaire « Envoyer au chat » peut alors la transmettre via `ui/message` ; alias `window.openai.sendFollowUpMessage` seulement si disponible et approprié. La suite du tour dépend de l'hôte. |
| `context` — préparer le prochain tour | Retenir budget, quantités et sélection, pour que la prochaine demande s'appuie dessus. | Transmettre un contexte structuré autorisé par `ui/update-model-context`, sans envoyer de message ni lancer une réponse ou une opération métier. Afficher l'état retenu et permettre sa modification/retrait selon le contrat de l'hôte. |
| `direct` — traiter depuis le widget | Rechercher avec des filtres précis, calculer un récapitulatif, ajouter un article ou modifier une quantité. | Exécuter un traitement visuel local sans effet métier, ou appeler l'opération serveur autorisée via `tools/call` ; alias `window.openai.callTool` si nécessaire. Afficher le résultat dans le widget sans demander de tour LLM. Une mutation métier reste validée et persistée par le serveur. |

Les méthodes partagées sont documentées par [OpenAI : UI MCP Apps](https://developers.openai.com/plugins/build/chatgpt-ui) ; les alias spécifiques figurent dans la [référence du pont ChatGPT](https://developers.openai.com/plugins/reference). Les noms `message/context/direct` sont le vocabulaire du contrat Creezio, pas trois nouvelles méthodes du protocole MCP. Les capacités et sémantiques effectivement annoncées par l'hôte doivent être qualifiées.

Un accusé de réception du pont confirme au plus l'acceptation de la requête correspondante. Il ne prouve ni que le modèle a répondu, ni qu'une opération métier a réussi. « Contexte préparé », « message transmis », « recherche effectuée » et « commande confirmée » sont des résultats différents dans l'interface et dans les journaux.

### Navigation vers un service externe

L'ouverture d'une page externe utilise la capacité MCP Apps `openLinks` et `app.openLink({url})` lorsqu'elle est annoncée par l'hôte. C'est une capacité de navigation, pas un quatrième mode d'action métier. Le widget ne suppose ni fenêtres surgissantes, ni dialogues natifs autorisés dans son iframe. Une confirmation propre au widget se rend dans son interface ; l'hôte décide séparément d'ouvrir le lien et peut le refuser. Sans cette capacité, le widget rend le lien lisible sans prétendre l'avoir ouvert.

Le raccord natif Creezio en qualification borne les URL HTTPS et propose l'ouverture dans l'interface de l'hôte, sous la session et l'instance courantes. Il conserve le sandbox et requiert un clic explicite ; il ne télécharge pas l'URL côté serveur. Une navigation Stripe ne confirme pas un achat : le module relit ensuite la session par son opération authentifiée. L'état de réalisation et les recettes de ce raccord figurent dans [T16](IMPLEMENTATION-T16.md) et [T27](IMPLEMENTATION-T27.md).

Si le passage au clavier depuis l'iframe déclenche une relecture d'accès, l'hôte peut garder brièvement en mémoire la proposition de lien. Il ne la réaffiche qu'après une session et un catalogue frais avec le même principal, contexte, conversation, message et instance. Un nouveau geste explicite reste nécessaire pour ouvrir l'URL ; une révocation, un changement de portée ou la fermeture de la conversation annule la proposition. L'URL n'est pas conservée dans le stockage du navigateur.

## Choisir le mode selon la demande

- **Données structurées et opération déterminée** : privilégier `direct` pour les interactions usuelles d'une application. Changer une quantité ne nécessite pas de demander au LLM de réinterpréter la quantité.
- **Sélection utile pour une prochaine discussion** : utiliser `context`. Le contexte est une donnée de travail, pas une nouvelle instruction privilégiée, une autorisation ou une commande en attente d'exécution automatique.
- **Conseil, recherche ouverte ou raisonnement demandé** : proposer `message`. La proposition seule n'envoie rien ; un bouton d'envoi explicite rend son effet visible. Si l'hôte n'accepte pas le message, garder la demande consultable/copiable sans prétendre qu'elle est partie.

Une recherche fournisseur peut donc rester dans le widget par opération déterministe, préparer les critères du prochain tour, ou demander une analyse au chat. Le choix dépend du besoin et du contrat de l'action, pas du seul nom « recherche ».

Une saisie ou une validation peut se terminer entièrement dans le widget. Ne pas imposer une réponse dans le chat pour contourner l'absence d'une interaction structurée dans l'UI. Le mode `message` reste un choix utile lorsqu'une demande au chat est souhaitée, pas une étape obligatoire du parcours.

Valider un panier ne se déduit jamais d'une sélection, d'un ajout de contexte ou d'un prompt généré. L'opération de confirmation vérifie acteur, droits, contenu/version du panier, prix côté serveur, confirmation requise et idempotence. Elle peut être appelée directement depuis un widget sans LLM si le parcours de confirmation l'autorise ; le même contrôle s'applique lorsqu'un assistant demande cette opération via MCP.

## Déclaration et responsabilité de l'hôte

| Élément de contrat | Contenu à valider |
|---|---|
| Widget | Identifiant qualifié, version, ressource, schémas entrée/état/résultat, audiences et compatibilités. |
| Action | Identifiant, libellé explicite, mode, schéma d'entrée, cible opérationnelle ou contexte/message, capacités requises et repli. |
| Effets | Local visuel ou lecture/mutation serveur ; droits, confirmations, idempotence et erreur selon l'opération commune. |
| Contexte | Champs autorisés/minimisés, namespace du module et de l'instance, révision, portée conversation/acteur/surface, durée/obsolescence et remplacement/retrait. |
| Message | Demande lisible issue de données validées, aperçu/envoi volontaire, suivi proposé/transmis/refusé/incertain ; aucun succès métier déduit du texte. |
| Routage | Association vérifiée entre iframe/instance, conversation, requête/réponse et objets ; réponse tardive ne remplace pas un autre widget ou une révision plus récente. |

Le SDK valide les déclarations avant composition. L'hôte filtre les contributions selon capacités et droits, puis le serveur recontrôle l'accès lors de l'exécution. Le contrat couvre plusieurs types du même module et plusieurs modules dans le même chat.

Dans la candidate SDK 1.5, `widgetCalls` rattache un outil d'opération à plusieurs actions directes de widgets sans lui attribuer le rendu initial `widget`. Les lectures privées d'images utilisent l'opt-in `linkedRead.mcpImage` de la catégorie de fichiers et les mêmes preuves de lecture liée. Leur résultat `_meta` transitoire n'est ni un contexte pour le prochain tour, ni un état persistant, ni un résultat métier à envoyer au modèle. Voir [le contrat GPT](COMPATIBILITE-CHATGPT.md#lectures-privées-réservées-au-composant).

## Chat interne Creezio

L'hôte Creezio fournit les mêmes trois comportements à la même partie plugin, dans le workspace et le front autorisés. Il adapte le pont MCP Apps au moteur de conversations, sans nouveau handler métier propre au chat.

Pour `message`, l'hôte propose la demande, conserve l'attribution au composant et n'envoie qu'après l'action volontaire prévue. Il ne soumet pas silencieusement un texte sous l'identité de l'utilisateur. Dans ChatGPT, Creezio peut fournir son aperçu et demander l'envoi ; il ne promet pas de contrôler le champ de saisie natif ou le lancement du modèle.

Pour `context`, l'hôte Creezio gère un contexte borné par instance, version et conversation, intégré au prochain tour autorisé. Remplacer une sélection ne doit pas empiler indéfiniment les versions anciennes. Enlever un contexte l'exclut des tours futurs ; cela n'efface pas ce qui a déjà été utilisé dans un tour précédent. Révocation/changement de session empêchent sa réutilisation indue. Un autre widget ne peut pas écraser le contexte d'un module sans passer par le contrat autorisé. La persistance propre à l'UI ne remplace ni ce contexte ni les données métier D1/R2.

Pour `direct`, l'hôte route l'appel vers l'opération commune et affiche son résultat faisant autorité, même sans LLM configuré. Une action directe peut ensuite publier un contexte révisé si sa déclaration le prévoit ; elle ne déclenche pas automatiquement un message. Dans le mode sans LLM, les écrans et opérations directes restent utilisables ; demander une réponse IA explique l'absence de fournisseur au lieu de l'inventer.

## Refus, capacités absentes et reprises

Détecter les capacités annoncées, pas le nom du produit hôte. Une méthode absente produit un état explicite et un repli fidèle : contexte conservé localement comme **non transmis**, texte à copier ou action indisponible. Ne pas convertir silencieusement `context` en `message`, ni un message échoué en appel d'achat.

Un timeout peut laisser l'effet inconnu. Distinguer erreur confirmée et résultat incertain ; relire l'état ou utiliser l'identifiant de requête/idempotence avant relance. Un verrou de bouton évite des clics rapprochés, mais ne garantit pas l'absence de double effet serveur. Il ne faut pas appeler successivement le pont standard et son alias après un timeout au risque de doubler le même envoi.

Utiliser le pont commun qualifié : validation de provenance des messages iframe, corrélation, délais, limites de contenu et libération des handlers. Ni secrets, ni accès D1/R2 directs, ni données d'un autre acteur dans les messages ou contextes. Les données fournies par le widget ne deviennent pas des instructions système.

## Recette obligatoire

Les suites `widgets`, `ui`, `api-mcp`, `backend`, `package` et `docs` couvrent leurs responsabilités respectives :

1. Deux types de widgets du même module, deux instances d'un même type et un autre module dans une conversation ; aucune confusion d'actions, d'état, de réponse tardive ou de contexte.
2. Message proposé : aucun envoi avant l'action volontaire ; transmission/refus/timeout correctement affichés ; aucune commande validée par la simple proposition.
3. Contexte modifié, remplacé puis retiré : aucun tour LLM ou effet métier déclenché ; prochain tour avec le bon contexte autorisé, pas l'ancien ni celui d'une autre conversation.
4. Action directe de lecture puis de mutation : résultat dans le widget sans tour LLM ; droits, version périmée, approbation et double clic vérifiés côté serveur, même via MCP direct.
5. Une action directe met à jour l'objet partagé ; un autre widget peut le relire sans perdre son propre brouillon. Une ancienne confirmation est invalidée si les données pertinentes du panier changent.
6. Hôte sans une capacité, sans LLM, hors ligne, après révocation et lors d'une reprise : aucun repli changeant silencieusement l'effet demandé ; état incertain visible.
7. Exécuter ces parcours dans le chat Creezio puis dans ChatGPT. Tests de pont simulé utiles pour les refus et la corrélation, mais insuffisants pour déclarer la compatibilité réelle.
