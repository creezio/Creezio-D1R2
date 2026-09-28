# Décisions de réalisation T21

Le besoin REQ-2101 demande une édition visuelle et une publication conservatrice. Les sources historiques montrent des sections en DB, cinq préfabriqués, un éditeur de champs et une navigation pilotée par catalogue. L'adaptation garde ces interactions, mais remplace SQLite/Hono et upload base64 par D1/R2 et opérations communes. La donnée éditoriale est partagée par contexte applicatif, sous droits `pages.edit`, et non attachée au créateur individuel.

Le `publish` du module est la promotion atomique du contenu courant vers le snapshot publié. Le reset explicite restaure le brouillon depuis ce snapshot. Une réponse incertaine conduit à relire la version, sans rejouer la commande. Le front authentifié peut lire le snapshot dès maintenant. Un visiteur anonyme nécessite une projection hôte séparée, limitée aux champs publiés, et un accès public contrôlé aux médias ; ce périmètre a été signalé à l'orchestrateur avant tout changement commun.
