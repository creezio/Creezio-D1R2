# Livraison Cloudflare locale

Ce module optionnel ajoute une vue d’administration au workspace Creezio. Il prépare puis suit la publication du même code, des mêmes modules et des données de l’installation Docker locale vers Cloudflare Workers, D1 et R2.

Cette version candidate requiert `@creezio/sdk` `^1.9.0`. Les contrôleurs et modèles de vue Delivery sont importés par les sous-chemins publics du paquet SDK ; le module et ses suites de validation restent autonomes une fois archivés avec cette version du SDK.

La vue utilise le transport de l’opérateur local fourni par l’hôte. Elle n’expose aucune opération de publication par API de module ou outil MCP. Le droit `creezio.delivery:manage` limite la navigation ; l’hôte vérifie à nouveau la session, le CSRF et l’autorisation pour chaque transfert. La vue reste indisponible sur un hébergement autre que Docker local.

La configuration demande un compte et un nom de Worker ; l’opérateur crée ou retrouve les ressources D1/R2 et détermine l’adresse publiée. Le jeton Cloudflare reste dans le formulaire jusqu’à l’enregistrement, puis est effacé. Les connexions protégées sont désactivées sur la cible par défaut ; leur transfert exige une sélection explicite. Aucun secret n’est restitué par les réponses.

Si l’opérateur redémarre et perd le jeton en mémoire, l’administrateur peut le ressaisir pour la même cible. Le plan et l’identifiant du transfert restent inchangés ; l’opérateur refuse toute autre cible.

`prepare` fixe un identifiant, un digest et un résumé de plan sans arrêter l’application. `start` réutilise ces deux identifiants exacts, arrête le runtime local pour une capture cohérente, puis l’opérateur reste joignable pour `status` et `reconcile`. Une réponse incertaine se vérifie sur le même transfert avant toute nouvelle action. Le journal de livraison distingue publication, URL finale et état du registre.

Après une première livraison confirmée, le même écran propose un plan explicite de mise à jour du Worker existant. La mise à jour construit une nouvelle version, vérifie la cible, applique uniquement le schéma D1 compatible prévu, puis publie. Elle conserve les données D1/R2 et les secrets de production. L’identifiant et le digest du plan sont conservés avant le lancement ; une publication incertaine se vérifie sur cette même mise à jour.

Si l’upload de cette mise à jour reste incertain, un bouton de nouvelle tentative explicite réutilise l’artefact conservé. L’opérateur revalide son reçu, l’empreinte, le schéma D1 et la publication précédente, puis vérifie que la version Worker la plus récente est encore l’ancienne. Une preuve manquante ou divergente bloque le nouvel upload. Le journal conserve chaque tentative et la reprise ne se déclenche pas automatiquement ; cette option concerne la mise à jour du schéma principal, dans la limite de trois nouvelles tentatives.
