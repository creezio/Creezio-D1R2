# PRD du module Granola

Le module expose les notes de réunion et dossiers d'un compte Granola à un contexte Creezio explicitement autorisé. L'administrateur voit le panneau Connexion, la clé scellée, l'état de synchronisation et les commandes manuelles. L'utilisateur `granola.read` voit le panneau Notes d'origine, son filtre de dossier, sa fiche résumé et les pages de transcription ; aucun accès implicite à un autre contexte.

Les sorties de l'API fournisseur sont validées, bornées, puis projetées par génération de connexion. Le checkpoint et la révision de configuration conditionnent chaque page. Le serveur n'a ni scheduler ni processus permanent. Les widgets Notes, Résumé, Transcription et Synchronisation sont en lecture seule et reçoivent les sorties des mêmes opérations.

Le module déclare le webhook Standard Webhooks au port commun : le host valide corps brut, date, signature et jeton avant réception D1 durable et déduplication. La notification ne transporte pas de contenu de note et ne déclenche pas un fetch implicite ; l'administrateur relit la note avec `note.refresh`. La recette du host signé et la gestion d'endpoint distant sur un compte Granola approprié restent des qualifications de livraison séparées.
