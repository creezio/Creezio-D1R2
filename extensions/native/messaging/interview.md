# Décisions de cadrage T-18

Le besoin conservé de l’application originale est un webmail utilisable dans le workspace : boîtes et dossiers, lecture, recherche, composition, brouillons, fichiers privés et états d’envoi. L’utilisateur a demandé de reprendre l’interface du Creezio original avec sa présentation et ses interactions, tout en bâtissant un produit neuf serverless.

Le Creezio original au commit `6bd6507633b4c17bfc31206d82d1caa9a8af19af` sert de référence de rendu, jamais de serveur à déplacer. La base SQLite, les boucles IMAP/SMTP et le Worker mail distinct n’entrent pas dans ce module. Resend est raccordé par un port externe déclaré au même métier et au même déploiement ; son parcours réel reste à qualifier. L’absence de fournisseur ne bloque ni la lecture ni les brouillons ; elle interdit honnêtement l’envoi et la réception.

Le premier périmètre du module n'inventait pas de widget conversationnel spécifique. Les trois widgets de lecture ajoutés depuis emploient les opérations communes, les droits et les états de transport réels ; les opérations MCP restent utilisables sans UI de chat.
