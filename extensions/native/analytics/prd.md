# T22 — Analytique et diagnostics

## Besoin

Un administrateur autorisé consulte l’usage et les erreurs dans son contexte, sans fuite de données sensibles. Les périodes, sources, bornes et résultats partiels sont explicites. L’API et MCP permettent les mêmes lectures selon les droits. Un client autorisé peut déclarer des événements sûrs, sans texte arbitraire.

## Première tranche

Six onglets hérités du produit original, alimentés par des événements déclarés et une vue de provenance. Filtres 24 h, 7 j, 30 j, 12 mois ; recherche et pagination du journal, export local CSV/JSON borné à dix pages/500 événements avec état partiel explicite, actualisation à 8 s en panneau actif. Contexte D1 isolé, audience admin pour lecture et droits séparés pour émission. Les valeurs ne sont pas des mesures exhaustives tant que les hooks hôte ne sont pas raccordés.

## Critères différés visibles

Les exécutions du journal technique déjà maintenu par le moteur et les routes du catalogue HTTP compilé sont projetées dans le contexte avec droit admin, sans payload, secret, texte d’erreur ni principal. Les logs des requêtes refusées avant moteur, le tracking automatique et la productivité complète restent ouverts (voir TODO). L’export distant reste une option distincte.

## Rétention contrôlée des événements déclarés

Par défaut, aucune politique et aucune purge automatique. Un administrateur titulaire du droit distinct `analytics.purge` définit 1 à 3 650 jours de conservation pour son contexte, puis lit un aperçu des dix plus anciens événements admissibles avant de confirmer un lot. Chaque commande porte une clé de requête ; le moteur revalide la révision de politique, l'ordre du lot et chaque ligne au commit. Une politique ou une ligne changée fait refuser la commande. Le panneau conserve seulement les identifiants nécessaires pour inspecter une issue incertaine, sans rejouer la suppression. La suppression ne porte que sur `event`, jamais sur le journal technique ou les logs de transport.
