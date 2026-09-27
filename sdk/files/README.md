# Fichiers privés

`createFileClient` utilise la session native et la même origine. Il envoie un `Blob` borné vers la catégorie déclarée, conserve l'identifiant explicite de tentative et renvoie une référence opaque. Ni cette référence ni un identifiant de fichier ne constituent une autorisation. Le serveur dérive propriétaire/audience/contexte et contrôle les permissions.

Un résultat `unknown` interdit une relance automatique. L'utilisateur peut reprendre explicitement le même contenu avec la même intention ; l'intention est immuable. Après un rattachement métier incertain, employer la réconciliation de l'opération avant tout abandon. Le client ne stocke pas les octets ou les credentials. Après téléchargement, l'interface est responsable de révoquer son URL objet.

Dans le handler d'un module, `context.files.preparePublication(categoryId, reference)` fournit un plan opaque et les métadonnées relues du stockage. Déclarer la catégorie dans `effects.writes`, puis rendre le plan avec la référence métier et ses gardes dans `result.plans`. Omettre la preuve ou ne rendre qu'elle est refusé. Le commit D1 publie simultanément les métadonnées et le lien ; aucune transaction interressources R2/D1 n'est prétendue. Les lectures et abandons restent liés au propriétaire et aux droits courants.
