# PRD — Livraison locale

## Parcours

1. L’administrateur ouvre « Livraison Cloudflare » depuis le workspace Docker local.
2. Il configure le compte, le nom du Worker et un jeton non conservé dans le navigateur.
3. Il choisit explicitement les connexions protégées à transférer ; elles sont désactivées par défaut sur la cible.
4. Il prépare le plan, lit son résumé et confirme le démarrage du transfert identifié.
5. Il suit les étapes D1, R2, bindings, vérification et publication, puis retrouve le même transfert après reconnexion.

La préparation ne capture aucune donnée. La capture commence après l’arrêt coordonné du runtime local au démarrage. Le processus opérateur limité reste disponible. Le résultat de publication et l’état du registre sont présentés séparément. Aucun autre profil d’hébergement n’est annoncé comme disponible.

Après livraison, l’administrateur prépare et relit un plan distinct pour mettre à jour le Worker existant. Cette opération ne recopie aucune donnée locale et ne remplace aucun secret. L’écran affiche l’identifiant exact de mise à jour et permet de retrouver son statut après une coupure.

Si la publication de cette mise à jour reste incertaine, l’administrateur peut demander une nouvelle tentative explicite du même artefact. L’opérateur exige le reçu de construction intact, le reçu du schéma D1, la publication précédente confirmée et une version Worker la plus récente égale à l’ancienne. Il refuse la tentative lorsque ces preuves manquent ou divergent. Il conserve les tentatives précédentes dans le journal, borne le nombre de nouvelles tentatives à trois et n’en lance aucune automatiquement.

## Frontières

La vue ne contient ni identité alternative, ni client Cloudflare direct, ni API/MCP de publication. Le transport injecté appartient à l’hôte local et valide la session admin, le CSRF et le droit sur le transfert exact. Le module ne possède aucun modèle D1 ni catégorie de fichier. Les secrets ne figurent pas dans son état persistant, ses journaux ou ses sorties.
