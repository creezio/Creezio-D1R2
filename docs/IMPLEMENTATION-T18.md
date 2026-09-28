# T18 — Messagerie native

Réalisation de [REQ-1801](EXIGENCES.md#REQ-1801) et [US-18](USER-STORIES.md#US-18), suivie dans le [backlog](TODO.md#T-18). Branche de travail : `core/t18-native-messaging`.

## Périmètre en cours

Le module `creezio.messaging` réunit les boîtes, messages, brouillons, destinataires, pièces jointes privées et l'état du transport. Les interfaces workspace réemploient le webmail du kit Creezio original : dossiers, liste et lecture sur trois panneaux, rédaction et gestion des pièces jointes. L'adaptation porte sur les ports publics du SDK, les opérations communes et D1/R2 ; le shell et le chat d'administration ne sont pas remplacés.

Les lectures et mutations passent par le même moteur pour le workspace, l'API et le MCP. Les modèles actuels alimentent le générateur central de schéma ; le module ne fournit aucun script de transformation de bases ni initialisation implicite au démarrage. Une mise à jour doit conserver les données existantes.

Sans fournisseur configuré, la rédaction reste disponible et l'envoi/réception est explicitement indisponible. Le socle n'héberge aucun serveur SMTP/IMAP et ne lance aucun ordonnanceur. Un résultat inconnu chez un fournisseur ne doit jamais être transformé en envoi confirmé ou rejoué automatiquement.

## Qualification

Les six suites locales passent : 19 tests (8 backend, 5 UI, 3 API/MCP et un dans chaque suite widgets, paquet et documentation). La suite widgets vérifie l'absence déclarée de renderer et le maintien des outils MCP textuels ; elle ne constitue pas une recette ChatGPT.

Le test `tests/modules/messaging-integration.test.mjs` passe sur de vrais D1/R2 Miniflare : création de boîte idempotente, sauvegarde/relecture du brouillon, conflit de révision, refus entre comptes/audiences/contextes, classement et recherche, envoi indisponible sans faux effet, publication/lecture/retrait d'une pièce jointe privée, conservation des octets après détachement, suppression du brouillon, révocation des droits. HTTP et MCP appellent le même moteur avec un jeton machine réellement accordé ; le changement d'audience est refusé. Un message ancien reste accessible par dossier, non-lu et fil malgré 25 messages plus récents dans un autre dossier. Ce test fait partie de la suite centrale `modules`, sans nouveau moteur de données ni fixture produit.

Les commandes liant ou retirant une pièce jointe gardent la révision du brouillon dans le même batch D1. Le retrait combine un lien enfant sans révision propre et un CAS du parent : son contrat ne prétend donc pas utiliser la garde générique `object-version` sur chaque plan, mais le CAS du module est testé. Les fichiers R2 détachés restent privés et conservés ; aucune purge implicite n'est ajoutée.

Les contrôles ciblés de composition, d'inventaire et d'intégration ont passé 16 tests avant les derniers ajustements UI et du filtre exact. Le filtre corrigé et les 25 messages de régression ont ensuite passé la recette D1. La CI distante, la revue finale, la recette navigateur et le déploiement restent à vérifier. Aucune parité complète ni réception/envoi par fournisseur réel n'est acquise à ce stade.

Les liens aux tâches humaines restent reportés avec T17. Les compléments de comptes, données, opérations et OAuth reportés par l'utilisateur ne sont pas ajoutés par ce lot.
