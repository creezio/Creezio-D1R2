# Changelog

- T18 corbeille : `message.delete` retire les messages entrants et leurs liens D1 par lots CAS depuis la corbeille ; un snapshot tombstone empêche leur réimport. L’écran expose « Supprimer définitivement », inspecte les issues incertaines et refuse les messages sortants pour conserver intentions et accusés. Les fichiers privés R2 restent conservés ; purge physique reportée à T05.

- T29 réception locale : `message.inbound.prepare` fige le courriel reçu et ses métadonnées après preuve webhook signée ; `message.inbound.attachment.stage` prépare chaque pièce vérifiée dans R2 privé ; `message.inbound.import` publie en un commit D1 le message et l’ensemble exact des liens. L’interface conserve la préparation, expose l’avancement et relit le statut après une issue incertaine. Le fournisseur réel reste à qualifier.

- T29 local : snapshot texte/HTML, Cci et jusqu’à 50 références R2 privées (10 Mio) figés avec message et outbox ; octets transmis uniquement par le port hôte Resend. Accusés signés rapprochés par projection CAS ; import entrant explicite sans pièce jointe, refus intégral avec pièce jointe. Aucun fournisseur réel qualifié.

- Complément T18 : une pièce jointe ne remplace plus la composition non enregistrée ; l'éditeur ne publie que du HTML nettoyé et des URL HTTP(S) analysées. Le port public `message-lookup` v1 expose `message.read` sans modèle privé. Les trois cartes refusent un résultat marqué en erreur.

- T18 widgets : trois rendus de lecture boîtes, messages et brouillons, aperçus bornés, détail explicite, sans nouveau transport ni SQL.

## Source t18-messaging-v2 — partage des données entre audiences

Les modèles métier utilisent le couple contexte/propriétaire. Admin et app voient les mêmes boîtes et brouillons sauvegardés lorsqu’ils disposent chacun du droit `messaging.use`. Les pièces jointes privées partagent l’identité fichier du principal, tout en conservant les contrôles de contexte et d’audience de chaque accès.

Les mutations UI sont désormais coordonnées par le journal public du SDK : clé persistée avant envoi, blocage après issue incertaine et lecture du statut sans rejeu. La restauration de la boîte et du brouillon vérifie la session, l’audience et le contexte après authentification.

Les réponses tardives de sélection et de marquage automatique ne rétablissent plus un message quitté entre-temps. Un changement réel de compte ou de contexte efface aussi recherche et formulaire de création de boîte ; la vérification transitoire de la même session conserve les saisies.

## 0.0.0 — première tranche T-18

Module natif serverless `creezio.messaging` : modèles D1 pour boîtes, messages et brouillons, catégorie de pièces jointes privées R2, opérations autorisées communes API/MCP, lecteur HTML assaini et interface workspace en trois panneaux adaptée du Creezio original. Recherche, marquage lu/non lu, classement, fil et composition avec éditeur riche natif sont raccordés. L’envoi et la réception sans transport sont déclarés indisponibles. Les recettes navigateur et fournisseur réel restent ouvertes et ne sont pas couvertes par cette version de travail.

La liste des pièces jointes réserve aussi les deux lectures de contrôle de la boîte et du brouillon : la page maximale de 50 pièces jointes reste accessible avec ses vérifications d’accès.
