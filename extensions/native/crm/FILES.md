# Fichiers

- `module/generate-manifest.mjs` produit `manifest.json` et `models.json` depuis le contrat T20.
- `module/service.ts` porte les règles métier, relations, recherche et plans atomiques.
- `ui/kanban.tsx` reprend le parcours visuel de prospection original ; `ui/index.tsx` expose les vues CRM et `ui/editing.ts` lie chaque formulaire à la révision lue.
- `ui/commands.ts` conserve la clé d’une mutation incertaine et relit son statut sans rejouer son effet.
- `ui/widgets/` contient les rendus de lecture liste/fiche et leur ressource MCP Apps ; les six déclarations pointent vers les mêmes opérations CRM.
- `plugin/skills/crm.md` décrit les neuf lectures CRM et les six ressources visibles aux clients MCP ; son empreinte est liée au manifeste.
- `plugin/` déclare la projection conversationnelle ; `ci/`, `tests/` et `gate.mjs` portent les six suites.
