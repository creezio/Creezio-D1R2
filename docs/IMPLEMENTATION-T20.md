# T20 — CRM natif

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

La recette navigateur sur `b8b7dad` a vérifié trois fiches liées, déplacement kanban, recherche, sauvegardes répétées, archivage/restauration, rechargement, brouillon entre onglets workspace et partage APP. Elle a révélé la perte d’un brouillon entre sous-vues CRM, corrigée ensuite et à revérifier sur le candidat final. Le profil workspace sans thème ne publie volontairement pas `/crm` ; le front est à vérifier avec la composition standard.

La première CI du CRM compte 1 188 tests, dont un sous-test de budget de taille et son parent en échec : Worker brut de 6 691 939 octets contre le plafond antérieur de 6 600 000. Le build local après correction de sous-vue mesure 6 692 500 octets bruts et 1 116 939 gzip. Le plafond brut passe à 6 900 000, soit environ 3 % de marge ; gzip, graphe et temps restent inchangés. Le job Actions autorise vingt minutes pour inclure installation, compilation et preuves autour du plafond interne de dix minutes des tests. Un délai dépassé ou un TAP incomplet reste un échec.

La CI complète et les profils hébergés restent à qualifier sur le candidat final. Les outils MCP sont textuels ; aucun widget CRM visuel n’est encore qualifié. Les contrats intermodules avec Support, Work ou connecteurs restent à définir et tester avant raccord ; aucun accès privé à leurs tables n’est utilisé. La parité complète de T20 n’est pas déclarée acquise par cette tranche.
