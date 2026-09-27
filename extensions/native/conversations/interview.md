# Décisions T14

- Une conversation appartient au principal effectif, à son audience et au contexte. L’acteur d’une impersonation reste tracé par T06 sans devenir propriétaire du fil.
- La recherche lit des pages bornées avec curseur. Elle peut retourner zéro résultat et encore proposer une page suivante.
- Le brouillon est enregistré par opération D1 ; l’état local du panneau protège les modifications non transmises.
- Les fichiers privés passent par le service hôte et une référence de staging, jamais par une clé R2 client.
- Sans fournisseur, le chat annonce `no_provider` et ne simule pas une réponse.
