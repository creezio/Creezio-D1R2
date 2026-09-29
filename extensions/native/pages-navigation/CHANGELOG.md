# Changelog

## T21 — images privées du snapshot publié

Le front authentifié et l'aperçu admin affichent les images R2 déjà liées à une page, dans les préfabriqués existants. Deux modèles D1 additifs figent jusqu'à cinq références citées au moment de `page.publish` ; les ajouts et détachements ultérieurs du brouillon n'altèrent pas la publication. `page.reset` rétablit les liens cités sans copie R2. La lecture privée liée, les gardes de révision, le refus des accès hors publication et le nettoyage des URL Blob sont couverts par les suites ciblées. Aucune route média publique ni lecture anonyme n'est ajoutée.

## 0.0.0 — candidat T21

Ajoute le module natif d'édition de pages, navigation et métadonnées SEO, avec snapshots publiés D1, médias privés R2, vues workspace/front authentifiées et projection API/MCP. Adapte les préfabriqués visuels du landing original. Les routes anonymes, médias publics et overrides du catalogue sidebar restent à raccorder au cœur.

Le front connecté compose la navigation publiée dans le slot d'en-tête existant, résout les pages par slug publié et applique temporairement les métadonnées du snapshot actif au document. Le SEO serveur et l'accès anonyme restent distincts et non livrés.

Les mutations de pages, navigation et liens de médias utilisent le journal public du SDK. Les résultats incertains conservent leur clé et se vérifient sans réémission. Le statut confirmé rafraîchit les données avant de permettre une nouvelle modification.
