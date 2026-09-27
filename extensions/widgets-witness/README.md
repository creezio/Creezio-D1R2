# T16 — module témoin Widgets MCP Apps

`example.widgets-witness` est un module standard optionnel de recette, hors composition par défaut. Il reprend un modèle `record` versionné et ses opérations communes de lecture et renommage. Aucun handler métier n'est propre au widget et aucune donnée n'est créée au démarrage.

Deux types de widget (`record-card`, `record-picker`) peuvent produire plusieurs instances d'une fiche dans un chat. Chaque type expose `message` avec aperçu puis geste d'envoi, `context` pour le prochain tour et `direct` via les outils MCP de lecture. La fiche ajoute un renommage direct versionné et idempotent. Leurs ressources HTML sont compilées et liées aux outils par une URI `ui://` contenant version et SHA-256. L'hôte n'offre que les capacités annoncées ; un ACK du pont ne prouve ni réponse IA ni mutation métier.

Le module conserve aussi ses vues workspace/front de témoin pour observer deux fiches `alpha` et `beta` avec brouillons distincts. Elles passent par le même DataPort et les mêmes opérations. Le test synthétique ne qualifie pas à lui seul le navigateur, l'hébergement Sites, Cloudflare ou ChatGPT réel. La composition de recette, le lock et les données synthétiques sont fournis par l'hôte de qualification, sans inclusion forcée dans l'application courante.

Exécuter `node gate.mjs` depuis ce dossier pour les six suites du module. Aucun compte, secret, binding D1/R2, proxy sandbox ou permission implicite ne figure dans les ressources UI.
