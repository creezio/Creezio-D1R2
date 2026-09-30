# T29 — connecteurs externes complémentaires

Source en préparation, aucune nouvelle intégration de cette famille annoncée livrée. Le mandat du 30 septembre autorise les parties indépendantes des modules différés. REQ-2901/2902 et la [matrice](MATRICE-CAPACITES.md) restent le périmètre complet.

| Sous-lot | Contrat de départ | Prochaine réalisation | Limite conservée |
|---|---|---|---|
| T29-GRANOLA | [PRD nominal](connectors/T29-GRANOLA.md) | Adapter les écrans notes/transcriptions/connexion et opérations au SDK commun | Un compte fournisseur réel doit qualifier la recette |
| T29-MAIL | [PRD nominal](connectors/T29-MAIL.md) | Resend HTTP et réception signée, reliés à Messagerie | Envoi réel uniquement vers un destinataire de test autorisé |
| T29-HERMES | [PRD et protocole externe](connectors/T29-HERMES.md) | Adapter le module aux capacités annoncées par le fournisseur | Raccord Work conservé pour T17, pas de service Hermes embarqué |
| T29-BROWSER | Sessions/profils/actions/visualisation du service externe | Adapter le contrat de l'original avec fournisseur réel | Relais utilisateur distinct et consenti ; aucun navigateur dans le Worker |
| T29-OBS | Événements corrélés filtrés | Consommer le journal/port Analytics et exporter par connecteur déclaré | Aucun secret/payload complet exporté par défaut |
| T29-AI-VOICE | Fournisseurs et capacités retenus au PRD | Réemployer les ports fournisseur/chat existants | Aucun modèle ou flux vocal annoncé fonctionnel sans recette réelle |
| T29-DESKTOP | Capacités authentifiées d'un client externe optionnel | Définir le protocole nominal avant adaptation | Aucune dépendance du démarrage web au desktop |
| T29-DEV | Exécution/projets/modèles/journaux/artefacts externes | Plan expliqué avant code du raccord aux tâches de développement | Validation future T23/T24 toujours requise |

Les ports sortants, le coffre, le journal des commandes, les signatures et la déduplication sont communs avec T26/T27/T28. Un module ne peut fournir une URL ou des en-têtes libres à son handler. Les services tiers sont fournis et administrés par l'utilisateur ; Creezio ne les installe pas. Chaque module a son PRD/TODO, ses six suites et ses preuves de version avant composition/release.

Inventaire réutilisable : interfaces Granola, projections et vérification de signatures ; types/outbox et transport Resend de la messagerie. Les mécanismes locaux incompatibles (boucles, accès aux bases locales, SMTP/IMAP dans le runtime) sont remplacés par ports et appels externes bornés. Réutiliser les comportements et écrans ne constitue pas une preuve de compatibilité serverless.
