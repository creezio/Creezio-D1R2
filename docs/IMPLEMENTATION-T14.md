# Réalisation T-14 — Conversations natives

## Correctif candidat — hydratation du brouillon sélectionné

Après la lecture du titre, le panneau attend la lecture du brouillon D1 avant d’activer la saisie ou l’envoi. Si cette lecture tarde ou échoue, le contrôleur garde le brouillon non hydraté et refuse `draft.save` et `turn.start` sans inventer une révision 0. Le texte local reste attaché à son fil et reprend avec la révision obtenue lors d’une nouvelle lecture, y compris après un aller-retour entre conversations. Les messages et la reprise d’un tour mémorisé restent lisibles. Les tests ciblés du contrôleur (16/16) et du panneau (15/15) passent ; la recette navigateur après livraison reste à faire. Aucun fournisseur n’est appelé pour ce correctif.

T-14 / US-14 / REQ-1401 et REQ-1402. PR #23 intégrée : candidat `efe476eb`, main `f435fd36`, arbre commun `d43e86e3`. Les 974 tests locaux et CI candidat/main (36309174628/36309958508) réussissent, sans échec, ignoré, annulé ou todo. Les trois revues indépendantes, les recettes navigateur et les contrôles de provenance sont conservés hors sources. La qualification hébergée et le fournisseur se poursuivent dans leurs lots.

## Module et interface

`creezio.conversations` possède ses conversations, messages, brouillons, exécutions, événements et références de pièces jointes. Les mêmes opérations déclarées servent au workspace, au front et aux clients API/MCP. Le principal effectif, l'audience et le contexte viennent de l'hôte ; le module ne reçoit ni credential ni SQL libre. Les permissions de l'installation doivent accorder l'accès explicitement.

Le panneau, son bouton flottant, Chat/Work, la liste, le fil et la saisie reprennent les composants du Creezio original `packages/assistant/ui`. Les dépendances aux routes/stockages et fournisseurs internes sont remplacées par le SDK public ; aucun chat métier ne remplace celui du back-office. Le front reçoit une vue réutilisable enregistrée par manifeste. Sans fournisseur configuré, l'interface le dit explicitement et ne simule aucune réponse IA.

Le renommage est disponible par les opérations API/MCP et le SDK ; le panneau original n'avait pas de commande de renommage. Aucun contrôle de renommage UI n'est annoncé dans cette tranche. L'historique s'ouvre depuis les messages récents et permet de charger les précédents sans remplacer le fil existant.

## Données et reprise

Les listes utilisent un index déclaré et un curseur déterministe, avec la clé primaire comme départage. Une recherche peut parcourir plusieurs pages autorisées de titres et messages ; une page vide avec curseur ne prouve pas l'absence globale de résultats. Les références entre modèles du module sont vérifiées dans le batch sous les permissions courantes. Aucun accès privé intermodule n'est ouvert.

Les commandes utilisent le journal commun et l'idempotence ; une réponse perdue se réconcilie par lecture. Une demande d'annulation ne prouve pas l'arrêt du fournisseur. Les événements persistants se lisent depuis un client actif, sans boucle de traitement serveur. La qualification d'un vrai fournisseur et de sa réception progressive se poursuit en T15.

La reprise d'une réponse fournisseur connue peut aboutir à un appel d'outil avant la réponse finale. Lorsqu'un tour auparavant incertain enregistre le résultat de cet outil et crée sa continuation durable, son état redevient `running` et son ancien code `provider_unknown` est effacé dans le même batch CAS. Le prochain drive traite cette continuation ; il ne rejoue pas la création initiale. Un résultat d'outil rejeté reste un rejet explicite, sans réponse finale simulée. Le test D1 reproduit `unknown → tool_result → running` avec un seul appel initial au fournisseur ; la réponse finale du même tour a ensuite été confirmée sur le Site T61 publié en 938ede5, après une reprise explicite et une continuation. Cette recette ne qualifie pas le correctif encore non déployé.

## Pièces jointes privées

Le catalogue de fichiers est compilé depuis les catégories déclarées et les audiences exposées. Le transport binaire natif `/api/files/{audience}/{moduleId}/{categoryId}` contrôle identité, origine, contexte, permissions, taille et types. Un propriétaire opaque est dérivé du principal et de l'audience. Les références ne contiennent ni clé du bucket ni capacité d'accès.

