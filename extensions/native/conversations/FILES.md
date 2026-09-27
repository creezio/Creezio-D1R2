# Fichiers du module

- `module/` : manifeste canonique, modèles D1, handlers et générateur déterministe du manifeste.
- `ui/` : vues workspace/front, panneau repris de l’original, projection des événements, boucle de progression, rendu des messages et liens.
- `plugin/` : déclaration portable du plugin sans second backend.
- `ui/widget-message.tsx` : hôte des instances, lecture du résultat durable, actions et décisions humaines natives ; les ressources et le pont commun vivent dans `sdk/widgets/`.
- `ci/` et `tests/` : six suites déclarées, dont la recette UI du panneau.
- `README.md`, `prd.md`, `CHANGELOG.md`, `LICENSE` : documentation installée.
- `AGENTS.md`, `FILES.md`, `interview.md`, `TODO.md` : documents de développement.

Le contrôleur partagé appartient à `sdk/conversations/`. Le raccord fichiers et le transport HTTP appartiennent à l’hôte.
