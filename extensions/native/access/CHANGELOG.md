# Changelog access

## 0.0.0 — travail non publié

Modèles d'identité : comptes, mots de passe, sessions, installation explicite, audit technique et admission. SQL généré centralement et persistance exercée dans D1.

Ajout des modèles de contextes, memberships par audience, rôles, héritages, grants, exceptions et affectations. Le bootstrap crée leur seed minimal dans son batch conditionné ; l'audit accepte les mises à jour d'autorisation. Les liens composites empêchent les affectations et exceptions orphelines ou rattachées à une autre audience. Résolution et mutations protégées se qualifient avec les services du cœur.

Ajout du modèle privé `account_capabilities` pour invitation, activation et reset : empreinte unique, versions de la cible, expiration et états consommé/révoqué. L'audit garde désormais acteur, cible et identifiant de capacité ; les événements de cycle de compte sont distincts. Les contraintes D1 et les services internes se qualifient dans la tranche T-04 correspondante, sans attribution de rôle ni connexion automatique. Aucun e-mail n'est envoyé par ce modèle.

Ajout des credentials API privés et de leurs scopes relationnels par contexte/audience/permission. Parseur strict partagé pour déclarations et projections D1, sans fusion silencieuse ni produit cartésien. L'audit accepte création/statut de service et émission/rotation/révocation de jeton, avec identifiant de credential historique. Les services machine et leurs guards se qualifient séparément ; aucun rôle natif implicite ni validation humaine par token.

Connexion HTTP, gestion visuelle des droits et interfaces encore à construire ; aucune publication produit ni version de paquet distribuée annoncée.
