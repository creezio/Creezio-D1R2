# PRD — thème front ChatGPT-like

## Problème et résultat

Une application Creezio peut choisir une présentation à navigation latérale proche de Certivan V5 sans modifier son backend, ses droits ou les vues des modules. Le thème affiche les contributions front autorisées dans une structure rail/mobile et une zone principale.

## Critères T13

- Le rail, le panneau mobile et la barre supérieure reprennent les comportements de présentation V5, dont fermeture par Échap et retour du focus.
- Les entrées affichées sont les `navigation` fournies par l'hôte, jamais les sections van/dossier/formation de Certivan.
- Les emplacements `front.header`, `front.sidebar`, `front.context` et `front.footer` rendent uniquement les contributions transmises.
- Les boutons de compte et de rafraîchissement appellent les callbacks du SDK front et ne créent aucune identité.
- Le thème peut être remplacé sans changer route, objet métier, personnalisation ou workspace d'administration.

## Hors périmètre

Conversation, historique, recherche de messages, compositeur, dictée, moteur LLM, widgets et données Certivan. Ils attendent les modules T14/T15.
