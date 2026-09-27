# Création centrale du schéma D1

## Composition et application explicite

`compileCompositionSchema({composition, modules, lock})` dans [composition-schema.mjs](composition-schema.mjs) valide les déclarations et leur verrou puis compile un plan immuable. Il contient le SQL, les objets attendus, le catalogue runtime et les empreintes du plan, des modèles, du SQL, de la composition et du verrou. `loadCompositionSchema(options)` utilise le chargeur de composition local, sans exécuter de code de module. Le build génère `data-catalog.ts` pour le runtime ; aucun outil Node/AJV n'entre dans cette projection.

[apply-schema.mjs](apply-schema.mjs) expose `inspectCompositionSchema(db, plan)` puis `applyCompositionSchema(db, plan, {expectedPlanDigest})`. L'inspection distingue `ready`, `additive`, `blocked` et `unavailable`. L'application exige le plan issu du compilateur et son empreinte attendue, relit le schéma et garde les créations ainsi que le reçu dans un même batch D1. Le résultat distingue effet absent, confirmé et inconnu ; une réponse perdue est observée par son reçu sans répéter automatiquement l'écriture.

Cette première tranche accepte les nouvelles tables et les nouveaux index compatibles. Elle conserve les définitions des modules désactivés ou retirés, refuse un objet étranger, un schéma partiel ou une modification incompatible. Elle n'applique pas encore les modifications de colonnes. Le reçu central conserve l'historique et les définitions ; le SQL enregistré dans la base n'est jamais exécuté. L'inspection vérifie les séquences et liens de toute la chaîne, puis l'empreinte du dernier état complet ; elle ne recalcule pas celle de chaque ancien contenu. L'applicateur ajoute les reçus sans modifier les précédents, mais l'inspection ne protège pas contre un administrateur modifiant directement la base.

Le garde central exclut uniquement les définitions exactes des tables fournisseur `_cf_METADATA` (D1 local) et `_cf_KV` (D1 Cloudflare). Une autre définition de ces tables ou tout autre objet `_cf_` reste étranger et bloque la publication du schéma.

Les limites qualifiées sont explicites : 1 024 objets, 1 Mio de définitions et 256 reçus. Leur dépassement bloque avec un diagnostic ; aucune troncature. Il n'existe pas encore de commande interactive de mise à jour générale ni d'application de schéma au démarrage du Worker. Le parcours du premier compte reste distinct et ne réinitialise jamais une installation consommée après ajout de modèles.

Le générateur [d1-schema.mjs](d1-schema.mjs) compile les modèles actuels du [contrat v1](../../sdk/contracts/schemas/v1/models.schema.json). Il ne charge aucun code de module, ne se connecte à aucun compte fournisseur et n'applique aucune écriture. Le SQL généré doit être enregistré et inspecté par la chaîne centrale avant son application à une base neuve. Les modules fournissent leurs modèles, jamais des scripts SQL.

## API

`generateD1Schema(moduleId, models)` est synchrone et retourne `{ sql, statements, tables }`. `sql` est le document de création inspectable, `statements` contient les statements préparables séparément et `tables[modelId]` le nom brut de chaque table dans un objet sans prototype. `sqlTableName(moduleId, modelId)` calcule ce même nom : `cz_<hex UTF-8 module>_<hex UTF-8 modèle>`. Toujours citer les identifiants SQL dans les requêtes ; l'encodage ne remplace pas les paramètres liés pour les valeurs.

La validation inertielle bornée précède AJV et les contrôles sémantiques propres au SQL. Une erreur lève `D1SchemaError` avec `code`, `path` et un message sans recopier la valeur fautive. Ordre stable des modèles/champs/index/relations, sans modifier l'entrée. L'ordre des champs dans une clé reste significatif. Les titres, permissions et politiques de suppression ne produisent pas de comportement SQL implicite.

`await inspectD1Schema(db, moduleId, models)` retourne `{ ok, errors }`. Cette lecture compare les définitions exactes de `sqlite_schema` aux tables et index générés, en tolérant seulement le point-virgule terminal absent de SQLite. Elle refuse les objets manquants, différents ou supplémentaires du namespace et les index/triggers supplémentaires attachés à ses tables. Les autres modules et les autoindex PK SQLite sont exclus. Une indisponibilité de lecture est un refus explicite. Aucun SQL existant, objet ou donnée n'est corrigé ou supprimé.

