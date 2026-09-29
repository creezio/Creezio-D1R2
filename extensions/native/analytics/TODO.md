# Raccords T22 restants

- Port hôte public de logs de requêtes API/MCP : horodatage, route/opération, statut, latence, principal pseudonymisable, contexte, curseur stable, texte d’erreur caviardé, droits de consultation et rétention. Aucun accès direct aux tables `creezio.runtime`.
- Port hôte public de journal d’exécution des opérations : résultat, erreur codifiée, source, durées et pagination, caviardage vérifiable. Ne pas assimiler `creezio.access:audit.list` à un journal global.
- Registre d’endpoints exposé par le hôte : identifiants, méthodes, routes, module propriétaire, visibilité et état, avec droit de lecture et stabilité des versions.
- Hooks de navigation et de clics des interfaces workspace/front : émission contrôlée `event.record`, contexte et principal hôte, déduplication, opt-in et politique de collecte. Sans eux, les classements sont limités aux déclarations explicites.
- Heartbeats de présence fiables, classification humain/IA, définitions contractuelles des pauses (historique ≥5 min), concentration et temps actif, droits utilisateur et consentement avant score/leaderboard complet. T17 Work reporté par priorité utilisateur ; aucune mesure fictive.
- Politique de rétention/purge auditable, export complet multi-pages et export distant optionnel à définir séparément. L’UI ne revendique qu’un export de page.
- Qualification navigateur du workspace et appels HTTP/MCP réels en composition hôte après intégration centrale.

- Les deux widgets MCP Apps de lecture ne remplacent ni l'instrumentation automatique, ni les journaux hôte, ni les mesures Work reportées. La recette hébergée des widgets reste à faire.
