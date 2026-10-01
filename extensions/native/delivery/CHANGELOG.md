# Changelog

## Candidate locale — refus Cloudflare 10021 vérifié

- Le paquet Delivery utilise les sous-chemins publics des contrôleurs et modèles de vue du SDK 1.9 candidat ; son générateur de manifeste relit son propre manifeste archivé. La compatibilité déclarée passe à `^1.9.0`.
- Le diagnostic de validation expose une catégorie fermée sans journal fournisseur brut. Une action d'administration vérifie explicitement que la version et le déploiement actifs restent sur la publication précédente avant d'afficher `rejected` ; une issue non prouvée reste incertaine.
- `rejectUpdate` reste une capacité facultative du transport SDK : les anciens adaptateurs masquent l'action et le contrôleur refuse son appel avec `service_unavailable`. Un diagnostic Cloudflare `10021` ne peut pas déclencher une nouvelle tentative, même si un ancien adaptateur annonce `retryEligible`.
- Le reçu terminal permet de préparer un nouveau plan après correction, avec un nouvel identifiant. Le schéma D1 déjà appliqué, les données, les secrets et l'artefact restent conservés ; aucun rollback ni nouvel upload automatique n'est déclenché. Les tests d'interface et de transport sont locaux ; aucune publication Cloudflare corrigée n'est qualifiée ici.

## 0.0.0

- Vue d’administration locale pour préparer, lancer, suivre et reprendre un transfert Cloudflare identifié.
- Aucun outil MCP, route de module ou stockage de secret ajouté.
- Après une réponse perdue au lancement, le statut préparé du même transfert réarme son démarrage seulement après conservation locale confirmée.
- Une préparation interrompue retrouve sa cible après rechargement et reprend le même projet avec le jeton correspondant.
- Un changement de compte efface la cible affichée avant de relire celle du nouvel utilisateur autorisé.
- Un parcours séparé prépare, confirme et suit une mise à jour du Worker sans recopier D1/R2 ni remplacer ses secrets.
- La mise à jour incertaine propose une nouvelle tentative explicite du même artefact après preuve négative sur la version Worker ; les tentatives restent journalisées et le diagnostic exposé est borné.
