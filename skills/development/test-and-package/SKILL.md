---
name: test-and-package
description: "Qualifier un changement Creezio, ses suites pertinentes et les archives réellement distribuées, puis leur installation ou mise à jour dans une application hôte."
---

# Tests et paquets

Lire les [règles communes et le mandat courant](../../README.md), le [standard de développement](../../../docs/DEVELOPMENT-STANDARD.md), le [standard de module](../../../docs/STANDARD-MODULE.md) et les critères des [exigences](../../../docs/EXIGENCES.md). Utiliser les commandes présentes dans la révision travaillée et vérifier leurs preuves ; ce guide ne leur attribue pas une réussite par sa seule présence.

1. Vérifier les scripts et dépendances réellement disponibles. Le contrôleur commun sélectionne les suites selon le diff, les contrats et le profil ; ne pas retirer une suite pour obtenir un succès. Les six familles du module, les contrôles SDK indépendants et les intégrations affectées se complètent. Une justification sans objet doit être contrôlée.
2. Réutiliser installations, espaces et builds. Exécuter les vérifications adaptées au changement ; ne pas refaire une recette coûteuse inchangée sans motif. Pour un changement documentaire, contrôler cohérence et liens sans prétendre valider le runtime.
3. Lier les résultats à la révision ou au tree exact, au verrou de composition et au profil. Une erreur, une suite manquante/vide/skipped ou un artefact de maquette ne constitue pas un succès. Signaler un fournisseur inaccessible comme non vérifié. Les exemples invalides doivent produire les refus attendus du contrôleur.
4. Inspecter le contenu effectif du paquet : exports serveur/client, styles, assets, widgets, documents et notices ; absence de secrets, données privées, identifiants de démo et chemins locaux. Les tests et leur artefact de validation restent disponibles pour la recette, sans entrer dans le Worker de production.
5. Installer l'archive produite dans un hôte de recette, sans lien workspace caché. Vérifier opération API/MCP/widget, fichiers, droits, désactivation et mise à jour compatible. Une démo autonome ne remplace pas cette installation. Le paquet conversationnel et sa publication éventuelle se vérifient séparément du module complet.
6. Pour une candidate de PR, un résultat sur A ne valide pas B ni une nouvelle base main. Après intégration/release, le SHA et l'artefact réellement livrés doivent correspondre aux preuves ; appliquer le [cycle Git](../../../docs/GIT-FLOW.md).

Rendre un bilan des contrôles exécutés, échecs, éléments non vérifiés et artefacts identifiés. Une CI verte, une capture ou un healthcheck isolé n'est pas une recette produit complète. Nettoyer uniquement les temporaires créés devenus inutiles après vérification de leur usage.

## Finalisation d'une candidate avant push

Après la dernière édition d'un fichier déclaré dans le manifeste d'un module, y compris document ou test, recenser toutes les compositions qui le sélectionnent, profils actifs et exemples distribués compris. Pour chaque profil affecté, exécuter `npm run modules:lock -- --composition <chemin-de-composition>` sans `--write` (par exemple `configuration/composition.json` ou `configuration/composition.sites.json`) : le contrôleur existant compare le verrou aux archives déterministes **runtime et validation**. Pour une source `package`, fournir `--validation-receipt moduleId=chemin` depuis l'inventaire et vérifier le reçu ; ne pas substituer un checkout. Si un verrou est invalide, examiner le diff source, régénérer uniquement ce profil avec les mêmes arguments et `--write`, relire les nœuds et empreintes des deux archives, puis refaire le contrôle en lecture seule sur tous les profils affectés. Toute nouvelle édition déclarée rend ce contrôle caduc. Réutiliser le cache d'archives ; aucun nouveau validateur, hook ou build global n'est requis pour ce point.

## Dépendances entre modules

Appliquer le [contrat commun](../../../docs/DEPENDANCES-MODULES.md). Exercer dépendances requises et facultatives, versions/ports incompatibles, transitivité et cycles. Pour le packaging, utiliser les archives réelles des fournisseurs sans résolution cachée vers un checkout. Contrôler aussi les consommateurs après update/retrait, les contributions dans les six suites et les données conservées. La chaîne de plusieurs éditeurs et le scénario facultatif sont des critères du starter.
