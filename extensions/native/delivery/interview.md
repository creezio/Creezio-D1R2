# Décisions T32

- Profil disponible : Docker local uniquement.
- Cible initiale : compte Cloudflare et nom de Worker ; D1/R2 sont créés par l’opérateur.
- Connexions protégées : désactivées par défaut, transfert sur sélection explicite.
- Préparation : transfert identifié et plan relisible, sans capture.
- Démarrage : arrêt du runtime local pour capture cohérente ; opérateur indépendant disponible pendant la progression.
- Reprise : `status` et `reconcile` utilisent l’identifiant et le digest du même transfert.
