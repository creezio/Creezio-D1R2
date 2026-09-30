# T29 Hermes — exigences locales

Le module Hermes est exclusivement un client du service API officiel déjà fourni par un administrateur. Aucun processus local, sidecar, navigateur ou exécution système. Origine HTTPS explicite et clé dans le coffre de l’hôte. La configuration et l’usage ont des permissions distinctes ; chaque run doit être lié à une intention locale et à la génération de connexion. La soumission n’est permise qu’après découverte de capacité et avec idempotence durable. Une issue inconnue ne déclenche aucun nouveau run. L’arrêt demandé ne vaut pas état terminal. Le POST d’approbation et les tâches Work T17 attendent leurs contrats propres.

Source : docs/connectors/T29-HERMES.md et documentation API Server Hermes officielle.
