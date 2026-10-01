# Décisions de conception

- Resend est le premier fournisseur HTTP de T29 ; SMTP, IMAP, daemon et scheduler ne sont pas embarqués.
- L’expéditeur est une adresse configurée par l’administrateur. La vérification de domaine se constate par la lecture de métadonnées et par une recette fournisseur autorisée ; la saisie seule ne la prouve pas.
- Le module ne propose pas `email.send` libre en API, MCP ou UI. La commande métier est `creezio.messaging:message.send` après raccord à une intention durable.
- Le port mutateur commun a un budget de corps 64 KiB ; l'hôte joint les fichiers R2 privés au POST déclaré et conserve les accusés signés. Pour l'entrant, `binaryDownloads` fixe le GET de métadonnées et l'origine CDN, avec un stage par ID et un import atomique 0–50. Aucun accès SQL ou réseau privé n'est confié au handler ; la recette fournisseur réelle reste ouverte.
