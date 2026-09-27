# Front appartenant à l’application

`index.ts` expose le branding de `application/config/front.ts` et un éventuel `FrontCustomTheme`. Ces fichiers appartiennent à l’application et doivent être conservés lors d’une mise à jour de Creezio ou de ses thèmes.

Le choix de thème reste dans `configuration/composition.json`, avec le module de thème sélectionné, activé et verrouillé. `workspace` permet une application sans front spécifique. `theme` utilise le thème compilé, ou le remplacement explicite `FrontCustomTheme`, avec le même contrat public et les mêmes droits. `headless` laisse la présentation à un client indépendant ; les API communes restent la source des opérations.

Un thème reçoit les vues, la navigation et les emplacements autorisés de l’hôte. Il ne crée ni compte, ni session, ni permission. La personnalisation n’accorde aucun accès administratif et ne modifie aucune donnée métier. Une vue conforme déclarée par un module apparaît sans ajouter de route dans ce dossier.

Le SDK navigateur réutilise la connexion native de l’audience `app`. Pour un client externe côté serveur, `sdk/front/headless.ts` utilise les bindings déclarés et un jeton API ou OAuth fourni par son coffre. Ne jamais embarquer une clé d’application dans un bundle public. L’accès navigateur entre origines reste soumis à la politique de l’hôte ; un client serveur/BFF peut appeler les API sans rendre cette politique permissive.
