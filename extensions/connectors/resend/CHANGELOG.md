# Changelog

## 0.2.0 — candidat source non publié

La lecture `received.read` renvoie désormais la connexion, sa révision et la liste exacte des métadonnées de pièces (IDs, noms, MIME et tailles), sans URL ni octets. Le GET est lié à la preuve de connexion vérifiée avant l'appel. `binaryDownloads` déclare le GET de métadonnées enfant et l'origine/chemin CDN pour le staging R2 privé via l'hôte, avec gardes atomiques de configuration et de coffre. Compatibilité source SDK 1.9.0 ; aucune recette Resend réelle ni publication d'archive n'est acquise.

## 0.1.0 — candidat source non publié

Configuration Resend par contexte avec expéditeur, clé API, secret webhook et jeton de service scellés ; lecture bornée des domaines et des courriels reçus confirmés par événement signé. Le POST `/emails` fixe transmet jusqu’à 50 pièces privées et 10 Mio cumulés via le port hôte. Les accusés signés sont conservés comme métadonnées et rapprochés par Messagerie. La récupération des pièces entrantes et la recette réelle restent ouvertes.
