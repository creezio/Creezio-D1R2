# Fichiers privés

`createFileClient` utilise la session native et la même origine. Il envoie un `Blob` borné vers la catégorie déclarée, conserve l'identifiant explicite de tentative et renvoie une référence opaque. Ni cette référence ni un identifiant de fichier ne constituent une autorisation. Le serveur dérive propriétaire/audience/contexte et contrôle les permissions.

Un résultat `unknown` interdit une relance automatique. L'utilisateur peut reprendre explicitement le même contenu avec la même intention ; l'intention est immuable. Après un rattachement métier incertain, employer la réconciliation de l'opération avant tout abandon. Le client ne stocke pas les octets ou les credentials. Après téléchargement, l'interface est responsable de révoquer son URL objet.

Dans le handler d'un module, `context.files.preparePublication(categoryId, reference)` fournit un plan opaque et les métadonnées relues du stockage. Déclarer la catégorie dans `effects.writes`, puis rendre le plan avec la référence métier et ses gardes dans `result.plans`. Omettre la preuve ou ne rendre qu'elle est refusé. Le commit D1 publie simultanément les métadonnées et le lien ; aucune transaction interressources R2/D1 n'est prétendue. Les lectures et abandons restent liés au propriétaire et aux droits courants.

## Instantané de liens — SDK 1.8 candidat

`context.files.freezeLinks` copie un ensemble explicite de liens existants vers une entité métier créée par la même opération. Les modèles source et destination, leurs champs et la catégorie privée doivent être déclarés par le module et couverts par les effets de l'opération. L'hôte vérifie le propriétaire, le contexte, la liste exacte, les tailles et les métadonnées des fichiers. Une opération ne peut réserver qu'un instantané, y compris en cas d'appels concurrents. Les écritures privées de liens, les plans métier, le résultat et l'outbox sont validés dans le même batch D1 sous les gardes fraîches. Cette réservation n'effectue aucun envoi fournisseur et ne copie pas les octets R2.

## Pièces distantes reçues — source candidate SDK 1.9

`stageRemote` reçoit un `remoteId` déclaré, les IDs parent/enfant, les métadonnées attendues et la preuve `{connectionId,configRevision}` capturée par une query publique autorisée. L'hôte vérifie l'événement signé et le fournisseur, télécharge une seule pièce depuis les chemins API/CDN fixés au descripteur, contrôle les octets et stage dans la catégorie R2 privée. Il renvoie une référence opaque et les métadonnées vérifiées. La commande métier conserve son reçu durable ; une reprise avec le même `intentId` et la même `generation` retrouve le même fichier.

`prepareBatchPublication` prépare un lot exact de 0 à 50 références pour un seul commit D1 avec création métier. Les reçus source, le propriétaire, les métadonnées, l'état staged et la connexion/coffre actifs sont vérifiés à nouveau dans ce commit. Aucun plan ni appel réseau n'est émis par pièce à l'import. Les fichiers restent privés si le batch échoue. Ces ports existent dans la source candidate ; leur archive SDK 1.9 n'est pas encore publiée.

## Lecture liée à une entité — SDK 1.3

`downloadLinked(reference, recordId, isCurrent?)` utilise le même GET binaire natif, avec `recordId` explicite. Une catégorie doit déclarer `linkedRead` : audiences, permission, modèle de lien, relation vers le parent, colonnes de référence et état requis du parent. Les modèles sont privés, contextuels et possédés par le module ; l'hôte valide ces références et les droits à la composition. Aucune permission ne découle de la possession d'une référence ou d'un identifiant.

Le serveur recontrôle le parent, le lien exact, l'état du fichier et les droits avant et après lecture. Le GET reste `application/octet-stream`, privé et sans cache. Pour les seules catégories opt-in `mcpImage`, la réponse liée porte aussi `x-creezio-file-content-type` issu des métadonnées vérifiées ; le client l'applique au Blob uniquement pour PNG, JPEG ou WebP et conserve `application/octet-stream` dans tous les autres cas. Les URL objet sont révoquées sur changement de session/sélection ou démontage, sans être persistées. `isCurrent` permet de rejeter une réponse appartenant à une ancienne vue. Upload, abandon et `download` ordinaire conservent leur restriction de propriétaire.

Cette API exige SDK 1.3 public ou ultérieur. Elle n'expose aucun fichier anonyme, ne crée pas de lien signé durable et ne fournit pas de redimensionnement. Les anciennes archives SDK restent inchangées.

## Image privée dans un widget — SDK 1.5

Une catégorie `linkedRead` peut déclarer `mcpImage: {toolName,widgetIds}` pour offrir un outil de lecture de raster aux widgets `app` indiqués. La catégorie reste privée, son maximum est de 2 Mio et ses MIME sont limités à PNG, JPEG et WebP. Chaque widget déclare la permission de lecture liée. Le compilateur expose l'outil à l'application seulement ; le serveur réutilise `readLinked` et place le base64 uniquement dans `_meta['creezio/linkedImage']`, avec un contenu textuel neutre. Le résultat MCP sérialisé complet est borné à 3 Mio. Les widgets natifs utilisent `downloadLinked` et vérifient le MIME du Blob et la signature des octets avant de former le même résultat privé. La prise en charge externe reste à qualifier dans ChatGPT avant de l’annoncer vérifiée.
