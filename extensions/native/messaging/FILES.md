# Inventaire des fichiers

- `module/` : manifeste, modèles D1, catégorie R2, opérations communes et service métier borné.
- `ui/contracts.ts` : contrats de présentation, identité du panneau et pont de lecture `client.invoke` vers les opérations du module.
- `ui/index.tsx` : orchestration du workspace, navigation, identité, recherche, brouillon, fichiers et commandes journalisées par le SDK public.
- `ui/presentation.tsx` : dossiers, liste, lecteur en trois panneaux et destinataires issus du webmail original.
- `ui/rich-editor.tsx` : éditeur visuel natif, vocabulaire HTML étroit et barre de mise en forme.
- `plugin/` : projection MCP et skill de rédaction ; pas de second backend ni de widget V1 inventé.
- `ci/` et `tests/` : six suites backend, UI, API/MCP, widgets, paquet et docs.
- `README.md`, `prd.md`, `CHANGELOG.md`, `LICENSE` : documents de version installée ; `AGENTS.md`, `FILES.md`, `interview.md`, `TODO.md` : documents de développement.

Le point de comparaison de présentation est `packages/mails/ui` du Creezio original au commit `6bd6507633b4c17bfc31206d82d1caa9a8af19af`. Les transports et le stockage de `packages/mails/src` ne sont pas copiés dans cette architecture.
