# Appliquer un plan de modules au checkout

`modules:apply` prépare un checkout local à partir du `handoff` d'un plan accepté lu par `plans.read`. Il ne publie pas la composition, ne modifie pas D1 et ne confirme pas le plan dans le runtime.

## Entrées

1. Qualifier les archives candidates dans l'inventaire statique du runtime qui propose le plan : `configuration/module-inventory.json` contient leurs déclarations `externalPackages`, les trois fichiers locaux (runtime, validation et reçu) sont sous `.creezio/packages/`, et l'origine figure dans `allowedOrigins`. Le checkout utilisé pour `apply` doit porter ce même inventaire exact.
2. Exporter ensuite le champ `handoff` de `plans.read` dans un fichier JSON du checkout. Son statut doit être `accepted_pending_publication`.
3. Utiliser le chemin de la composition visée. Son lock compagnon est déduit du même nom (`composition.json` → `composition.lock.json`, y compris les profils nommés).

```sh
npm run modules:apply -- --plan .creezio/plan-accepte.json --composition configuration/composition.json
npm run modules:apply -- --plan .creezio/plan-accepte.json --composition configuration/composition.json --write
```

Le premier appel relit le checkout, l'inventaire et les archives, recalcule le solveur et les digests, puis affiche le changement envisagé. `installability: not_checked` signifie que la résolution npm hors ligne n'a pas encore été tentée. `--write` déclenche cette résolution et l'application locale. Un fichier de plan n'accorde aucun droit dans le runtime : la publication et la confirmation sont des opérations distinctes avec leurs propres gardes.

## Contrôles et effets de `--write`

- La base, l'inventaire, le résumé et les deux cibles doivent correspondre exactement au plan recalculé. Le préflight est répété juste avant la mutation.
- Chaque paquet ajouté ou mis à jour est relu depuis les trois archives locales et son reçu détaché. Les chemins, types d'entrées tar, identités, versions et digests sont vérifiés avant extraction. Aucun code du candidat n'est exécuté.
- Les dépendances et peers du paquet doivent déjà avoir une version compatible dans le lock npm du checkout. npm résout le paquet en mode hors ligne, sans scripts, dans un petit répertoire de transaction. Seules les entrées du paquet approuvé produites par npm sont reportées dans le lock final ; les autres entrées et versions sont préservées. Une nouvelle dépendance transitive ou une collision avec une dépendance non possédée par le module est refusée.
- Le paquet est posé dans `node_modules`, ses archives canoniques dans `.creezio/module-artifacts`, puis `package.json`, `package-lock.json`, l'inventaire et la composition/son lock sont remplacés sous journal. Les archives d'origine et anciennes archives de cache restent disponibles pour un retour arrière. Une autre composition locale qui sélectionne le paquet modifié bloque l'opération.
- Une nouvelle lecture de la composition et de l'inventaire vérifie la cible après écriture. Si cette vérification échoue, les destinations sont restaurées depuis le journal. La sortie `applied_locally` atteste seulement cet état du checkout.

Le verrou exclusif est `.creezio/module-apply/active.json`. Après une interruption, lire ce fichier et le `journal.json` du plan avant toute action. Conserver les sauvegardes du répertoire de transaction et comparer les fichiers du checkout à la base et à la cible ; le CLI refuse un nouvel essai tant que ce verrou ou ce répertoire subsiste. Ne pas supprimer ces fichiers pour forcer un nouvel essai sans avoir terminé la récupération. Une restauration impossible laisse explicitement `rollback_failed` dans le journal.

Après application, exécuter les contrôles de build et de recette appropriés, puis publier le nouveau checkout par la procédure de livraison. La confirmation du plan dans l'interface native exige ensuite une attestation du runtime effectivement publié ; `modules:apply` ne la produit pas.

Test ciblé : `node --test tests/modules/apply.test.mjs`.
