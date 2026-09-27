# Maintenance du thème standard

Conserver le composant comme présentation pure du contrat `sdk/front/types.ts`. Ne pas importer `admin/`, un contexte privé du routeur ou un module métier. Toute entrée de navigation et tout emplacement doit venir des props projetées par l'hôte. Ne pas ajouter de conversation factice ; T14/T15 apportent la capacité réelle. Les fichiers de personnalisation restent dans `application/frontend/`.

Après une modification, exécuter les six suites déclarées via `node gate.mjs` et vérifier le manifeste. Les recettes hôte et navigateur appartiennent au contrôle global T13.
