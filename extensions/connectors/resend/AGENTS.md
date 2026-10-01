# Consignes locales

Respecter `docs/STANDARD-MODULE.md` et `docs/connectors/T29-MAIL.md`. Tout accès Resend sortant passe par le port connecteur hôte, jamais par `fetch` dans un handler. Ne pas exposer clé ou réponse fournisseur brute, inventer une clé d’idempotence, démarrer un daemon mail, ou annoncer un envoi confirmé sur une intention en attente. Les pièces entrantes suivent la politique `binaryDownloads` compilée, un stage par ID et un import D1 exact ; la qualification synthétique ne vaut pas recette fournisseur réelle.
