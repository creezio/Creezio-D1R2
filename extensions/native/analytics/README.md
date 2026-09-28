# Creezio Analytique — tranche T22

Module natif `creezio.analytics`, adapté des six onglets de `packages/observability/ui/analytics-client.tsx` de Creezio original (`6bd6507`). Il conserve Vue d’ensemble, Productivité, Pages, Clics, Collaborateurs et Journal dans le workspace. Les données proviennent exclusivement de `event.record`, opération autorisée qui écrit un événement succinct dans D1 sous le contexte courant, avec principal et horodatage fixés côté hôte. Les lectures sont réservées aux droits `analytics.read` en audience admin. API et outils MCP utilisent le même moteur et les mêmes permissions ; `analytics.emit` fonctionne en admin ou app, pour utilisateur ou machine autorisée.

`analytics.snapshot` parcourt au plus 500 événements par appel et indique `complete` et `nextCursor`. `event.list` et `event.export` paginent par 50, avec curseur lié aux filtres, à la période, au contexte et à l’audience. Les sorties et identifiants sont bornés ; ni corps de requête ni contenu libre n’est collecté. La durée optionnelle est **déclarée**, sans calcul de temps actif ni score de productivité. Une absence d’événements n’atteste pas l’absence d’activité.

Le raccordement automatique des routes, clics, heartbeats, journaux HTTP/MCP, journal technique des opérations et registre des endpoints manque au contrat hôte public actuel. La vue le signale dans les onglets concernés. Aucun accès aux tables privées du runtime, collecteur fleet, service tiers, scheduler ou export distant n’est ajouté. Le détail des ports nécessaires figure dans [TODO.md](TODO.md).

Exécuter `node gate.mjs` pour les six suites locales, puis `node --test tests/analytics/integration.test.mjs` pour la recette Miniflare D1 si disponible.
