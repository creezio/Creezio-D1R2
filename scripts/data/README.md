# Création centrale du schéma D1

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

## Preuves locales

[sql-schema.test.mjs](../../tests/identity/sql-schema.test.mjs) vérifie la génération et ses refus, puis applique des schémas synthétiques dans de vrais D1 Miniflare isolés : clés, CHECK, défauts, JSON, Unicode, FKs, rollback et inspection sans réparation. Les états éphémères sont fermés par `dispose`. Ces tests ne qualifient ni une production Cloudflare/Sites, ni un algorithme d'évolution de schéma, ni les parcours applicatifs d'accès.
