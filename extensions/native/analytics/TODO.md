# Raccords T22 restants

- Port hôte public de logs de requêtes API/MCP : horodatage, route/opération, statut, latence, principal pseudonymisable, contexte, curseur stable, texte d’erreur caviardé, droits de consultation et rétention. Aucun accès direct aux tables `creezio.runtime`.
- Le port hôte public du journal d’exécution existe : projection bornée du journal `creezio.runtime` et droit `analytics.read` admin. Compléter les diagnostics des refus **avant** moteur et la rétention, sans doubler ce journal.
- Le registre des routes HTTP compilées est exposé au module avec méthodes, chemins, audience et module. Les autres familles d’endpoints hors catalogue d’opérations restent à qualifier séparément.
- Hooks de navigation et de clics des interfaces workspace/front : émission contrôlée `event.record`, contexte et principal hôte, déduplication, opt-in et politique de collecte. Sans eux, les classements sont limités aux déclarations explicites.
- Heartbeats de présence fiables, classification humain/IA, définitions contractuelles des pauses (historique ≥5 min), concentration et temps actif, droits utilisateur et consentement avant score/leaderboard complet. T17 Work reporté par priorité utilisateur ; aucune mesure fictive.
- La rétention manuelle des événements déclarés est livrée dans T22 avec politique par contexte, droit admin dédié, aperçu et purge gardée par lots de dix. Qualifier séparément la rétention des logs de transport et du journal technique, ainsi que l'export distant optionnel. L’UI exporte au plus dix pages/500 événements, avec borne partielle explicite.
- Qualification navigateur du workspace et appels HTTP/MCP réels en composition hôte après intégration centrale.

- Les deux widgets MCP Apps de lecture ne remplacent ni l'instrumentation automatique, ni les journaux hôte, ni les mesures Work reportées. La recette hébergée des widgets reste à faire.
