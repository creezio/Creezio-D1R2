# Module Livraison

Conserver la frontière d’autorisation dans l’hôte local. La vue ne doit pas créer de session, appeler directement Cloudflare, exposer une opération de publication au module/MCP, ni persister un secret. Les six suites déclarées doivent vérifier leur vrai périmètre ; les suites API/MCP et widgets prouvent explicitement leur absence.
