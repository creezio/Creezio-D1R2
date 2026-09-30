# Décisions T19

- Source originale vérifiée à `6bd6507633b4c17bfc31206d82d1caa9a8af19af` : console agrégée marque dans `packages/admin/ui/tickets-admin-client.tsx`, page client dans `packages/support/ui/support-client.tsx`, mount et SQL d'origine dans `packages/support/src/index.ts`.
- Le périmètre présent réunit tickets et messages dans un seul contexte Creezio. L'audience app voit les tickets de son principal, y compris un principal machine ; l'audience admin autorisée gère la file du contexte.
- La synchronisation flotte, les IDs de provenance, le relais vers un autre serveur et l'envoi d'e-mail attendent des contrats de transport publics. Les références explicites CRM et Messagerie emploient leurs ports publics de lecture ; Work reste différé. Aucune parité avec la flotte originale n'est revendiquée.
