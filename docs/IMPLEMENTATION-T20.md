# T20 — CRM natif

## Deux contextes logiques sur Original Sites — 2 octobre 2026

Sur Original avant la mise à jour PR #97 (source Site `be34e8d`, version 3), `t20-oct2-a` et `t20-oct2-b` utilisent le même couple D1/R2. Une entreprise et un contact ont été créés dans chaque contexte, soit quatre fiches ; chaque contact référence l'entreprise locale. La recherche retrouve chaque fiche dans son contexte et aucune fiche étrangère ; la lecture croisée et les deux relations entre contextes répondent `not_found`. L'UI a montré les fiches et leur relation en A et B, puis B après rechargement ; logout 200/session 401 est confirmé. Reçu hors dépôt : `CREEZIO-T20-OCT2-ORIGINAL-FINAL.json` (SHA-256 `52C51EE870550312E91F48D2040034694E979231A96C40BD7B18ECC29E257844`).

Cette recette établit l'isolation logique CRM entre deux contextes actifs sur Sites. Elle n'exerce pas l'export CRM, ne crée pas de prospect et ne qualifie pas le routage T33 vers des D1/R2 physiques distincts. La recette v7/b9 à trois fiches décrite ensuite reste un témoin séparé.


## Recette ciblée Original Sites v7/Core b9 — 2 octobre 2026

Trois fiches dédiées `T20-B9-C17FB5FDD40F` (entreprise, contact et prospect) ont été créées et recherchées par API native. Le contact référence l'entreprise ; le prospect référence l'entreprise et le contact, stade `a_contacter`. Les trois vues ont été observées en navigateur. Un premier contrôle navigateur s'est arrêté après cette observation, sans diagnostic précis ; un second a confirmé le prospect et ses liens avant/après rechargement, puis la déconnexion 200/session 401. Les recherches des trois types sous le contexte non attribué `t20-foreign` ont refusé à 403 sans sortie. L'ancien contact révision 3 et le ticket Support révision 4 sont préservés. Cette preuve ne couvre pas un refus entre deux contextes vivants ni les refus de relation/export. Reçus hors dépôt : `CREEZIO-T20-SITES-B9-CRM-FINAL-2026-10-02.json`, `CREEZIO-T20-SITES-B9-PLAYWRIGHT-UI-2026-10-02.json` et `CREEZIO-T20-SITES-B9-PLAYWRIGHT-RELOAD-2026-10-02.json`.

Les sections du 1er octobre ci-dessous restent historiques.

## Relation Support/CRM sur Original Sites v5 — 1er octobre 2026

Le contact CRM préexistant `0347a984-4f37-4120-890e-b53a5bc1280d` a été lié explicitement au ticket Support `debf24c8-4c25-459a-ae4a-da082bde2de4` dans le workspace admin. Le rechargement admin conserve ce lien et les deux messages du fil. Une lecture native du port public Support `reference.contact.read` retrouve le même contact ; les lectures du ticket en admin et app confirment la même référence à la révision 4. Le front sans droit CRM refuse la recherche localement tout en conservant sa session et le ticket ; aucun code HTTP navigateur n'est revendiqué. Ce témoin qualifie le raccord CRM/Support sous droits actuels, sans qualifier les six widgets CRM ni une relation avec un message Messaging. Preuves hors dépôt : `outputs/CREEZIO-T19-SITES-UI-RECIPE-2026-10-01.json`, `outputs/CREEZIO-T09-ORIGINAL-SUPPORT-NATIVE-READ-2026-10-01.json`.

## Recette API native CRM sur Linux main `9ce856c` — 1er octobre 2026

Deux contacts témoins nouveaux ont été créés sous le même propriétaire/contexte. Une recherche `limit=1` avec curseur a parcouru deux pages contenant exactement leurs ID. Le contact A a été archivé par la commande native (révision 1→2) ; la recherche active n'a conservé que B, la recherche archivée retrouve A, et la lecture active de A répond `not_found`. B et les enregistrements métier antérieurs sont préservés ; aucune suppression physique n'a eu lieu. Le journal a confirmé les trois intentions. Cette recette API ne couvre ni les vues navigateur ni les widgets ; voir `CREEZIO-T20-T19-NATIVE-RECIPE-9CE856C-2026-10-01.json`.

