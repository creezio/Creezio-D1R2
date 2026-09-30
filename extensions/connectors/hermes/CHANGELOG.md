# Changements

## 0.1.0 — candidat T29

Connecteur Hermes externe : configuration HTTPS/coffre, droits séparés, capacités et modèles via GET, intention et soumission de run asynchrone, relecture/projection durable, arrêt demandé et invalidation par génération. Les widgets, l’approbation et la recette distante restent ouverts explicitement.

Les commandes de l’interface conservent leur clé dans l’état de panneau de la session en cas d’issue inconnue. La vérification relit le statut de cette même clé sans refaire le POST ; les autres commandes restent indisponibles jusqu’à une issue confirmée ou refusée. Le run local sélectionné est relu après réouverture du panneau.
