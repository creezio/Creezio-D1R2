# Fichiers

- `module/generate-manifest.mjs` produit les modèles et le manifeste T19.
- `module/service.ts` gère tickets, messages, statuts, prise en charge personnelle et pagination avec les ports communs.
- `ui/index.tsx` adapte les deux layouts originaux aux audiences app et admin et raccorde les mutations au journal public du SDK ; `ui/state.ts` conserve les brouillons par ticket et sérialise sélection et commande en attente dans le même état de panneau.
- `ui/widgets/runtime.ts`, ses quatre entrées TypeScript et ses deux gabarits HTML portent les cartes liste et fil par audience. Les appels restent déclenchés par clic et le résultat externe incertain bloque le rejeu.
- `plugin/` expose les outils MCP, les quatre ressources visuelles et le guide conversationnel `plugin/skills/support.md` ; `ci/`, `tests/` et `gate.mjs` portent six suites.
