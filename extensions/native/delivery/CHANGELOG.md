# Changelog

## 0.0.0

- Vue d’administration locale pour préparer, lancer, suivre et reprendre un transfert Cloudflare identifié.
- Aucun outil MCP, route de module ou stockage de secret ajouté.
- Après une réponse perdue au lancement, le statut préparé du même transfert réarme son démarrage seulement après conservation locale confirmée.
- Une préparation interrompue retrouve sa cible après rechargement et reprend le même projet avec le jeton correspondant.
- Un changement de compte efface la cible affichée avant de relire celle du nouvel utilisateur autorisé.
- Un parcours séparé prépare, confirme et suit une mise à jour du Worker sans recopier D1/R2 ni remplacer ses secrets.
