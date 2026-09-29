# T25 — Catalogue métier réutilisable

## Parcours

L’éditeur crée des catégories et produits (SKU, description, attributs clé/valeur, prix minor/devise), contrôle leur publication et lie jusqu’à cinq images privées. L’utilisateur app authentifié consulte et recherche uniquement les produits publiés. Les clients MCP présentent résultats et fiche dans deux widgets distincts, avec repli textuel et lecture directe autorisée.

Toutes les mutations de l’éditeur utilisent le journal public du SDK `^1.3.0` : l’action est persistée dans le panneau avant émission, une issue incertaine bloque toute deuxième émission, et le bouton de vérification consulte le statut de la même clé. Un échec de persistance interdit l’envoi.
La restauration des filtres, de l’onglet, de la sélection et de l’action en attente exige une identité de panneau identique (`sessionId`, audience, contexte). Les états anciens sans identité sont écartés.

## Frontière

Le port `catalog.products@1.0.0` est une dépendance métier versionnée, pas un endpoint anonyme. Prix, statut et révision doivent être relus avant toute opération future de panier ou paiement. Aucun panier, paiement, stock, TVA, tarification par groupe, import CSV, index tiers ou service externe n’appartient à cette tranche. Les images sont lisibles par le front authentifié uniquement si elles restent liées à un produit publié du même contexte ; la lecture binaire commune vérifie le droit et la relation avant et après R2. Aucun endpoint anonyme, URL publique persistante ou accès aux images de brouillons n’est créé.

## Acceptation locale

Créer/modifier/publier/archiver avec CAS et idempotence ; empêcher doublons SKU/slug, liens de catégorie invalide et lecture app des brouillons. Tester recherche et pagination sans perte sous contenus maximaux, contexte/droits/audiences, lecture R2 liée depuis un autre principal, refus après détachement/archivage/révocation, voie privée conservée, API/MCP machine et widgets multiples, packaging et docs.
