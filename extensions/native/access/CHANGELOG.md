# Changelog access

## 0.0.0 — travail non publié

Modèles d'identité : comptes, mots de passe, sessions, installation explicite, audit technique et admission. SQL généré centralement et persistance exercée dans D1.

Ajout des modèles de contextes, memberships par audience, rôles, héritages, grants, exceptions et affectations. Le bootstrap crée leur seed minimal dans son batch conditionné ; l'audit accepte les mises à jour d'autorisation. Les liens composites empêchent les affectations et exceptions orphelines ou rattachées à une autre audience. Résolution et mutations protégées se qualifient avec les services du cœur.

Connexion HTTP, gestion visuelle des droits et interfaces encore à construire ; aucune publication produit ni version de paquet distribuée annoncée.
