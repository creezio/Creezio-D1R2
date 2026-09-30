# T28 — suivi

- [x] Candidat source 0.3.0 : lots durables, tâches Meili, synchronisation, issue inconnue bloquée, recherche relue sur le Catalogue et déclaration facultative `catalog-products`.
- [ ] Valider le paquet et la composition après rafraîchissement unique du dist SDK 1.6.0, puis recettes D1 et fournisseur externe sur les nouveaux chemins.
- [x] Fixer `primaryKey=id` sur le POST de documents et vérifier l’URL hôte avec deux documents comportant plusieurs champs en `id`.
- [ ] Qualifier une nouvelle tâche fournisseur après l’échec lu en tâche 165 (`index_primary_key_multiple_candidates_found`, deux reçus, zéro indexé) ; ne pas rejouer la tâche 165 ni effacer l’index client.

- [x] Accès externe Meili autorisé : un GET `/indexes?limit=1` a répondu HTTP 200 avec enveloppe conforme ; reçu sans données d’index.
- [x] Module de connexion 0.1.0 composé et qualifié localement : D1/coffre, droits, API/MCP, UI originale et six suites.
- [ ] Diagnostic 0.2.0 : `index.list` GET paginé, réservée au droit manage, projetant seulement les métadonnées ; qualifier l’archive et la nouvelle lecture fournisseur après intégration.
- [x] Port d’écritures distantes reprenable, tâches Meili et preuves de génération en source locale ; recette fournisseur encore nécessaire.
- [x] Projection contextuelle, suppressions, recherche relue, facettes de page et reconstruction en source locale.
- [ ] Fermer REQ-2801 seulement après composition, intégration D1 et recettes réelles des nouvelles routes.
- [ ] Expliquer séparément la recherche globale native T05 reportée et obtenir le feu vert avant de l’intégrer.

Le reçu fournisseur historique ne qualifie pas les écritures, tâches ou recherches de 0.3.0. Les tests locaux utilisent un fournisseur simulé ; aucun résultat de recherche réel n’est présenté comme une recette fournisseur.
