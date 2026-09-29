# T18 — Messagerie native

Réalisation de [REQ-1801](EXIGENCES.md#REQ-1801) et [US-18](USER-STORIES.md#US-18), suivie dans le [backlog](TODO.md#T-18). La tranche initiale est intégrée par PR #42 ; la décision de partage entre interfaces et le journal SDK sont suivis sur `core/t18-shared-messaging-sdk`.

## Périmètre en cours

Le module `creezio.messaging` réunit les boîtes, messages, brouillons, destinataires, pièces jointes privées et l'état du transport. Les interfaces workspace réemploient le webmail du kit Creezio original : dossiers, liste et lecture sur trois panneaux, rédaction et gestion des pièces jointes. L'adaptation porte sur les ports publics du SDK, les opérations communes et D1/R2 ; le shell et le chat d'administration ne sont pas remplacés.

Les lectures et mutations passent par le même moteur pour le workspace, l'API et le MCP. Les modèles actuels alimentent le générateur central de schéma ; le module ne fournit aucun script de transformation de bases ni initialisation implicite au démarrage. Une mise à jour doit conserver les données existantes.

Décision utilisateur du 28 septembre : les boîtes, messages, brouillons et pièces jointes appartiennent au principal dans son contexte, indépendamment de l'interface. Le même utilisateur autorisé les retrouve dans le workspace et le front. Les credentials, permissions et curseurs restent liés à leur audience ; révoquer l'accès admin ne révoque pas automatiquement le droit applicatif. Les fichiers privés utilisent le propriétaire `principal`, avec garde de contexte et d'audience à chaque opération.

Sans fournisseur configuré, la rédaction reste disponible et l'envoi/réception est explicitement indisponible. Le socle n'héberge aucun serveur SMTP/IMAP et ne lance aucun ordonnanceur. Un résultat inconnu chez un fournisseur ne doit jamais être transformé en envoi confirmé ou rejoué automatiquement.

## Widgets de lecture — tranche en qualification

Trois cartes partagent les mêmes boîtes et droits que la messagerie : boîtes, messages et brouillons. Les listes conversationnelles utilisent des projections serveur de cinq éléments au maximum, avec extraits explicitement signalés et sortie bornée à 7 600 octets sous le plafond du chat. Le contenu complet est lu seulement sur demande ; un message HTML est présenté en texte dans la carte et renvoie à la messagerie pour sa mise en forme. Le module conserve ses modèles actuels et son interface native.

Les outils directs des cartes appellent les opérations du module, sans envoi de courrier, mutation implicite au montage ou dépendance à un fournisseur. Le contrôle des curseurs, du propriétaire, du contexte et des permissions reste serveur. La qualification source, les tests sur archives autonomes et la recette dans le chat sont des étapes distinctes ; la présence du renderer ne clôt pas la recette ChatGPT.

## Qualification historique avant les widgets

Les six suites locales ont passé 19 tests initiaux (8 backend, 5 UI, 3 API/MCP et un dans chaque suite widgets, paquet et documentation). Après revue, la suite UI passe six tests et les parcours de sélection du brouillon sauvegardé, du lecteur après sauvegarde répétée et de restauration de la boîte sont corrigés. La suite widgets vérifie l'absence déclarée de renderer et le maintien des outils MCP textuels ; elle ne constitue pas une recette ChatGPT.

Le test `tests/modules/messaging-integration.test.mjs` passe sur de vrais D1/R2 Miniflare : création de boîte idempotente, sauvegarde/relecture du brouillon, conflit de révision, refus entre comptes/audiences/contextes, classement et recherche, envoi indisponible sans faux effet, publication/lecture/retrait d'une pièce jointe privée, conservation des octets après détachement, suppression du brouillon, révocation des droits. HTTP et MCP appellent le même moteur avec un jeton machine réellement accordé ; le changement d'audience est refusé. Un message ancien reste accessible par dossier, non-lu et fil malgré 25 messages plus récents dans un autre dossier. Ce test fait partie de la suite centrale `modules`, sans nouveau moteur de données ni fixture produit.

Les commandes liant ou retirant une pièce jointe gardent la révision du brouillon dans le même batch D1. Le retrait combine un lien enfant sans révision propre et un CAS du parent : son contrat ne prétend donc pas utiliser la garde générique `object-version` sur chaque plan, mais le CAS du module est testé. Les fichiers R2 détachés restent privés et conservés ; aucune purge implicite n'est ajoutée.

Les contrôles ciblés de composition, d'inventaire et d'intégration ont passé 16 tests avant les derniers ajustements UI et du filtre exact. Le filtre corrigé et les 25 messages de régression ont ensuite passé la recette D1. La revue indépendante du candidat `893eb44` ne relève plus de défaut après trois corrections de reprise UI. La compilation locale `e17a87f` a réussi ses cinq étapes ; la recette navigateur utilise ensuite le code corrigé `893eb44` en développement. La base locale existante reçoit uniquement les ajouts du schéma central et conserve son compte.

La première CI complète a révélé deux fixtures restées sur cinq modules : le catalogue MCP attendu et la liste des descripteurs du test du gestionnaire. Elles chargent désormais la composition sélectionnée, et le test OAuth vérifie aussi que le nouveau module demeure invisible sans son droit. Le test D1 du gestionnaire passe après correction ; la nouvelle CI complète et la recette navigateur restent à vérifier. Aucun déploiement distant, parité complète ni réception/envoi par fournisseur réel n'est acquis à ce stade.

La projection initiale du chat retenait au plus seize outils autorisés et pouvait masquer Messaging. Le correctif [T15](IMPLEMENTATION-T15.md) élargit cette projection avec des bornes explicites de nombre et de taille, des diagnostics et les mêmes contrôles de droits. Sa qualification reste distincte de la recette métier de messagerie et de son transport externe. Le module reste utilisable dans son interface sans LLM.

Les liens aux tâches humaines restent reportés avec T17. Les compléments de comptes, données, opérations et OAuth reportés par l'utilisateur ne sont pas ajoutés par ce lot.

## Intégration et recette locale du 28 septembre

PR #42 fusionnée sur main `92b0958b9f5d8ae3885a708b06333449b4e9714d`, arbre identique au candidat `4318bdabc1e7fa8b59dead23ce553d9647de2753`. La CI du candidat a réussi 1 186/1 186 tests sans omission, avec revue indépendante exacte. Le dernier correctif réserve 52 lectures pour la page maximale des pièces jointes : deux contrôles boîte/brouillon et jusqu’à cinquante références.

La CI de main a également réussi 1 186/1 186 tests sans omission lors de la deuxième tentative du run `36467159947`. La première tentative avait atteint le délai externe du job et n’est pas comptée comme réussite.

La recette navigateur locale a confirmé deux boîtes, trois sauvegardes du même brouillon avec lecteur à jour, retour après rechargement et changement d’onglet, puis affichage et téléchargement d’une pièce jointe de contenu identique. L’upload est passé par l’API native car le navigateur automatisé ne permettait pas son sélecteur sans élargir une permission ; aucune permission navigateur n’a été changée. La déconnexion finale est confirmée. Cette recette précède la décision de partage ; elle ne qualifie ni le nouveau parcours entre interfaces, ni fournisseur de courrier, ni déploiement hébergé.

## Partage et reprise des commandes — SDK 1.2

Le test réel D1/R2 de la nouvelle candidate vérifie le partage ADMIN vers APP et APP vers ADMIN, les révisions communes des brouillons, les octets des pièces jointes dans les deux interfaces et les refus entre principals et contextes. Une révocation admin laisse la lecture applicative autorisée disponible. Les témoins locaux antérieurs sont conservés ; aucun schéma incompatible n'est appliqué implicitement.

Le journal public `@creezio/sdk/operations/command-journal` centralise le suivi des mutations d'interface. La vue conserve les identifiants avant émission, restaure uniquement le scope de session vérifié, bloque un second envoi si l'issue est inconnue et inspecte le statut sans rejouer l'action. Le schéma de panneau déclare les métadonnées persistées. Les champs métier restent dans les modèles et formulaires du module. Le SDK 1.2 est publié ; sa provenance et ses consommateurs qualifiés figurent dans [T30](IMPLEMENTATION-T30.md).

PR #44 est fusionnée sur `9cd410be0309a006e2ff5cbf24dc847d0144e39b`, arbre identique au candidat `21e6d2c401c6f4fb43f0904d161a75f2d4fec176`, CI candidate 1 196/1 196 et revue indépendante sans anomalie ouverte. Docker Linux a été construit depuis ce candidat dans le checkout et le volume existants. L'application native du schéma additif a conservé le propriétaire, la conversation, le brouillon et le fichier témoins ; aucune transformation des anciennes tables n'a été imposée.

La nouvelle recette navigateur admin/app a vérifié les mêmes boîtes A/B, le brouillon enregistré puis modifié depuis l'autre audience et relu dans la première, sa conservation après rechargement et les bascules de boîte. Une nouvelle pièce jointe privée de 108 octets apparaît dans les deux lecteurs ; les deux API retournent le même identifiant et les octets exacts. Upload et lien ont été exécutés une fois, via les API natives. Le sélecteur et le téléchargement dans le navigateur ne sont pas qualifiés par cette recette. Sessions déconnectées et runtime arrêté avec code 0 après contrôle ; données conservées. Les fournisseurs externes, widgets et publications hébergées restent ouverts.

## Contrôle de démarrage du profil complet — 29 septembre

La PR #59/main `468b101` a passé 1 258/1 258 contrôles. Son image Linux a été construite et le schéma adopté sans DDL dans le volume existant. Le démarrage a ensuite refusé le catalogue MCP statique : 18 529 969 octets dépassent la borne de 16 Mio, malgré des ressources individuelles conformes. L’application de qualification est arrêtée ; données et image sont conservées. Le correctif commun augmente uniquement la borne de cet inventaire à 24 Mio et valide le vrai catalogue dès la composition. Une nouvelle image et la recette réelle des trois cartes sont encore nécessaires ; les tests des modules ne valent pas cette preuve.
