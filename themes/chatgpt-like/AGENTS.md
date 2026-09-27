# Maintenance du thème ChatGPT-like

Conserver le comportement visuel du rail et du mobile V5 tout en remplaçant toutes les données Certivan par `FrontThemeProps`. Ne pas importer `lib/certi-*`, `/api/v1/product`, `admin/` ou un contexte privé Next. Aucun faux message ou compositeur ne doit apparaître avant les contributions Conversations/Widgets réelles.

Les personnalisations restent sous `application/frontend/`. Exécuter les six suites `node gate.mjs` après une modification ; la recette navigateur et les droits sont qualifiés par l'hôte.
