# T22 — Analytique et diagnostics

## Besoin

Un administrateur autorisé consulte l’usage et les erreurs dans son contexte, sans fuite de données sensibles. Les périodes, sources, bornes et résultats partiels sont explicites. L’API et MCP permettent les mêmes lectures selon les droits. Un client autorisé peut déclarer des événements sûrs, sans texte arbitraire.

## Première tranche

Six onglets hérités du produit original, alimentés par des événements déclarés et une vue de provenance. Filtres 24 h, 7 j, 30 j, 12 mois ; recherche et pagination du journal, export local CSV/JSON borné à dix pages/500 événements avec état partiel explicite, actualisation à 8 s en panneau actif. Contexte D1 isolé, audience admin pour lecture et droits séparés pour émission. Les valeurs ne sont pas des mesures exhaustives tant que les hooks hôte ne sont pas raccordés.

## Diagnostics et collecte livrés

Les exécutions du journal technique déjà maintenu par le moteur et les routes du catalogue HTTP compilé sont projetées dans le contexte avec droit admin, sans payload, secret, texte d’erreur ni principal. Les refus avant moteur HTTP/MCP sont consignés séparément dans D1 primaire, sans identité ni contexte métier, seulement après activation explicite de l’administrateur. Ils sont lisibles dans Journal sous `application`, avec aperçu et purge manuelle bornée après sept jours par défaut. Les trois interrupteurs navigation, clics et refus sont désactivés par défaut dans la politique d’installation `collection_policy`. `analytics.configure` autorise sa configuration sous contrôle de révision. L’activation relève de l’administration fonctionnelle, sans bandeau cookie.

Les vues déclarées du catalogue peuvent émettre `page_view` via `event.record` après activation ; seules les cibles munies d’un `data-creezio-analytics-id` stable peuvent émettre `click`. Le client n’inspecte pas les labels, texte, URL libre, requêtes, arguments, en-têtes ou jetons. Les événements restent sous le contexte courant et reçoivent le principal et la date de l’hôte. L’absence de collecte optionnelle ne signifie pas absence d’activité. La productivité complète, les heartbeats et l’export distant restent ouverts (voir TODO).

Deux actions fournissent des témoins explicites : Actualiser dans le workspace Analytique (`analytics.refresh`) et ouvrir une carte produit dans le front Catalogue (`catalog.product.open`). Le second identifiant est commun à toutes les cartes ; aucun ID, SKU ou nom de produit n’est collecté. Ces attributs ne modifient ni les opérations des boutons ni la politique désactivée par défaut. La recette navigateur des deux surfaces reste distincte des tests locaux.

## Rétention contrôlée des événements déclarés

Par défaut, aucune politique et aucune purge automatique. Un administrateur titulaire du droit distinct `analytics.purge` définit 1 à 3 650 jours de conservation pour son contexte, puis lit un aperçu des dix plus anciens événements admissibles avant de confirmer un lot. Chaque commande porte une clé de requête ; le moteur revalide la révision de politique, l'ordre du lot et chaque ligne au commit. Une politique ou une ligne changée fait refuser la commande. Le panneau conserve seulement les identifiants nécessaires pour inspecter une issue incertaine, sans rejouer la suppression. La suppression ne porte que sur `event`, jamais sur le journal technique ou les logs de transport.

## Rétention distincte des refus avant moteur

La politique d’installation conserve les diagnostics de refus sept jours par défaut, réglables de 1 à 365 jours. Aucun nettoyage planifié ne s’exécute. Sous `analytics.purge`, l’administrateur dans `application` prévisualise les dix plus anciens refus expirés puis confirme exactement ce lot. La suppression utilise des plans D1 du moteur, une lecture gardée de la révision et les dates exactes des lignes ; une issue inconnue se vérifie dans le journal de commande avant toute autre action. Les autres journaux et les événements déclarés ne sont pas touchés.
