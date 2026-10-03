# T22 — suites à qualifier

- Les deux premiers clics `analytics.refresh` et `catalog.product.open` ont une recette Original Sites v4 documentée dans `docs/IMPLEMENTATION-T22.md`. Qualifier en navigateur hébergé les hooks workspace/front des nouvelles actions statiques `support.ticket.open` et `crm.record.open` : politique désactivée puis activée, route et contexte courants, absence de sujet/message/identifiant de ticket et de données de fiche dans l’événement. Le test local relie les attributs JSX au collecteur ; il ne constitue pas cette recette visuelle.
- Qualification HTTP/MCP en composition hôte après publication du schéma additif. Les tests Miniflare couvrent les refus synthétiques, la politique et la purge sans toucher aux journaux réels.
- Mesures de présence fiables, pauses, concentration et classification humain/IA : critères produit séparés. T17 Work reste reporté ; les six onglets ne simulent aucun score.
- Les routes hors catalogue d’opérations, les événements déclenchés par des clients tiers et l’export distant restent à définir si le produit les demande. Aucun texte libre, contenu de requête ou jeton ne doit être transformé en événement.
- Les journaux d’exécution et ACL conservent leur propre politique de rétention. La purge de `transport_refusal` ne les nettoie pas. Le plafond de 10 000 lignes évite une croissance illimitée si aucune purge manuelle n’est effectuée ; à saturation, de nouveaux refus sont perdus jusqu’à la prochaine purge.
- Recette hébergée des deux widgets MCP Apps encore requise.
