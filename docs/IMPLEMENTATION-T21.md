# T21 — Pages et navigation

`creezio.pages-navigation` reprend les éditeurs, composants de landing et cinq familles de sections du Creezio original. Les quatre modèles D1 décrivent brouillons, snapshots publiés, réglages et navigation. Les opérations déclarées partagent validation, permissions, révisions et idempotence entre workspace, API et MCP ; le front thémé compose automatiquement sa contribution.

Publier produit un snapshot distinct du brouillon. Modifier le brouillon ne change pas silencieusement la version publiée. Les médias restent des objets privés R2 référencés par leur preuve native. Les liens et le contenu des sections sont validés et bornés ; les conflits de révision empêchent d'écraser une modification concurrente. Le journal SDK et les états de panneau conservent les commandes incertaines et les saisies entre onglets, y compris un JSON temporairement invalide pendant son édition.

Les six suites passent 19 contrôles. L'intégration D1 réelle vérifie brouillons, snapshots et frontières d'accès. L'assemblage des profils socle et front est en cours ; le navigateur et la publication hébergée ne sont pas encore qualifiés pour ce module.

La lecture du front livré ici requiert une identité native. Publication anonyme, distribution publique des médias, injection SEO et raccord de la navigation éditoriale au thème restent à réaliser via des ports hôte explicites. La navigation technique des modules déjà composée par le SDK ne remplace pas cette navigation éditoriale. Les outils MCP existent sans renderer de widget propre ; cette absence est déclarée et testée, sans prétendre avoir qualifié une UI ChatGPT.
