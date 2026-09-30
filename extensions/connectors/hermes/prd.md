# T29 Hermes — exigences locales

Le module Hermes est exclusivement un client du service API officiel déjà fourni par un administrateur. Aucun processus local, sidecar, navigateur ou exécution système. Origine HTTPS explicite et clé dans le coffre de l’hôte. La configuration et l’usage ont des permissions distinctes ; chaque run doit être lié à une intention locale et à la génération de connexion. La soumission n’est permise qu’après découverte de capacité et avec idempotence durable. Une issue inconnue ne déclenche aucun nouveau run. L’arrêt demandé ne vaut pas état terminal. Le POST d’approbation et les tâches Work T17 attendent leurs contrats propres.

Les widgets MCP Apps de capacités, modèles et suivi d’un run reprennent les cartes existantes. Ils ciblent seulement des requêtes déjà autorisées, sous la session, l’audience, le contexte et l’instance courants ; aucune action directe ne crée, n’arrête ou n’approuve un run. Une issue incertaine conserve la commande d’origine pour inspection sans réémission.

Source : docs/connectors/T29-HERMES.md et documentation API Server Hermes officielle.
