# OpenAI pour Conversations

Le module configure un modèle OpenAI par contexte et adapte Responses au port fournisseur public `sdk/providers`. La clé reste dans le coffre serveur. Les chats workspace et front utilisent les tours du module Conversations ; ce module ne crée ni deuxième historique ni endpoint public OpenAI générique.

La commande de configuration de clé écrit le secret chiffré et la configuration dans le même batch T06. Le panneau administrateur ne relit jamais la clé. L’administrateur saisit un identifiant de modèle exact ; la liste de l’hôte reflète seulement le modèle configuré et ne constitue pas une découverte distante. Le fournisseur vérifie cet identifiant lors de l’envoi d’une requête.

`createOpenAITransport` ouvre une Response en mode background et stream, remet son identifiant dès `response.created`, puis livre les événements typés. Le pont hôte persiste ce reçu avant de consommer le flux. Les états incertains ne relancent pas une création. L’intégration réelle dans les deux chats, les outils et l’annulation exigent une recette distincte des six suites de contrat du module.
