# Changements

## 0.1.1 — widgets de lecture T29

Trois widgets MCP Apps affichent les capacités, modèles et état d’un run local dans les deux surfaces de chat. Leurs actions directes relisent seulement les requêtes déjà déclarées sous les droits courants ; le rendu vérifie l’instance et l’audience et ignore les réponses tardives. Une issue inconnue ne déclenche aucune nouvelle soumission. L’approbation fournisseur et la recette distante restent ouvertes.

Le rendu initial du chat transporte sa référence d’instance hôte. Les lectures directes reconnaissent les enveloppes distinctes du chat interne et de MCP externe ; une relecture externe doit conserver l’audience, la ressource et le run local attendus.

## 0.1.0 — candidat T29

Connecteur Hermes externe : configuration HTTPS/coffre, droits séparés, capacités et modèles via GET, intention et soumission de run asynchrone, relecture/projection durable, arrêt demandé et invalidation par génération. À cette version, les widgets, l’approbation et la recette distante restaient ouverts.

Les commandes de l’interface conservent leur clé dans l’état de panneau de la session en cas d’issue inconnue. La vérification relit le statut de cette même clé sans refaire le POST ; les autres commandes restent indisponibles jusqu’à une issue confirmée ou refusée. Le run local sélectionné est relu après réouverture du panneau.
