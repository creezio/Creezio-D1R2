# PRD — OpenAI T15

Un administrateur autorisé active le fournisseur pour un contexte, saisit une clé une seule fois et indique un identifiant de modèle exact. La configuration contrôle la syntaxe et les révisions ; elle ne vérifie pas la disponibilité du modèle auprès d’OpenAI. Une clé absente ou une configuration invalide donne un état explicite. Les utilisateurs autorisés des chats `admin` et `app` déclenchent `turn.start` via Conversations ; l’hôte exécute Responses et contrôle les outils communs sous leurs droits courants.

La clé ne quitte pas le coffre et n’apparaît ni dans la lecture de configuration ni dans les événements. Les limites de tokens, taille, durée, outils et concurrence sont imposées par l’hôte. Un reçu fournisseur perdu n’autorise pas une seconde création. La première recette inclut un appel Responses réel, un outil de lecture autorisé/refusé, progression D1, annulation et révocation. Voix et widgets suivent leurs lots dédiés.

Les outils de lecture compatibles avec le mode strict utilisent `strict: true`. Un schéma borné avec paramètres optionnels déclarés utilise `strict: false`, sans transformer les entrées de l'opération. Le moteur vérifie les arguments et les droits courants avant chaque exécution.
