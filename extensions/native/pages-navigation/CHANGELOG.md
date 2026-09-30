# Changelog

## T21 — personnalisation de la Sidebar du workspace

Ajoute l'onglet Sidebar issu du menu original, les trois opérations `sidebar.catalog`, `sidebar.resolved` et `sidebar.save`, et un singleton D1 contextuel à révision CAS. Les overrides stockent seulement visibilité, libellé et ordre ; le catalogue compilé fournit routes et droits en lecture seule. Le workspace applique le résultat après sa projection d'accès fraîche. Les entrées retirées de la composition restent dormantes, sans exposer leur route ni réapparaître à l'écran.

## T21 — publication anonyme explicite

`page.publish` accepte `visibility: public` ; le mode absent ou `protected` reste privé. Un marqueur D1 additif garde la révision exposée et est retiré par une republication protégée. L'éditeur relit la visibilité, affiche le lien public, et peut révoquer sans modifier le brouillon. La projection hôte sélectionnée rend les préfabriqués existants en HTML indexable et ne distribue que les images exactes du snapshot, après vérification de la référence, du contexte, de la taille et du SHA-256. La recette locale D1/R2 couvre les refus, la révocation pendant une lecture R2 et la navigation avec plus de cent pages publiques ; aucun hébergement réel n'est revendiqué.

## T21 — lecture complète des médias du brouillon

`media.list` conserve une page maximale de 50 médias ; son budget couvre aussi la lecture de la page parente, ce qui évite un refus `invalid_input` à cette limite.

## T21 — images privées du snapshot publié

Le front authentifié et l'aperçu admin affichent les images R2 déjà liées à une page, dans les préfabriqués existants. Deux modèles D1 additifs figent jusqu'à cinq références citées au moment de `page.publish` ; les ajouts et détachements ultérieurs du brouillon n'altèrent pas la publication. `page.reset` rétablit les liens cités sans copie R2. La lecture privée liée, les gardes de révision, le refus des accès hors publication et le nettoyage des URL Blob sont couverts par les suites ciblées. Aucune route média publique ni lecture anonyme n'est ajoutée.

## 0.0.0 — candidat T21

Ajoute le module natif d'édition de pages, navigation et métadonnées SEO, avec snapshots publiés D1, médias privés R2, vues workspace/front authentifiées et projection API/MCP. Adapte les préfabriqués visuels du landing original. Les routes anonymes et médias publics ont été raccordés dans les tranches suivantes.

Le front connecté compose la navigation publiée dans le slot d'en-tête existant, résout les pages par slug publié et applique temporairement les métadonnées du snapshot actif au document. Le SEO serveur et l'accès anonyme restent distincts et non livrés.

Les mutations de pages, navigation et liens de médias utilisent le journal public du SDK. Les résultats incertains conservent leur clé et se vérifient sans réémission. Le statut confirmé rafraîchit les données avant de permettre une nouvelle modification.
