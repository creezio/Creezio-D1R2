# Changelog

## Complément visuel T20 — candidat

Six widgets de lecture liste/fiche sont prévus pour entreprises, contacts et prospects, sur `list/search/read` existants et sous `crm.use`. Les outils textuels restent utilisables sans rendu ; les listes conservent le curseur et n'exposent aucune mutation. Les limites de taille du transport et du chat interne restent effectives.

La ressource `plugin/skills/crm.md` répertorie ces lectures et ressources pour les clients MCP, avec intégrité déclarée dans le manifeste. Le chat interne refuse toute sortie brute d'outil dépassant 8 192 octets avant rendu ; une page avec peu de fiches peut déjà atteindre ce seuil si les notes sont longues.

Le retour dans un onglet conserve maintenant les brouillons pendant la vérification native de session (`loading` ou `unavailable`). L'interface reste masquée jusqu'à vérification ; une déconnexion confirmée ou une nouvelle session, audience, contexte ou identité de panneau purge les états. Au premier chargement, une commande en attente est restaurée seulement après vérification de sa session, sans réémission. Les modèles et opérations CRM ne changent pas.

## 0.0.0 — candidat source T20

Contrats et opérations CRM natifs pour trois entités, relations internes, recherche bornée, conflits de révision, API/MCP et vue de prospection. Aucune release ni installation déclarée.

La composition fournit une vue workspace et une vue front consommée par les thèmes. Les fiches sont partagées dans un contexte entre les audiences autorisées. Révision d’ouverture, brouillon conservé entre onglets et suivi des mutations incertaines empêchent les écrasements et réémissions involontaires ; les changements de société d’un contact référencé sont protégés au commit.

Les sous-vues Entreprises, Contacts et Prospection gardent chacune leur formulaire non enregistré et sa révision pendant la navigation. Une nouvelle session, audience ou contexte efface ces brouillons en mémoire.
