# T29 — connecteurs externes complémentaires

Source candidate partielle sur la branche de travail, sans nouvelle intégration ni recette fournisseur annoncée livrée. Le mandat du 30 septembre autorise les parties indépendantes des modules différés. REQ-2901/2902 et la [matrice](MATRICE-CAPACITES.md) restent le périmètre complet. Granola et Hermes ont leurs six suites et leurs recettes D1/hôte locales avec fournisseurs simulés ; Mail/Resend a une intention D1 candidate et son transport est encore en raccord. Ces preuves ne valent pas qualification d'un compte externe.

| Sous-lot | État de la source candidate | Critère suivant et limite conservée |
|---|---|---|
| T29-GRANOLA | [PRD](connectors/T29-GRANOLA.md), écrans, lectures/projections, quatre widgets et webhook signé ; six suites et D1/hôte synthétiques qualifiés | Archive finale puis compte et événement signé réels sur hébergement ; recette fournisseur différée par l'utilisateur |
| T29-MAIL | [PRD](connectors/T29-MAIL.md), Resend configuré ; snapshot et intention d'outbox D1 candidats | Finir dispatch, accusés, réception et pièces jointes avec Messagerie ; envoi réel limité au destinataire de test autorisé et différé par l'utilisateur |
| T29-HERMES | [PRD et protocole](connectors/T29-HERMES.md), capacités, run/arrêt durables, UI et six suites D1/hôte simulées | Widgets, approbation liée à la version de l'instance, archive finale et recette réelle différée ; raccord Work conservé pour T17, aucun service embarqué |
| T29-BROWSER | Sessions/profils/actions/visualisation du service externe à adapter | Fournisseur réel et relais utilisateur distinct, consenti ; aucun navigateur dans le Worker |
| T29-OBS | Événements corrélés filtrés à définir | Consommer le port Analytics et exporter par connecteur déclaré ; aucun secret/payload complet par défaut |
| T29-AI-VOICE | Fournisseurs et capacités à retenir au PRD | Réemployer les ports fournisseur/chat ; aucun modèle ou flux vocal revendiqué sans recette réelle |
| T29-DESKTOP | Protocole d'un client externe optionnel à définir | Aucune dépendance du démarrage web au desktop |
| T29-DEV | Exécution/projets/modèles/journaux/artefacts externes à définir | Plan expliqué avant code du raccord aux tâches de développement ; validation future T23/T24 toujours requise |

Les ports sortants, le coffre, le journal des commandes, les signatures et la déduplication sont communs avec T26/T27/T28. Un module ne peut fournir une URL ou des en-têtes libres à son handler. Les services tiers sont fournis et administrés par l'utilisateur ; Creezio ne les installe pas. Chaque module a son PRD/TODO, ses six suites et ses preuves de version avant composition/release.

Inventaire réutilisable : interfaces Granola, projections et vérification de signatures ; types/outbox et transport Resend de la messagerie. Les mécanismes locaux incompatibles (boucles, accès aux bases locales, SMTP/IMAP dans le runtime) sont remplacés par ports et appels externes bornés. Réutiliser les comportements et écrans ne constitue pas une preuve de compatibilité serverless.
