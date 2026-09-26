---
name: create-app
description: "Préparer ou créer une application Creezio dérivée avec provenance, composition et hébergement. Pour une extension seule, utiliser create-module."
---

# Créer une application

Lire les [règles communes et la phase autorisée](../../README.md), le [PRD](../../../docs/PRD.md), les [parcours](../../../docs/USER-STORIES.md) et le [cadre produit](../../../docs/CADRE-PRODUIT-ET-COMMUNAUTE.md). Avant le GO, produire les choix et contrats documentés ; ne pas créer l'application. Après le GO, vérifier que le socle et l'outillage requis par ce jalon existent réellement.

1. Déterminer le mode de création : vrai fork GitHub, copie d'une release/SHA, ou dépôt indépendant pour des sources privées. Vérifier les outils, accès et propriétaire disponibles ; une connexion de lecture ne garantit pas le droit de créer un fork. Respecter le jalon du premier fork fixé par le PRD et ne pas lui substituer un template.
2. Réutiliser les sources et espaces prévus. Enregistrer origine, révision, composition verrouillée et mode de création. Donner au projet et à ses déploiements leurs identités propres, sans recopier secrets, données, comptes de démonstration ou droits premium d'une autre app. Une copie sans GitHub conserve sa provenance sans prétendre posséder une filiation GitHub.
3. Choisir la composition utile : workspace à rôles suffisant pour une app personnelle ou interne, front facultatif composé par thème ou front headless. L'accès au workspace n'accorde pas l'administration système. Utiliser les mêmes modèles et opérations ; aucun backend supplémentaire par utilisateur.
4. Appliquer les capacités de l'hébergement : Sites utilise son couple D1/R2 ; local Miniflare permet le développement hors ligne ; la production Cloudflare doit être indépendante du local. Suivre [stockage et hébergement](../../../docs/STOCKAGE-ET-HEBERGEMENT.md), sans annoncer une capacité non qualifiée.
5. Préparer onboarding, propriétaire vérifié et enregistrement requis à la publication officielle. GitHub, registre, création du Site et publication sont des étapes distinctes et reprenables ; une reprise réutilise les ressources déjà créées. Les protections d'un dépôt doivent être configurées et vérifiées dans leur mandat, jamais supposées héritées du fork.

Conserver dans les documents de l'application la composition, les critères de démarrage et les limites. Pour contribuer ou livrer ensuite, suivre le [cycle Git](../../../docs/GIT-FLOW.md) et le guide concerné. Annoncer uniquement les ressources réellement créées et les parcours réellement vérifiés.
