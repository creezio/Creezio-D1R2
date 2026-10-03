# Changelog

## Non publié — sélection Support et CRM déclarée

Les boutons de liste Support et de grille CRM déclarent `support.ticket.open` et `crm.record.open` dans les vues workspace et front. Le collecteur et sa politique restent inchangés ; aucun contenu ni identifiant de fiche ou de ticket n’entre dans l’événement. Les tests client vérifient les routes déclarées et les deux audiences. La recette hébergée reste ouverte.

## Non publié — deux actions de clic explicites

Le bouton Actualiser du workspace Analytique porte `analytics.refresh` et la carte produit du front Catalogue porte `catalog.product.open`. Ces identifiants statiques alimentent la collecte de clics déjà désactivée par défaut ; aucun produit, texte de composant ou argument n'entre dans `actionId`. Le test client vérifie les attributs JSX des deux boutons puis le refus à politique désactivée et l'émission après activation. Recette navigateur hébergée encore ouverte.

## 0.0.0 — T22 collecte optionnelle et refus avant moteur

- Politique d’installation désactivée par défaut, avec interrupteurs indépendants navigation, clics et refus ; configuration administrateur protégée par `analytics.configure` et révision D1.
- Hooks workspace/front bornés aux routes déclarées et aux seuls clics portant un `data-creezio-analytics-id` stable. Émission `event.record` sous le contexte courant ; aucune capture de texte, requête, argument, en-tête ou jeton.
- Refus HTTP/MCP avant moteur dans une table D1 distincte, sans principal ni contexte métier. Consultation admin/application, aperçu et purge manuelle sous `analytics.purge` après sept jours par défaut ; cap de 10 000 lignes, aucune tâche de fond.
- Les écritures administratives restent dans les plans du moteur et son journal de commande ; la purge des événements déclarés conserve sa politique par contexte indépendante.

## 0.0.0 — T22 tranche indépendante

Six onglets analytics du Creezio original adaptés au SDK natif ; ingestion explicite, événements et agrégats paginés/ bornés dans D1, lecture admin et API/MCP à permissions distinctes. Les fonctions demandant des hooks hôte absents sont signalées sans valeur simulée.

- Journal d'exécutions existant et routes du catalogue compilé exposés au droit admin du contexte, sans payload ni nouveau journal ; export CSV/JSON filtré jusqu'à dix pages et neutralisation des formules CSV.

- Deux widgets de lecture administrateur : synthèse sept jours et événements paginés par cinq, sans nouvelle collecte.

- Rétention manuelle des événements déclarés : politique par contexte, permission `analytics.purge`, aperçu de dix lignes, suppression conditionnelle dans D1 et journal de commande SDK pour les issues incertaines. Aucune purge programmée ni suppression des journaux techniques.
