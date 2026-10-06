# Thème front ChatGPT-like Creezio

Ce module adapte la présentation Certivan V5 : volet de navigation développé, rail compact, panneau mobile, barre supérieure, zone principale et panneau contextuel. Les liens viennent exclusivement de la projection front Creezio. Aucun intitulé, conversation, widget, assistant ou appel produit Certivan n'est intégré.

Le choix de composition est `front: {kind: "theme", moduleId: "creezio.theme-chatgpt", theme: "chatgpt-like"}` après sélection et verrouillage du module. Les emplacements pris en charge sont `front.header`, `front.sidebar`, `front.context` et `front.footer`. Le composant reçoit le même `FrontThemeProps` que le thème standard.

Source de présentation : `app/v5/navigation.tsx`, `navigation.module.css`, `v5-app.tsx` et `workspace.module.css` dans Certivan V5. Le tableau de navigation métier, la marque Certi et les fonctions de chat de cette application ne sont pas repris. Les modules de conversations/widgets existants peuvent alimenter le contenu et les emplacements autorisés ; leur rendu dans cette composition reste à qualifier sur l'hôte.

Vérification locale : `node themes/chatgpt-like/gate.mjs`. Le navigateur, les sessions et les appels réels sont qualifiés par l'hôte T13.
