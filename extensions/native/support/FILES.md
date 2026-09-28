# Fichiers

- `module/generate-manifest.mjs` produit les modèles et le manifeste T19.
- `module/service.ts` gère tickets, messages, statuts, prise en charge personnelle et pagination avec les ports communs.
- `ui/index.tsx` adapte les deux layouts originaux aux audiences app et admin et raccorde les mutations au journal public du SDK ; `ui/state.ts` conserve les brouillons par ticket et sérialise sélection et commande en attente dans le même état de panneau.
- `plugin/` expose les outils MCP texte ; `ci/`, `tests/` et `gate.mjs` portent six suites.
