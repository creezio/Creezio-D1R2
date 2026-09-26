---
name: maintain-standards
description: "Faire évoluer les contrats, guides, AGENTS, skills ou contrôleurs Creezio depuis leur source canonique, sans affaiblir la validation de la proposition courante."
---

# Maintenir les standards

Lire les [règles communes et la phase autorisée](../../README.md), le [standard de développement](../../../docs/DEVELOPMENT-STANDARD.md), le [standard de module](../../../docs/STANDARD-MODULE.md), le [cycle Git](../../../docs/GIT-FLOW.md), les [exigences](../../../docs/EXIGENCES.md) et les décisions concernées. Avant le GO, les changements restent documentaires ; l'implémentation et la qualification des contrôleurs appartiennent au P0 et aux lots ensuite autorisés selon leur périmètre.

1. Identifier la source canonique, la règle modifiée, sa raison et ses consommateurs : socle, modules natifs/tiers, applications, SDK, packaging et outils IA. Ne pas corriger durablement une copie générée à la place de sa source.
2. Mettre à jour le contrat et sa version de manière cohérente, ainsi que fiche d'impact, PRD/décisions, parcours, TODO et inventaire selon les conséquences réelles. Préserver les décisions acquises ; garder les politiques commerciales expressément différées dans leur état, sans les choisir dans un skill.
3. Garder les guides courts et discriminants, avec noms/descriptions utiles au routage. Séparer skills de développement et skills conversationnels. Vérifier frontmatter, liens relatifs, exemples et comportements sur un scénario représentatif ; un contrôle de syntaxe ne suffit pas à vérifier les décisions d'un agent.
4. Pour un contrôleur exécuté, prévoir cas valides et invalides significatifs, vérifier sélection de suites, provenance et association des preuves à la révision. Ne pas considérer comme contrôles actifs des scripts vides, des exemples ou la seule présence de fichiers dans le dépôt.
5. Conserver la politique approuvée comme autorité de la proposition. Le changement des contrôles est examiné avec les règles antérieures et par un mainteneur habilité ; l'adoption de la nouvelle politique intervient ensuite. Aucun auto-assouplissement permettant à la PR de se valider elle-même.
6. Traiter les protections distantes comme une configuration séparée, modifiable uniquement dans un mandat adapté. Lire leurs réglages effectifs et les qualifier avant de les annoncer actifs. Ne pas réclamer une confirmation par commande déjà autorisée et ne pas prétendre rendre inviolable un dérivé dont le propriétaire peut modifier le code.

Contribuer par la branche et la PR prévues, sans réécriture de l'historique publié. Une future release du standard suit revue indépendante, squash puis vérification du nouveau SHA de main et de l'archive exacte. Indiquer quels consommateurs restent à mettre à jour ; ne pas propager automatiquement la modification à tous les forks.
