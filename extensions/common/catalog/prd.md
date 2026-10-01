# T25 — Catalogue métier réutilisable

## Parcours

L’éditeur crée des catégories et produits (SKU, description, attributs clé/valeur, prix minor/devise), contrôle leur publication et lie jusqu’à cinq images privées. L’utilisateur app authentifié consulte et recherche uniquement les produits publiés. Les clients MCP présentent résultats et fiche dans deux widgets distincts, avec repli textuel et lecture directe autorisée.

Dans le front authentifié, le bouton d’ouverture d’une carte produit expose `data-creezio-analytics-id="catalog.product.open"` pour l’instrumentation T22 facultative. Cette valeur est identique sur toutes les cartes : aucune identité ou donnée du produit n’est transmise comme nom d’action. Quand la politique Analytics est désactivée, le clic conserve son seul effet de navigation vers la fiche.

Toutes les mutations de l’éditeur utilisent le journal public du SDK `^1.5.0` : l’action est persistée dans le panneau avant émission, une issue incertaine bloque toute deuxième émission, et le bouton de vérification consulte le statut de la même clé. Un échec de persistance interdit l’envoi.
La restauration des filtres, de l’onglet, de la sélection et de l’action en attente exige une identité de panneau identique (`sessionId`, audience, contexte). Les états anciens sans identité sont écartés.

## Frontière

Le port `catalog.products@1.0.0` est une dépendance métier versionnée, pas un endpoint anonyme. Prix, statut et révision doivent être relus avant toute opération future de panier ou paiement. Aucun panier, paiement, stock, TVA, tarification par groupe, import CSV, index tiers ou service externe n’appartient à cette tranche. Les images sont lisibles par le front authentifié uniquement si elles restent liées à un produit publié du même contexte ; la lecture binaire commune vérifie le droit et la relation avant et après R2. Aucun endpoint anonyme, URL publique persistante ou accès aux images de brouillons n’est créé.

Dans les widgets app, la même lecture liée peut fournir une image privée au seul composant via `_meta`, sans octets dans le contenu modèle. La liste ne charge que la première image d’une carte visible et la fiche reste bornée à cinq liens. Les widgets admin restent textuels ; aucun rendu distant externe n’est présumé qualifié par les seuls tests locaux.

## Acceptation locale

Créer/modifier/publier/archiver avec CAS et idempotence ; empêcher doublons SKU/slug, liens de catégorie invalide et lecture app des brouillons. Tester recherche et pagination sans perte sous contenus maximaux, contexte/droits/audiences, lecture R2 liée depuis un autre principal, refus après détachement/archivage/révocation, voie privée conservée, API/MCP machine et widgets multiples, packaging et docs.
