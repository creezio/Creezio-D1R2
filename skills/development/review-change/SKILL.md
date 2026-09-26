---
name: review-change
description: "Relire une proposition Creezio contre le standard approuvé, le contrat produit et les preuves de sa révision réelle, sans s'attribuer une approbation indépendante."
---

# Relire un changement

Lire les [règles communes et la phase autorisée](../../README.md), le [standard de développement](../../../docs/DEVELOPMENT-STANDARD.md), le [standard de module](../../../docs/STANDARD-MODULE.md), le [cycle Git](../../../docs/GIT-FLOW.md) et les [exigences](../../../docs/EXIGENCES.md) concernées. Avant le GO, relire conception, documents et critères ; ne pas déclarer conformes des contrôleurs ou fonctions encore absents.

1. Identifier demande, base, révision candidate, composition et diff réel. Comparer résultat proposé et parcours attendus. Distinguer ce qui existe, ce qui change, ce qui a été testé et ce qui est livré ; ne pas transformer une note de conception en preuve d'exécution.
2. Examiner les invariants affectés : propriétaire des données, opérations uniques, permissions par canal, relations et fichiers, index/recherche, séparation serveur/client et pouvoirs admin/métier. Vérifier contributions UI, conservation des vues, contrat du widget et compatibilité des données selon l'impact.
3. Vérifier la pertinence des tests, leurs cas de refus et l'origine des résultats. Rapprocher preuves, SHA/tree, verrou de composition, profil et archive exacte. Une CI verte sur A ne couvre pas B ; une base main avancée exige la synchronisation prévue et des preuves actualisées.
4. Examiner séparément tout changement de workflows, validateurs, AGENTS, skills ou politique. La politique approuvée précédente juge la proposition ; celle-ci ne peut retirer ses propres contrôles pour obtenir un succès. La documentation des protections ne prouve pas leur activation dans GitHub.
5. Retourner des défauts concrets avec emplacement, scénario et conséquence, puis les limites de la revue. Distinguer défaut établi, risque à vérifier et préférence facultative. Ne pas bloquer sur une nouvelle question produit quand les décisions existantes suffisent.
6. Une analyse de revue ne vaut pas approbation GitHub indépendante. Ne pas approuver sous l'identité auteur/dernier pousseur ; une seule identité disponible bloque cette approbation, pas la préparation des corrections. Ne pas fusionner, publier ou envoyer un commentaire externe hors du mandat reçu.

Conclure par les corrections nécessaires ou l'absence de défaut constaté dans le périmètre examiné, sans certification universelle ni faux résultat de test. Une nouvelle modification pertinente impose de réexaminer les preuves et la revue concernées.
