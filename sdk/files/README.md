# Fichiers privés

`createFileClient` utilise la session native et la même origine. Il envoie un `Blob` borné vers la catégorie déclarée, conserve l'identifiant explicite de tentative et renvoie une référence opaque. Ni cette référence ni un identifiant de fichier ne constituent une autorisation. Le serveur dérive propriétaire/audience/contexte et contrôle les permissions.

Un résultat `unknown` interdit une relance automatique. L'utilisateur peut reprendre explicitement le même contenu avec la même intention ; l'intention est immuable. Après un rattachement métier incertain, employer la réconciliation de l'opération avant tout abandon. Le client ne stocke pas les octets ou les credentials. Après téléchargement, l'interface est responsable de révoquer son URL objet.

Dans le handler d'un module, `context.files.preparePublication(categoryId, reference)` fournit un plan opaque et les métadonnées relues du stockage. Déclarer la catégorie dans `effects.writes`, puis rendre le plan avec la référence métier et ses gardes dans `result.plans`. Omettre la preuve ou ne rendre qu'elle est refusé. Le commit D1 publie simultanément les métadonnées et le lien ; aucune transaction interressources R2/D1 n'est prétendue. Les lectures et abandons restent liés au propriétaire et aux droits courants.

## Lecture liée à une entité — SDK 1.3

`downloadLinked(reference, recordId, isCurrent?)` utilise le même GET binaire natif, avec `recordId` explicite. Une catégorie doit déclarer `linkedRead` : audiences, permission, modèle de lien, relation vers le parent, colonnes de référence et état requis du parent. Les modèles sont privés, contextuels et possédés par le module ; l'hôte valide ces références et les droits à la composition. Aucune permission ne découle de la possession d'une référence ou d'un identifiant.

Le serveur recontrôle le parent, le lien exact, l'état du fichier et les droits avant et après lecture. Le GET reste `application/octet-stream`, privé et sans cache. Pour les seules catégories opt-in `mcpImage`, la réponse liée porte aussi `x-creezio-file-content-type` issu des métadonnées vérifiées ; le client l'applique au Blob uniquement pour PNG, JPEG ou WebP et conserve `application/octet-stream` dans tous les autres cas. Les URL objet sont révoquées sur changement de session/sélection ou démontage, sans être persistées. `isCurrent` permet de rejeter une réponse appartenant à une ancienne vue. Upload, abandon et `download` ordinaire conservent leur restriction de propriétaire.

Cette API exige SDK 1.3 public ou ultérieur. Elle n'expose aucun fichier anonyme, ne crée pas de lien signé durable et ne fournit pas de redimensionnement. Les anciennes archives SDK restent inchangées.

## Image privée dans un widget — SDK 1.5

Une catégorie `linkedRead` peut déclarer `mcpImage: {toolName,widgetIds}` pour offrir un outil de lecture de raster aux widgets `app` indiqués. La catégorie reste privée, son maximum est de 2 Mio et ses MIME sont limités à PNG, JPEG et WebP. Chaque widget déclare la permission de lecture liée. Le compilateur expose l'outil à l'application seulement ; le serveur réutilise `readLinked` et place le base64 uniquement dans `_meta['creezio/linkedImage']`, avec un contenu textuel neutre. Le résultat MCP sérialisé complet est borné à 3 Mio. Les widgets natifs utilisent `downloadLinked` et vérifient le MIME du Blob et la signature des octets avant de former le même résultat privé. La prise en charge externe reste à qualifier dans ChatGPT avant de l’annoncer vérifiée.