Le téléversement laisse une intention privée. `OperationContext.files.preparePublication` produit les métadonnées vérifiées et un plan opaque ; le module associe ce plan à sa référence métier et à la garde de conversation dans la même transaction D1. Le contenu R2 est vérifié séparément, sans promesse de transaction entre ressources. Les intentions abandonnées conservent une reprise explicite du nettoyage. Une erreur réseau ne provoque aucun nouvel upload automatique.

## Qualification et limites

La composition de départ Access/Modules/Conversations a été mesurée à 3 493 827 octets serveur (SSR compris), 686 257 après gzip. L'ajout du module, de ses validateurs statiques et de l'interface justifie des plafonds locaux de régression à 3 600 000 / 710 000 octets, avec bornes de graphe et de temps inchangées. Ces valeurs ne sont ni des quotas fournisseurs ni une qualification Sites.

Les tests ciblés exécutent les permissions intercomptes/audiences/contextes, la pagination et la recherche à page vide, la concurrence et les rollback D1/R2. Des messages et brouillons de 16 000 caractères multioctets sont exercés avec la borne de réponse conservée. Les preuves exactes du candidat et du contrôle agrégé sont conservées hors sources.

La recette navigateur locale vérifie panneau original, création/historique/archives, brouillon restauré après redémarrage et rechargement, téléversement R2 associé atomiquement à la conversation, et lecture privée des octets attendus. Une réponse d'archivage perdue après HTTP 200 est retrouvée par lecture de la clé d'exécution sans seconde écriture. Le front conserve puis sauvegarde le brouillon après une navigation en moins de 600 ms ; rechargement et reprise ne produisent plus de faux conflit. L'audience app reste séparée de l'administration. La révocation retire les vues, le chat et leurs données protégées.

Les essais initiaux ont révélé puis corrigé une révision CAS fournie deux fois, des effets incomplets de manifeste, une sélection non restaurée et le délai de sauvegarde traversant une désactivation du panneau. Les preuves initiales sont conservées. Le contrôle de téléchargement confirme HTTP 200, le type binaire et les octets exacts ; l'enregistrement sur disque par le navigateur n'est pas qualifié, l'événement de téléchargement IAB ayant expiré.

La revue finale a aussi corrigé la sauvegarde avant changement de fil, l'ouverture sur les messages récents et la relecture après confirmation d'une commande incertaine. Création en 54 ms et sélection en 141 ms avant la temporisation conservent les brouillons ; une déconnexion/reconnexion relit le texte exact dans D1. Le build de recette `3b8c733` a le même code runtime que le candidat final, dont le dernier delta concerne un test et les verrous de validation. Les serveurs et sessions de recette ont été fermés.

La nouvelle cible Sites publique est autorisée sur le compte courant ; sa publication et sa recette restent distinctes. OpenAI réel, modèles/effort/voix selon fournisseur et widgets sont raccordés dans les lots T15/T16. Aucune réponse IA ni compatibilité ChatGPT réelle n'est déduite des seules recettes T14. Les modules et capacités non nécessaires à la première app suivent le jalon initial selon le TODO, sans retrait d'exigence.

## Candidat : lectures de connecteurs dans le chat natif

Le projecteur d'outils peut proposer une opération `query` avec un unique fournisseur externe lorsque ce fournisseur correspond à un descripteur de connecteur compilé du même module avec une ressource GET. Il conserve les contrôles de schéma, de droits courants, d'audience et de taille déjà appliqués aux autres lectures ; les commandes, appels interopérations, plans d'écriture, émissions et fournisseurs non liés à un connecteur restent exclus. Le pont reprojette avant chaque appel, puis le moteur réautorise l'opération. Pour une `query`, le port connecteur permet une seule requête GET déclarée, avec URL et paramètres fermés, réponse bornée, délai et relecture du coffre et des droits avant et après l'appel. Ce candidat ne vaut ni recette Meili dans une conversation réelle ni qualification fournisseur : la validation ciblée et la livraison sont à enregistrer séparément.
