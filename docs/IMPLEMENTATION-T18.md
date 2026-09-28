# T18 — Messagerie native

Réalisation de [REQ-1801](EXIGENCES.md#REQ-1801) et [US-18](USER-STORIES.md#US-18), suivie dans le [backlog](TODO.md#T-18). Branche de travail : `core/t18-native-messaging`.

## Périmètre en cours

Le module `creezio.messaging` réunit les boîtes, messages, brouillons, destinataires, pièces jointes privées et l'état du transport. Les interfaces workspace réemploient le webmail du kit Creezio original : dossiers, liste et lecture sur trois panneaux, rédaction et gestion des pièces jointes. L'adaptation porte sur les ports publics du SDK, les opérations communes et D1/R2 ; le shell et le chat d'administration ne sont pas remplacés.

Les lectures et mutations passent par le même moteur pour le workspace, l'API et le MCP. Les modèles actuels alimentent le générateur central de schéma ; le module ne fournit aucun script de transformation de bases ni initialisation implicite au démarrage. Une mise à jour doit conserver les données existantes.

Sans fournisseur configuré, la rédaction reste disponible et l'envoi/réception est explicitement indisponible. Le socle n'héberge aucun serveur SMTP/IMAP et ne lance aucun ordonnanceur. Un résultat inconnu chez un fournisseur ne doit jamais être transformé en envoi confirmé ou rejoué automatiquement.

## Qualification

Les six suites locales ont passé 19 tests initiaux (8 backend, 5 UI, 3 API/MCP et un dans chaque suite widgets, paquet et documentation). Après revue, la suite UI passe six tests et les parcours de sélection du brouillon sauvegardé, du lecteur après sauvegarde répétée et de restauration de la boîte sont corrigés. La suite widgets vérifie l'absence déclarée de renderer et le maintien des outils MCP textuels ; elle ne constitue pas une recette ChatGPT.

Le test `tests/modules/messaging-integration.test.mjs` passe sur de vrais D1/R2 Miniflare : création de boîte idempotente, sauvegarde/relecture du brouillon, conflit de révision, refus entre comptes/audiences/contextes, classement et recherche, envoi indisponible sans faux effet, publication/lecture/retrait d'une pièce jointe privée, conservation des octets après détachement, suppression du brouillon, révocation des droits. HTTP et MCP appellent le même moteur avec un jeton machine réellement accordé ; le changement d'audience est refusé. Un message ancien reste accessible par dossier, non-lu et fil malgré 25 messages plus récents dans un autre dossier. Ce test fait partie de la suite centrale `modules`, sans nouveau moteur de données ni fixture produit.

Les commandes liant ou retirant une pièce jointe gardent la révision du brouillon dans le même batch D1. Le retrait combine un lien enfant sans révision propre et un CAS du parent : son contrat ne prétend donc pas utiliser la garde générique `object-version` sur chaque plan, mais le CAS du module est testé. Les fichiers R2 détachés restent privés et conservés ; aucune purge implicite n'est ajoutée.

Les contrôles ciblés de composition, d'inventaire et d'intégration ont passé 16 tests avant les derniers ajustements UI et du filtre exact. Le filtre corrigé et les 25 messages de régression ont ensuite passé la recette D1. La revue indépendante du candidat `893eb44` ne relève plus de défaut après trois corrections de reprise UI. La compilation locale `e17a87f` a réussi ses cinq étapes ; la recette navigateur utilise ensuite le code corrigé `893eb44` en développement. La base locale existante reçoit uniquement les ajouts du schéma central et conserve son compte.

La première CI complète a révélé deux fixtures restées sur cinq modules : le catalogue MCP attendu et la liste des descripteurs du test du gestionnaire. Elles chargent désormais la composition sélectionnée, et le test OAuth vérifie aussi que le nouveau module demeure invisible sans son droit. Le test D1 du gestionnaire passe après correction ; la nouvelle CI complète et la recette navigateur restent à vérifier. Aucun déploiement distant, parité complète ni réception/envoi par fournisseur réel n'est acquis à ce stade.

Limite du chat interne à traiter dans T15 : sa projection retient au plus seize outils autorisés. Un compte disposant de nombreux droits peut donc ne pas recevoir les outils Messaging, même si son API et son MCP les exposent correctement. Le diagnostic `catalog:limit` existe, mais la sélection des modules/outils et sa recette doivent être complétées avant d'annoncer leur disponibilité générale dans le chat. Le module reste utilisable dans son interface sans LLM.

Les liens aux tâches humaines restent reportés avec T17. Les compléments de comptes, données, opérations et OAuth reportés par l'utilisateur ne sont pas ajoutés par ce lot.

## Intégration et recette locale du 28 septembre

PR #42 fusionnée sur main `92b0958b9f5d8ae3885a708b06333449b4e9714d`, arbre identique au candidat `4318bdabc1e7fa8b59dead23ce553d9647de2753`. La CI du candidat a réussi 1 186/1 186 tests sans omission, avec revue indépendante exacte. Le dernier correctif réserve 52 lectures pour la page maximale des pièces jointes : deux contrôles boîte/brouillon et jusqu’à cinquante références.

La CI de main a également réussi 1 186/1 186 tests sans omission lors de la deuxième tentative du run `36467159947`. La première tentative avait atteint le délai externe du job et n’est pas comptée comme réussite.

La recette navigateur locale a confirmé deux boîtes, trois sauvegardes du même brouillon avec lecteur à jour, retour après rechargement et changement d’onglet, puis affichage et téléchargement d’une pièce jointe de contenu identique. L’upload est passé par l’API native car le navigateur automatisé ne permettait pas son sélecteur sans élargir une permission ; aucune permission navigateur n’a été changée. La déconnexion finale est confirmée. La politique de partage de boîte entre audiences reste à préciser. Ces preuves locales ne qualifient ni fournisseur de courrier ni déploiement hébergé.
