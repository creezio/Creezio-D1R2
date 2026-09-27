# PRD — témoin T16

Le module vérifie la jonction T16 entre contrats de widgets, composition, MCP Apps et opérations Creezio. Deux types partagent le modèle `record` mais conservent leurs identités, états et actions distincts. L'hôte peut instancier plusieurs fois un type sans que le module attribue une conversation ou une autorité.

`message` prévisualise un texte et attend un envoi volontaire. `context` transmet une donnée bornée pour le prochain tour sans mutation. `direct` relit ou renomme par les opérations natives, avec droits courants, révision métier et clé d'idempotence. Le renommage n'est pas marqué lecture seule dans MCP. Refus, absence de capacité et résultat incertain sont affichés sans simuler un effet.

Les ressources HTML importées au build sont servies en `text/html;profile=mcp-app` après authentification et autorisation par audience. Le proxy web sandbox est fourni par l'hôte sur une origine différente. Les six suites vérifient les contrats et comportements du module ; la recette réelle des hôtes et des données reste séparée.
