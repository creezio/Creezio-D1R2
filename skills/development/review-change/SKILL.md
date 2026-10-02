---
name: review-change
description: "Relire une proposition Creezio contre le standard approuvé et les preuves de son SHA final, puis produire une revue technique distincte de la réalisation dans le parcours monocompte."
---

# Relire un changement

Lire les [règles communes et la phase autorisée](../../README.md), le [standard de développement](../../../docs/DEVELOPMENT-STANDARD.md), le [standard de module](../../../docs/STANDARD-MODULE.md), le [cycle Git](../../../docs/GIT-FLOW.md) et les [exigences](../../../docs/EXIGENCES.md) concernées. Avant le GO, relire conception, documents et critères ; ne pas déclarer conformes des contrôleurs ou fonctions encore absents.

1. Identifier demande, base, révision candidate, composition et diff réel. Comparer résultat proposé et parcours attendus. Distinguer ce qui existe, ce qui change, ce qui a été testé et ce qui est livré ; ne pas transformer une note de conception en preuve d'exécution.
2. Examiner les invariants affectés : propriétaire des données, opérations uniques, permissions par canal, relations et fichiers, index/recherche, séparation serveur/client et pouvoirs admin/métier. Vérifier contributions UI, conservation des vues, contrat du widget et compatibilité des données selon l'impact.
3. Vérifier la pertinence des tests, leurs cas de refus et l'origine des résultats. Rapprocher preuves, SHA/tree, verrou de composition, profil et archive exacte. Une CI verte sur A ne couvre pas B ; une base main avancée exige la synchronisation prévue et des preuves actualisées.
4. Examiner séparément tout changement de workflows, validateurs, AGENTS, skills ou politique contre les contrats approuvés. Pour le bootstrap PR #1/P0, qualifier les premiers contrôleurs sans inventer une ancienne implémentation approuvée. Ensuite comparer aux versions déjà approuvées ; aucun retrait de contrôle non autorisé. Vérifier chemin/révision du workflow, run/tentative, SHA et résultats avec l'orchestrateur : un nom de check GitHub Actions ne prouve pas cette origine. La documentation des protections ne prouve pas leur activation.
5. Retourner des défauts concrets avec emplacement, scénario, conséquence et contrat concerné, puis les limites de la revue. Distinguer défaut établi, risque à vérifier et préférence facultative. Vérifier aussi que les assertions du test correspondent au résultat demandé : une restriction supplémentaire inventée par le test n'est pas une exigence produit. Ne pas bloquer sur une amélioration facultative ou une nouvelle question produit quand les décisions existantes suffisent.
6. La revue technique est confiée à un autre agent que celui qui a réalisé le changement, avec SHA final, base, périmètre et conclusion explicites. Conserver la preuve hors du commit source ou dans un artefact associé pour ne pas changer la révision revue. Le même compte GitHub peut développer et fusionner : aucune deuxième identité ni approbation GitHub n'est exigée. Ne pas transformer la revue en auto-approbation distante, ni fusionner, publier ou envoyer un commentaire hors du mandat reçu.

Conclure par les corrections nécessaires ou l'absence de défaut constaté dans le périmètre examiné, sans certification universelle ni faux résultat de test. Une nouvelle modification pertinente impose de réexaminer les preuves et la revue concernées.

## Dépendances entre modules

Appliquer le [contrat commun](../../../docs/DEPENDANCES-MODULES.md). Relire les déclarations, origines, plages, ports publics et contributions facultatives avec le verrou et le plan de changement. Vérifier les consommateurs, les références non déclarées et les tests d’absence/incompatibilité/retrait. Une bibliothèque npm installée ne prouve pas un module métier actif ; une fixture T-02 ne prouve pas le gestionnaire ou la publication.
