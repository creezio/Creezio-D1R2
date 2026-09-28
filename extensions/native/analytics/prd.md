# T22 — Analytique et diagnostics

## Besoin

Un administrateur autorisé consulte l’usage et les erreurs dans son contexte, sans fuite de données sensibles. Les périodes, sources, bornes et résultats partiels sont explicites. L’API et MCP permettent les mêmes lectures selon les droits. Un client autorisé peut déclarer des événements sûrs, sans texte arbitraire.

## Première tranche

Six onglets hérités du produit original, alimentés par des événements déclarés et une vue de provenance. Filtres 24 h, 7 j, 30 j, 12 mois ; recherche et pagination du journal, export local d’une page CSV/JSON, actualisation à 8 s en panneau actif. Contexte D1 isolé, audience admin pour lecture et droits séparés pour émission. Les valeurs ne sont pas des mesures exhaustives tant que les hooks hôte ne sont pas raccordés.

## Critères différés visibles

Les logs requête/API/MCP, endpoints, tracking automatique et productivité complète exigent de nouveaux ports publics hôte (voir TODO). La purge du journal original exige une règle de rétention et un droit de suppression validés ; elle n’est pas simulée. L’export distant reste une option distincte.
