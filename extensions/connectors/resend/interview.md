# Décisions de conception

- Resend est le premier fournisseur HTTP de T29 ; SMTP, IMAP, daemon et scheduler ne sont pas embarqués.
- L’expéditeur est une adresse configurée par l’administrateur. La vérification de domaine se constate par la lecture de métadonnées et par une recette fournisseur autorisée ; la saisie seule ne la prouve pas.
- Le module ne propose pas `email.send` libre en API, MCP ou UI. La commande métier est `creezio.messaging:message.send` après raccord à une intention durable.
- Le port mutateur commun a un budget de corps 64 KiB ; les pièces jointes R2 et les accusés demandent des raccords hôte complémentaires, sans accès SQL ou réseau privé dans le module.