Réalisation de [REQ-2001](EXIGENCES.md#REQ-2001) et [US-20](USER-STORIES.md#US-20), suivie dans le [backlog](TODO.md#T-20). Branche `core/t20-native-crm`, depuis le socle intégrant la messagerie PR #42.

## Données et interfaces

Le module `creezio.crm` gère entreprises, contacts et prospects par trois modèles D1 et vingt et une opérations communes. Les fiches sont partagées dans le même contexte entre collaborateurs et audiences autorisés. L’audience reste une frontière de credential et de permission ; elle ne duplique pas les données métier. Session native, OAuth et jeton machine conservent leurs contrôles propres. Le module ne crée aucun service ni stockage externe.

Le kanban de prospection, ses cinq colonnes et ses cartes reprennent le Creezio original, commit `6bd6507633b4c17bfc31206d82d1caa9a8af19af`. Les vues entreprises et contacts complètent le contrat T20. Workspace et front déclaré partagent le composant natif ; les thèmes consomment sa navigation depuis le manifeste, et un front headless utilise les API. Les sources et adaptations sont détaillées dans le PRD du module.

## Concurrence et conservation

Les révisions sont communes aux interfaces. Le formulaire conserve sa révision d’ouverture : un rafraîchissement de liste ne lui attribue pas silencieusement une nouvelle version. Le brouillon reste monté pendant l’inactivité du panneau, y compris une fiche issue d’une page ultérieure ; un changement d’identité ou de contexte purge les valeurs. Les recherches saisies ne s’appliquent qu’après soumission.

Les relations refusent cibles absentes ou archivées et sociétés incompatibles. Les gardes sur parents et enfants se valident dans le batch métier ; une course entre lien et archivage ne laisse pas une référence active vers une cible archivée. Déplacer un contact vers une autre société est refusé lorsqu’un prospect actif le référence. La recherche parcourt au plus 500 lignes par appel, en lots D1 de cinq, et borne le résultat en octets avec un curseur de continuation.

Les trois sous-vues Entreprises, Contacts et Prospection conservent chacune leur sélection, formulaire et révision tant que le panneau est monté. Passer de l’une à l’autre ne perd plus une modification non enregistrée. Changer de session, d’audience ou de contexte vide ces brouillons ; ils ne sont pas sauvegardés comme données métier par une simple navigation.

Avant une mutation, le panneau conserve sa clé de suivi. Un résultat incertain bloque une seconde émission ; le bouton de vérification appelle seulement le statut natif. Un refus de lecture ou une exécution non observée ne vaut pas échec de l’écriture. Si le navigateur refuse de conserver le suivi avant l’envoi, aucune mutation n’est émise.

## Qualification et limites

Les six suites du module couvrent contrats, métier, interface, API/MCP, paquet et documentation. Le test D1 réel couvre partage autorisé ADMIN/APP, refus avant attribution, relations, CAS, archives et courses, puis trente prospects avec champs longs et recherche paginée. Le test de transports utilise HTTP et un vrai client MCP avec jeton machine, partage les mêmes fiches, refuse les autres scopes et vérifie une révocation effective. Les tests UI du journal couvrent résultat incertain, relecture sans réémission, refus de lookup et refus de persistance navigateur.

La recette navigateur sur `b8b7dad` a vérifié trois fiches liées, déplacement kanban, recherche, sauvegardes répétées, archivage/restauration, rechargement, brouillon entre onglets workspace et partage APP. Le défaut de brouillon entre sous-vues a ensuite été corrigé : la recette sur `d69a2bb` vérifie sa conservation dans le workspace et le front standard `/crm`, puis la modification d'un prospect dans le front, sa persistance après rechargement et sa relecture par l'admin. Les mêmes données témoins sont conservées et les sessions déconnectées. Le profil workspace sans thème ne publie volontairement pas `/crm`.

La première CI du CRM compte 1 188 tests, dont un sous-test de budget de taille et son parent en échec : Worker brut de 6 691 939 octets contre le plafond antérieur de 6 600 000. Le build local après correction de sous-vue mesure 6 692 500 octets bruts et 1 116 939 gzip. Le plafond brut passe à 6 900 000, soit environ 3 % de marge ; gzip, graphe et temps restent inchangés. Le job Actions autorise vingt minutes pour inclure installation, compilation et preuves autour du plafond interne de dix minutes des tests. Un délai dépassé ou un TAP incomplet reste un échec.

La PR #43 est fusionnée sur main `c566fc1d56d3e8285ca9a542eb6a80ed3e7b3b03`, arbre `e73567fc53c1aaa30bb9f5666399a8180cd79a0a` identique au candidat `76327f8`. La CI candidate `36471847519` a réussi 1 188/1 188 tests sans omission ; source, runtime, workflow et revues indépendantes du code et des verrous sont vérifiés. La CI de main `36473024844` a également réussi 1 188/1 188 tests sans omission, avec source et preuve runtime courantes. Les profils hébergés restent à qualifier. Les outils MCP sont textuels ; aucun widget CRM visuel n’est encore qualifié. Les contrats intermodules avec Support, Work ou connecteurs restent à définir et tester avant raccord ; aucun accès privé à leurs tables n’est utilisé. La parité complète de T20 n’est pas déclarée acquise par cette tranche.

Le candidat de complément conversationnel ajoute six widgets de lecture liste/fiche, une paire pour chaque entité, sans changer les 21 opérations ou les modèles D1. Les outils `list` et `search` alimentent la liste ; `read` alimente la fiche. Les actions directes relisent à la demande et restent soumises au même `crm.use`, contexte et audience. Un hôte sans rendu conserve le résultat textuel. Une page CRM peut atteindre 180 Kio avec 25 fiches et leurs notes ; le transport widget doit borner le résultat complet sans le tronquer. Le chat interne remplace actuellement un résultat brut de plus de 8 192 octets par `tool_output_too_large` avant tout rendu : seules les petites réponses peuvent y afficher un widget. Le curseur pagine les résultats réellement reçus. Les six suites du module passent 29/29 contrôles ; le test de transports D1, HTTP et MCP passe avec les six renderers compilés, leurs lectures et le refus après révocation. Cinq tests du catalogue vérifient notamment la borne agrégée de 16 Mio et la limite individuelle inchangée de 1 Mio. Composition, typage et documentation passent également. La CI et la recette visuelle Linux restent à effectuer ; ce complément ne clôt pas la compatibilité ChatGPT externe ni les raccords intermodules.


Le catalogue MCP validé est capturé une fois au chargement du Worker : sa copie intégrale n'est plus refaite pour chaque requête. Seul cet index statique est partagé ; origine, moteur, authentification et vérification des permissions restent propres au transport de la requête. Le test de la factory utilise deux clients et moteurs distincts et vérifie l'isolation des credentials, une révocation et la stabilité du catalogue capturé.

La CI du candidat `619e95e` a exécuté 1 249 tests : 1 247 réussites et deux échecs correspondant au sous-test de budget et à son parent. Le Worker mesuré contient 83 fichiers, 11 931 616 octets bruts et 2 068 665 gzip ; les six renderers autoportants ajoutent leur code de pont MCP Apps. Les budgets locaux passent à 12 250 000 et 2 130 000 octets, chacun avec moins de 3 % de marge sur cette mesure. Graphe et délais restent inchangés. Démarrage observé : 752 ms ; redémarrage : 715 ms. Cette CI reste en échec ; seul un nouveau contrôle complet pourra qualifier le candidat corrigé.

## Port de consultation — 30 septembre

Le contrat public `contact-lookup` v1 exporte uniquement les requêtes `contact.search` et `contact.read` avec leurs schémas. Les modèles CRM restent privés ; Support n'obtient pas un accès implicite aux données, seulement une requête soumise aux droits CRM du principal courant. Les six widgets CRM continuent de n'exposer que des lectures déclenchées volontairement et écartent désormais un résultat historique marqué en erreur. Ce complément source ne qualifie pas, à lui seul, les interactions ChatGPT/MCP externes ni la comparaison visuelle finale du kanban.
