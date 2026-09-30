# Consignes locales

Respecter `docs/STANDARD-MODULE.md`, REQ-2601/2602 et les consignes racine. Toute sortie n8n passe par le port de l’hôte ; ne jamais appeler `fetch` depuis un handler, stocker une clé hors coffre, installer n8n ou créer un scheduler. Le POST webhook autorisé utilise uniquement l’intention durable et le coffre dédiés ; 2xx signifie accepté, non terminé, et une issue inconnue ne se rejoue pas. Garder les six suites et distinguer les tests simulés de la recette réelle reportée.
