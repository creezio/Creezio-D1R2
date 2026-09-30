# T26 — suivi

- [x] Instance externe, API REST de lecture, configuration contextuelle et clé API scellée.
- [x] Second descripteur webhook de production, configuration/coffre distincts, droit `n8n.trigger`.
- [x] Intention durable, POST unique, réponse 2xx corrélée comme « accepté », GET de suivi et UI/API/MCP/widgets de lecture.
- [x] Tests source six suites et D1/host synthétique des deux coffres, droits, non-rejeu et révocation.
- [ ] Qualification des archives/compositions centrales, SQL et verrous après intégration par le responsable du dépôt.
- [ ] Recette n8n réelle avec URL, clés et workflow de test explicitement autorisés : reportée par l’utilisateur le 30 septembre ; ne pas redemander les secrets ni relancer le 401 historique.
- [ ] Autres capacités T26 : publish/unpublish, callback signé d’un workflow configuré, stop/retry/delete selon contrats réels ; spécifier et faire valider séparément avant leur tranche.
- [ ] Raccord T24 aux règles uniquement après validation explicite de T24.

Les tests simulés ne ferment pas la recette fournisseur réelle ni toutes les exigences T26.
