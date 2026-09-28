# T-39 — checkpoints du flux conversationnel

Cette correction prépare la recette ciblée de la première application. Elle ne clôt pas [T-39](TODO.md#T-39), qui exige encore deux Sites, le fork, les widgets, la mise à jour et le retour utilisateur.

## Observation Site A

Sur le Site A original du compte courant, un tour administrateur réel a produit des deltas OpenAI espacés d'environ une seconde. Deux appels `turn.drive` ont fini `unknown` après une coupure du Worker observée à 26,7 secondes ; la reprise explicite du **même** tour a fini `succeeded`, avec un seul message assistant confirmé. Cela prouve la reprise de ce tour, sans mesurer séparément le coût de chaque accès D1. La revue du chemin `core/conversations/turn-bridge.ts` a montré une lecture du tour, une reconstruction du corps et un checkpoint D1 pour chaque fragment. Le rejet d'un outil dans ce premier tour provenait d'identifiants inventés dans ses arguments (`not_found`) et reste distinct du débit du flux. Les preuves natives expurgées sont conservées hors dépôt dans `CREEZIO-SITES-ORIGINAL-POSTCHAT-READONLY-2026-09-28.json` et `CREEZIO-SITES-ORIGINAL-POSTCHAT-FINAL-2026-09-28.json`.

## Correction bornée

Le pont garde le texte et le dernier curseur fournisseur localement. Un checkpoint est déclenché quand le texte accumulé atteint 512 caractères ou 4 secondes à l'arrivée d'une trame, puis avant un appel d'outil ou un terminal et à la fin du flux. Un seul événement fournisseur peut dépasser le seuil de 512 caractères ; la limite totale de 16 000 octets UTF-8 demeure. Un checkpoint confirmé fournit directement le reçu durable, sans seconde lecture de la livraison pour chaque delta.

Le tour est relu aux checkpoints, aux événements de contrôle et à la fin du flux. La transaction de `change()` conserve sa vérification fraîche de l'annulation et de la révision avant l'écriture. Si l'accusé d'un checkpoint se perd après son commit, le pont relit le reçu durable avant réconciliation ; il ne réécrit pas aveuglément le suffixe. Une reprise utilise le dernier curseur durable. L'appel d'outil attend toujours la trame terminale et garde son usage ; le message assistant n'est confirmé que dans la transaction terminale.

Le changement porte sur le pont Core et son test D1. Aucun contrat SDK public, manifeste de module, modèle de données, interface ou flux de publication n'est modifié.

## Vérification et limites

Le test ciblé `tests/openai/turn-bridge.test.mjs` a réussi localement : rafale de 40 fragments avec regroupement et lectures bornées, fin de flux avant flush, texte avant outil, accusé perdu après commit avec reprise exacte sans doublon, annulation entre flushs et usage terminal. `npm run typecheck` et `npm run check:docs` ont réussi ; la revue indépendante de la PR #34 n’a relevé aucun point bloquant, et le main Core `e51928f98e6f0453f26b563a504fa868e3c1a04d` a passé 1 163/1 163 tests CI après intégration des PR #34 et #35. Le Site A original a ensuite publié `cb716aa35933acd0831ca1bb2504a95bd98427e1` (version 4) : un tour réel a réussi avec un seul `turn.drive` en 14 161 ms, sans reprise manuelle, et la réponse de 933 octets a été relue depuis les données persistées. Les données D1/R2 préexistantes ont été conservées. Ce témoin unique ne garantit pas une latence générale ni la fluidité de tous les flux ; les autres étapes de T-39 restent ouvertes.
