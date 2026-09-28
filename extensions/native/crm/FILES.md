# Fichiers

- `module/generate-manifest.mjs` produit `manifest.json` et `models.json` depuis le contrat T20.
- `module/service.ts` porte les règles métier, relations, recherche et plans atomiques.
- `ui/kanban.tsx` reprend le parcours visuel de prospection original ; `ui/index.tsx` expose les vues CRM et `ui/editing.ts` lie chaque formulaire à la révision lue.
- `ui/commands.ts` conserve la clé d’une mutation incertaine et relit son statut sans rejouer son effet.
- `plugin/` déclare la projection conversationnelle ; `ci/`, `tests/` et `gate.mjs` portent les six suites.
