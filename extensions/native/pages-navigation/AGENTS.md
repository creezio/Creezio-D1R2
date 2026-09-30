# Consignes du module Pages et navigation

Appliquer les consignes de la racine et `docs/STANDARD-MODULE.md`. La source historique de référence est le commit `6bd6507633b4c17bfc31206d82d1caa9a8af19af` de l'ancien dépôt, en lecture seule. Garder le brouillon et le snapshot publié distincts, vérifier les révisions au commit, ne jamais convertir `publish` en déploiement Site. Les objets R2 demeurent privés ; seul le port hôte public borné peut livrer les images d'un snapshot explicitement exposé. Aucun accès SQL, cookie, secret ou client R2 direct dans les handlers.
