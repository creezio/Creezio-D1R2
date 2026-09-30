# Décisions et points ouverts

- Décision du 28 septembre 2026 : instance n8n externe URL + clé API, sans installation, maintenance ou moteur de planification Creezio.
- Tranche autorisée : configuration/coffre, lectures et déclenchement par webhook de production avec intention durable et suivi corrélé. Les règles T24 attendent une validation explicite.
- À valider en recette réelle : URL et clé d’une instance n8n autorisée, scopes n8n disponibles, comportement de pagination et réponses sur cette version. Aucune clé de test inventée.
- À spécifier ultérieurement : callback signé propre au workflow, publish/unpublish, stop/retry/delete et recette réelle. Le webhook de production exige une clé distincte de l’API ; les tokens machine Creezio entrants restent indépendants de ces deux clés.