L'inspection est conservatrice : une réécriture SQL équivalente mais différente peut être refusée. Elle n'est ni une vérification des données présentes, ni un verrou contre un DDL concurrent, ni un reçu durable de publication. L'application du SQL, son stockage versionné, l'exclusion des publications concurrentes et les reçus relèvent de la chaîne centrale. Ne pas remplacer ce contrôle par `IF NOT EXISTS`, ni lancer la génération Node/AJV dans le Worker à chaque requête.

## Sous-ensemble qualifié

- Colonnes stockées, clés primaires non nullables, index simples/uniques et FKs directes du même module vers une clé PK/UNIQUE exacte. Arity, types, contexte positionnel et `SET NULL` sont contrôlés. `WITHOUT ROWID` impose également un identifiant explicite aux PK entières ; aucune allocation implicite d'identité.
- Texte avec bornes de longueur en points de code Unicode ; booléens stockés en 0/1 ; entiers sûrs JavaScript ; nombres finis ; JSON texte bien formé ; dates UTC canoniques `YYYY-MM-DDTHH:mm:ss.sssZ`. Les CHECK accompagnent la nullabilité. Une chaîne contenant NUL n'est pas un texte scalaire accepté.
- Défauts constants validés avant génération, bornes numériques/textuelles et enums scalaires homogènes. Le JSON est sérialisé comme JSON, sans interpoler une expression SQL. Pour un enum nullable, `null` doit aussi être déclaré dans l'enum. Un `default: null` signifie NULL SQL, y compris pour JSON.
- Rejet explicite de `computed:true`, `pattern`, références `schema`, enums JSON structurels et relations `via` ou intermodules. Leur présence dans le contrat général ne signifie pas que ce premier compilateur les prend en charge. Le contrôle d'entrée et les schémas métier restent requis dans les opérations.

L'affinité SQLite peut convertir des valeurs avant le CHECK : les contraintes qualifient leur représentation stockée, pas le type d'un paramètre JavaScript entrant. Les opérations doivent valider leurs entrées sans s'appuyer sur cette coercition. Les permissions, le caractère privé/protégé, l'approbation et le soft-delete sont appliqués par les opérations ; ce fichier de création ne les remplace pas.

Le générateur refuse plus de 100 colonnes par table et un statement dépassant 100 000 octets, conformément aux [limites D1](https://developers.cloudflare.com/d1/platform/limits/). Le nombre de requêtes autorisé par invocation et l'atomicité du parcours de publication ne se déduisent pas de ces deux limites. Les particularités NULL, clés et contraintes suivent la [documentation SQLite CREATE TABLE](https://www.sqlite.org/lang_createtable.html).

## Installation opérateur Access

[install-access.mjs](install-access.mjs) est un outil Node réservé au responsable du stockage. Il charge les artefacts fixes et vérifiés, fournit une inspection expurgée, crée le schéma neuf sur confirmation explicite puis réutilise les services natifs de compte. Aucun SQL arbitraire, chemin de module exécutable ou objet de plan forgé n'est accepté. L'application du schéma et la consommation du bootstrap constituent deux étapes distinctes ; les réponses inconnues ne déclenchent pas de nouvelle écriture automatique.

La comparaison porte sur la base entière dans ce premier installateur, et non seulement sur le namespace Access. Refus des objets/données étrangers, absence de réparation, marqueur consommé conservé. La définition exacte de `_cf_METADATA` créée paresseusement par Miniflare est la seule exception interne qualifiée ; aucun préfixe `_cf_` ou `sqlite_` n'est ignoré globalement. Un adaptateur distant doit qualifier ses objets internes et budgets avant de réutiliser cette installation. Le journal central d'évolution complet reste distinct, en T-05.

Le [parcours local](../../docs/INSTALLATION-LOCALE.md) raccorde cette API au même stockage que le runtime. Ses commandes ne sont pas une API publique et ne sont pas importées dans le Worker produit.

## Qualification du générateur

[sql-schema.test.mjs](../../tests/identity/sql-schema.test.mjs) vérifie la génération et ses refus, puis applique des schémas synthétiques dans de vrais D1 Miniflare isolés : clés, CHECK, défauts, JSON, Unicode, FKs, rollback et inspection sans réparation. Les états éphémères sont fermés par `dispose`. Ces tests ne qualifient ni une production Cloudflare/Sites, ni un algorithme d'évolution de schéma, ni les parcours applicatifs d'accès.
