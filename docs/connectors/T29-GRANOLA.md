# PRD T29-GRANOLA — notes et transcriptions externes

REQ-2901/2902 ; US-29. Module optionnel `creezio.granola`, propriétaire de ses réglages, références scellées et projections D1. Cette spécification précède son code ; aucune recette fournisseur acquise.

Un administrateur configure la clé d'un espace Granola et les accès autorisés. Un utilisateur autorisé consulte les notes, dossiers, résumés et pages de transcription dans les écrans Creezio existants, le front dynamique ou ses widgets. Ajouter le module ne donne aucun accès implicite à une autre audience ni aux notes d'autres contextes.

Le module déclare les lectures HTTPS de l'API publique Granola (`/v1/notes`, détail, transcription paginée, dossiers) et leur projection bornée. Les IDs opaques restent ceux fournis par Granola. Aucun fallback vers une API privée. Une note absente ou non disponible doit être retirée des résultats accessibles sans annoncer une suppression chez le fournisseur. Clé manquante, 401/403/404/413/429, curseur expiré et contenu trop grand ont un état explicite.

Une synchronisation est une commande bornée, enregistrée par l'exécuteur commun ; elle garde la révision de configuration et un checkpoint. Pas de boucle serveur. Le webhook signé valide le corps brut, la date et l'identifiant d'événement avant déduplication atomique ; il identifie la note à relire par l'API autorisée. Le contenu entrant n'acquiert aucun droit. La réception durable et le fetch de contenu sont deux états distincts ; un échec peut être réconcilié explicitement sans second effet.

Modèles à déclarer : configuration/coffre, note projetée, dossier, segments de transcription paginés, checkpoint et référence aux réceptions dédupliquées communes. Champs de contexte protégés, références/source/révision, timestamps et statuts contrôlés. R2 n'est utilisé que pour un contenu déclaré dépassant les bornes D1 avec accès lié ; aucune obligation de fichier artificiel pour les notes courtes.

Widgets multiples : liste/recherche de notes, fiche résumé, extrait paginé de transcription et état de synchronisation. Lecture/navigation dans le widget par défaut ; contexte ou message seulement quand l'utilisateur le demande. Les handlers API/MCP/widgets partagent les mêmes opérations. L'administration de connexion reste distincte de la lecture métier.

TODO de réalisation :

- [ ] Adapter les panneaux Notes/Connexion existants, sans nouvelle interface concurrente.
- [ ] Déclarer modèles/opérations/permissions/API/MCP/widgets et générer le SQL central.
- [ ] Raccorder configuration et lectures paginées aux ports publics.
- [ ] Raccorder projection D1, reprise bornée, signature et déduplication communes.
- [ ] Qualifier six suites backend/ui/api-mcp/widgets/package/docs, révocation et absence de fuite entre contextes.
- [ ] Qualifier compte fournisseur, note/transcription/dossier, réception signée, doublon et relecture sur hébergement.

Sources fournisseur vérifiées le 30 septembre : [API officielle](https://docs.granola.ai/introduction), [index officiel de documentation](https://docs.granola.ai/llms.txt). La liste exacte des endpoints et événements de réception est vérifiée avant le raccord correspondant ; un accès à la documentation n'est pas un accès à un compte de test.
