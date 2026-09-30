# PRD T29-HERMES — service agent externe

REQ-2901/2902. Creezio configure un service Hermes déjà fourni par son administrateur. Le module ne lance, n'installe et ne maintient aucun processus Hermes. Les raccords aux tâches Work T17 et au développement piloté par IA T23 restent dans leurs lots et sous leurs conditions respectives.

## Protocole retenu

Le [serveur API officiel Hermes](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/api-server.md) expose une découverte `/v1/capabilities`, les modèles, la création asynchrone `/v1/runs`, la consultation d'un run, son flux d'événements, son arrêt et ses demandes d'approbation. La création accepte `Idempotency-Key` et renvoie un identifiant de run ; le support réel doit être confirmé par la version et les capacités de l'instance configurée. Une réponse d'arrêt ne signifie pas que le travail est déjà terminé. Ces API sont la frontière du connecteur, sans accès aux internals Python ni au système hôte.

## Parcours Creezio

L'administrateur configure l'origine HTTPS et une référence de clé scellée. Une vérification affiche uniquement les capacités réellement annoncées et leur date de lecture. Le droit d'utiliser le service est distinct de celui qui permet de le configurer. Une clé ou une origine remplacée invalide les vues et intentions de l'ancienne connexion sans supprimer leur historique.

Une soumission explicite prépare une intention locale liée au contexte, au principal, à l'audience et à la génération de connexion. Elle fige les champs autorisés et la clé de demande avant l'appel sortant. Le port connecteur commun fournit l'origine, les en-têtes et l'idempotence ; le handler ne reçoit aucun secret. Le run distant est conservé avec sa provenance et peut être relu après fermeture du panneau. Une issue inconnue conserve la même intention ; aucune deuxième soumission automatique ne remplace un résultat perdu.

Le module conserve une projection bornée de la progression et du résultat. La consultation, l'arrêt et la reprise du suivi exigent les droits courants sur le run local ; un identifiant fournisseur fourni par un client ne suffit pas. Les réponses de capacités manquantes, les expirations et les états terminaux sont explicites. Une demande d'approbation attend une décision humaine, liée à l'action et au run exacts ; le chat ou le fournisseur ne peut pas l'accorder au nom de l'utilisateur.

La vue de configuration reprend celle de l'assistant Creezio original ; les vues de suivi reprennent ses composants compatibles. Les widgets offrent plusieurs lectures d'un même run et les actions permises par le contrat commun. Un retour au chat fournit du contexte ou un résultat, sans créer un tour LLM non demandé. Aucune planification durable n'entre dans le module : des appels API/MCP autorisés peuvent relire son état.

## Réemploi et validation

Les références originales sont `packages/assistant/src/runtime/hermes-client.ts`, `hermes-models.ts` et `hermes-kanban.ts`. Conserver leur vocabulaire et leurs comportements utiles ; remplacer le fetch libre, les adresses locales implicites, les variables de clés et les reprises qui pourraient redéclencher une soumission.

- [x] Contrat de configuration, capacités, runs, permissions, modèles et API/MCP en source.
- [x] Port mutateur commun, journal durable, projection et transitions de connexion vérifiés sur D1 local.
- [x] Vues workspace admin et app adaptées des cartes originales, sans chat parallèle.
- [x] Six suites de validation source et recette D1/hôte : perte d'accusé sans rejeu, révocation, idempotence, run étranger et champs secrets protégés.
- [x] Widgets MCP Apps de capacités, modèles et suivi d’un run local, avec lectures directes sous les droits courants et sans réémission de POST.
- [ ] Approbation : le POST d'approbation attend une fixture de la version Hermes réellement exploitée.
- [ ] Recette externe sur l'instance et la version réellement disponibles, avec soumission témoin autorisée, relecture et arrêt si nécessaire.

Les capacités encore absentes du fournisseur restent indisponibles avec un écart consigné. La présence du module, d'un mock ou d'une clé ne qualifie pas cette recette.
