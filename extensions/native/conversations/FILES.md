# Fichiers du module

- `module/` : manifeste canonique, modèles D1, handlers et générateur déterministe du manifeste ; la requête `widget.render.read` lit le message et délègue la vérification historique à l’hôte.
- `ui/` : vues workspace/front, panneau repris de l’original, projection des événements, boucle de progression, rendu des messages et liens.
- `plugin/` : déclaration portable du plugin sans second backend.
- `ui/widget-message.tsx` : hôte des instances, lecture du résultat durable, actions et décisions humaines natives, y compris la confirmation d’un lien externe HTTPS ; les ressources, le pont et le garde de lien communs vivent dans `sdk/widgets/` sans export du paquet SDK public.
- `ci/` et `tests/` : six suites déclarées, dont la recette UI du panneau.
- `README.md`, `prd.md`, `CHANGELOG.md`, `LICENSE` : documentation installée.
- `AGENTS.md`, `FILES.md`, `interview.md`, `TODO.md` : documents de développement.

Le contrôleur partagé appartient à `sdk/conversations/`. Le raccord fichiers et le transport HTTP appartiennent à l’hôte.
