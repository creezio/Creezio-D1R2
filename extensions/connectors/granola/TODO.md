# T29 Granola — état honnête

- [x] Descripteur fournisseur public borné, clé scellée, modèle par contexte et génération.
- [x] Projections bornées notes/dossiers, checkpoint CAS, fiche résumé et transcription paginée.
- [x] Panneaux originaux Notes/Connexion adaptés, API/MCP et quatre widgets en lecture seule.
- [x] Descripteur Standard Webhooks, secrets scellés, mapper pur et reçu D1 idempotent ; relecture explicite `note.refresh`.
- [x] Recette HTTP signée synthétique via le host commun : corps brut, refus, jeton et déduplication en D1.
- [x] Clore la recette D1 du 404 et de la rotation complète après raccord du garde hôte atomique.
- [ ] Gestion des endpoints fournisseurs par le port commun de mutation, si le compte Granola dispose du niveau requis.
- [ ] Recette hébergée avec compte fournisseur, révocation et événement signé réel ; aucun succès réel revendiqué.
