# PRD — thème front standard

## Problème et résultat

Une application Creezio doit pouvoir activer un front reconnaissable sans recopier le back-office ou modifier ses routes pour chaque module installé. Le thème standard présente les vues front déclarées et autorisées dans la palette Creezio, avec navigation et emplacements dynamiques.

## Critères T13

- Le même `FrontThemeProps` alimente ce thème et le thème ChatGPT-like.
- Navigation, contenu central et quatre emplacements proviennent exclusivement de la projection de l'hôte ; aucun écran métier ni droit n'est déduit localement.
- L'identité app native commande la connexion et les opérations protégées. L'état anonyme ne rend que les vues `public-read` permises.
- L'administration, ses onglets et son chat restent dans `admin/`, sans import par ce module.
- Branding et remplacements propres à l'application demeurent sous `application/` lors du changement de thème.

## Hors périmètre

Persistance des conversations, moteur LLM, widgets conversationnels, édition du thème et création de vues métier. Les modules concernés les livreront séparément.
