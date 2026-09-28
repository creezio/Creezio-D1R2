# T25 — Catalogue métier commun

`creezio.catalog` est une extension métier réutilisable, distincte des modules natifs obligatoires. Le profil `configuration/composition.catalog.json` l'ajoute au front standard pour sa qualification ; les profils usuels ne l'activent pas implicitement. Quatre modèles D1 gèrent catégories, produits, attributs et références d'images privées. Les prix sont exprimés en unités monétaires mineures avec devise explicite.

Le module fournit édition admin, lecture des produits publiés dans le front, opérations HTTP/MCP et port versionné `catalog.products@1.0.0`. Les consommateurs futurs dépendent de ce contrat ; ils ne lisent pas ses tables. Les vues reprennent les composants de catalogue identifiés dans WinHub sans reconstruire cette application ni importer son métier B2B. Révisions, SKU unique, état publié/archivé, droits par contexte et journal des mutations sont communs aux interfaces.

Deux widgets distincts servent la recherche/liste et la fiche produit, avec requêtes directes aux mêmes opérations. Le module reste utilisable sans chat ; il n'impose pas de capacité UI au seul backend headless. Les autres comportements conversationnels suivent le SDK partagé.

Les six suites passent 14 contrôles. Le test intégré D1/R2, HTTP et MCP vérifie visibilité des publications, pagination sur 520 lignes, CAS, frontières de contexte et liens médias. Le profil de qualification compose 12 modules et 18 vues, dont le catalogue front. Les recettes navigateur, chat interne et ChatGPT réel de ces deux widgets restent à effectuer ; ces contrôles locaux ne les déclarent pas acquises.

Les images actuelles restent privées et le front affiche un emplacement neutre tant qu'un port autorisé de distribution aux autres utilisateurs n'est pas raccordé. Panier, stock, taxes, paiement Stripe et recherche Meili appartiennent à leurs extensions ou intégrations déclarées ; ils ne sont pas simulés par ce catalogue.
