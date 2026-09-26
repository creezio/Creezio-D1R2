# Décisions du module access

- 26 septembre 2026 : connexion native Creezio, indépendante d'une éventuelle barrière d'hébergement GPT.
- Workspace utilisable pour une personne, une équipe ou un SaaS ; l'administration système reste un droit distinct.
- Modèles actuels et SQL central généré ; aucune ancienne architecture ni conversion de données intégrée.
- Installation explicitement autorisée et consommée une seule fois ; comptes persistants dans D1, jamais un faux stockage mémoire produit.
- 26 septembre 2026 : droits initiaux matérialisés au même claim que le compte, avec une unique permission `creezio.access:manage` sur l'audience admin du contexte application. Aucun fallback propriétaire ni grant wildcard.
- Les affectations et exceptions de compte référencent un membership complet compte/contexte/audience. Les changements du graphe se coordonnent avec une epoch globale, une session fraîche et un audit atomique. Les contextes existants sont conservés ; leur désactivation est explicite et le contexte application reste actif.
- Cette tranche ne modifie pas le PRD global ni les exigences approuvées. Les choix commerciaux et la diffusion du futur code restent différés.
