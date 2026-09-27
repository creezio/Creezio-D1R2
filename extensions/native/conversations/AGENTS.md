# Module Conversations

Appliquer les instructions du dépôt et les contrats Conversations et Widgets. Les handlers utilisent exclusivement `OperationContext.data` et les capacités fichiers de l’hôte ; aucun SQL, cookie, clé R2 ou secret fournisseur dans le module. Le propriétaire, l’audience et le contexte proviennent du serveur. Toutes les lectures et écritures d’un enfant gardent la clé composite de sa conversation.

Conserver les six suites réelles du module et les documents installés. Aucun faux message, réponse IA ou annulation fournisseur affirmée sans confirmation. Les événements ont une séquence durable ; une page vide avec curseur n’est pas une fin de recherche. Ne pas reconstruire un backend métier pour un widget, ni rejouer son opération pour restaurer un ancien message. Le pointeur de rendu provient du cœur après une exécution réussie et les modes d'action restent déclarés dans le module.
