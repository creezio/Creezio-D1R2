# Fichiers du module

- `module/` : manifeste canonique, modèles D1, handlers et générateur déterministe du manifeste.
- `ui/` : vues workspace/front, panneau repris de l’original, rendu des messages et liens.
- `plugin/` : déclaration portable du plugin sans second backend ; widgets livrés à T16.
- `ci/` et `tests/` : six suites déclarées, dont la recette UI du panneau.
- `README.md`, `prd.md`, `CHANGELOG.md`, `LICENSE` : documentation installée.
- `AGENTS.md`, `FILES.md`, `interview.md`, `TODO.md` : documents de développement.

Le contrôleur partagé appartient à `sdk/conversations/`. Le raccord fichiers et le transport HTTP appartiennent à l’hôte.
