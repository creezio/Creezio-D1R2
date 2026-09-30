# T28 — suivi

- [x] Accès externe Meili autorisé : un GET `/indexes?limit=1` a répondu HTTP 200 avec enveloppe conforme ; reçu sans données d’index.
- [x] Module de connexion 0.1.0 composé et qualifié localement : D1/coffre, droits, API/MCP, UI originale et six suites.
- [ ] Diagnostic 0.2.0 : `index.list` GET paginé, réservée au droit manage, projetant seulement les métadonnées ; qualifier l’archive et la nouvelle lecture fournisseur après intégration.
- [ ] Définir un port d’écritures distantes reprenable, les tâches Meili et les preuves de génération ; aucune tâche d’indexation n’est lancée par cette tranche.
- [ ] Indexation contextuelle, suppressions, recherche, filtres et reconstruction ; fermer REQ-2801 seulement après recettes réelles.
- [ ] Expliquer séparément la recherche globale native T05 reportée et obtenir le feu vert avant de l’intégrer.

Le reçu fournisseur historique ne qualifie pas la nouvelle lecture paginée 0.2.0. Aucun résultat de recherche, facette ou progrès d’indexation n’est simulé ; le seul total affiché par le diagnostic vient de la réponse Meilisearch validée.
