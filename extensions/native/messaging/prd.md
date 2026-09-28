# PRD — Messagerie native T-18

Référence : REQ-1801, US-18, T-18. Une personne autorisée peut créer une boîte locale, voir les messages de son contexte, filtrer et rechercher, lire un message HTML sans exposition du shell, composer avec destinataires, Cc/Cci et pièces jointes privées, puis conserver un brouillon. Les audiences admin et métier restent séparées par les droits et les lectures serveur.

Le webmail attendu garde les trois panneaux du Creezio original : navigation dossiers, liste et lecteur ; le composeur reste disponible en surimpression sans effacer la sélection. Les états de transport sont explicites. Sans fournisseur, aucune réponse de `message.send` ne prétend un envoi et aucune réception n’est simulée. Les messages existants restent consultables. Le classement, le marquage lu/non lu, la recherche, le fil et le retrait d’un lien de pièce jointe passent par les opérations communes.

La suite de REQ-1801 doit relier un vrai transport externe : envoi et réception, accusés, réconciliation, reprise sans double confirmation et recette réelle. Ce module ne contient ni daemon, ni scheduler, ni gestion du cycle de vie d’un fournisseur tiers. L’état « indisponible » actuel n’est pas une preuve de capacité distante livrée.

Acceptation locale : stockage D1/R2 et refus intercontexte, conservation du brouillon, protection des fichiers, HTML sûr, UI originale raccordée au SDK, API/MCP partagés et refus explicite sans transport. Acceptation hébergée : interactions dans le navigateur Original et transport réel après raccordement, avec preuve séparée.
