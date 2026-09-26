# Validation des contrats Creezio

Ce SDK valide les **déclarations fournies**, sans installer de module, exécuter de handler ou de test tiers, appeler un fournisseur, modifier une base ni publier une application. Les schémas versionnés sont décrits dans [schemas/v1/README.md](schemas/v1/README.md). Le contrat produit est défini dans [STANDARD-MODULE](../../docs/STANDARD-MODULE.md) et [DEPENDANCES-MODULES](../../docs/DEPENDANCES-MODULES.md).

## API

Les fonctions synchrones de `validate.mjs` ne modifient pas leurs entrées et retournent `{ errors, metrics }`. Chaque erreur contient `{ code, path, message }` ; `path` est un chemin JSON Pointer. Les résultats sont plafonnés à 128 diagnostics. `metrics.scope` vaut `supplied-contracts-only`.

```js
import { validateModule, validateComposition, validateCompositionTransition } from './validate.mjs';

validateModule(moduleDescriptor);
validateComposition(composition, { modules: [moduleDescriptor], lock });
validateCompositionTransition(previousComposition, nextComposition, {
  before: { modules: previousDescriptors, lock: previousLock },
  after: { modules: nextDescriptors, lock: nextLock },
});
```

`validateModule` contrôle la forme fermée, les schémas embarqués, les références locales, modèles/relations/index, effets et permissions, projections API/MCP, vues, widgets, documents, six suites et inventaires de fichiers. Une référence externe exige une dépendance déclarée ; sa résolution complète appartient à `validateComposition`.

`validateComposition` exige un descripteur et un verrou pour chaque module sélectionné, même désactivé. Il vérifie origines, versions SemVer, SDK/cœur, capacités déclarées, ports publics versionnés, références intermodules, collisions de routes/outils/ressources et cohérence du verrou. La politique déclarée par les modules et le verrou doit correspondre à celle demandée par la composition. Cette concordance ne prouve pas que cette politique ou ces capacités ont été approuvées : l'appelant doit choisir son SDK/politique depuis une source de confiance et qualifier l'adaptateur.

Chaque dépendance obligatoire doit être disponible et active pour son consommateur actif. Chaque dépendance facultative a exactement un choix explicite `integrations: [{ moduleId, enabled }]` dans la sélection du consommateur. La seule présence du fournisseur ne l'active pas. Une intégration sélectionnée incompatible bloque ; une intégration absente, désactivée ou non sélectionnée retire seulement les contributions munies de `requiresModules`. Une référence active vers une contribution retirée est refusée. Les modèles et fichiers persistants ne possèdent pas cette garde. Les actions d'un widget peuvent être gardées individuellement sans supprimer le widget autonome ni changer leur mode.

Le graphe effectif comprend les dépendances obligatoires et les facultatives explicitement sélectionnées. Ses cycles sont refusés ; `metrics.dependencyOrder` donne un ordre topologique lorsqu'il est valide. `metrics.disabledContributions` identifie les chemins déclaratifs retirés, y compris `/contracts/widgets/<index>/actions/<index>`. Ces listes sont des résultats d'analyse, pas une activation effective dans un runtime. Les références et ports de données restent namespacés ; dépendre d'un module ne donne pas accès à son stockage privé ni à ses droits.

`validateCompositionTransition` valide les deux états puis signale ajouts, retraits, activation, désactivation, mises à jour, reconstructions, configuration, sources et intégrations modifiées. Une composition candidate qui laisse un dépendant obligatoire actif sans fournisseur compatible est refusée. Une substitution d'origine est refusée. Un paquet versionné ne peut changer ses empreintes/source sous la même version ; les reconstructions de sources workspace sont distinguées. `runtimeChanged` reste `false` : aucun changement n'est appliqué et aucune autorisation de publication n'est déduite.

## Lecture locale et bornes

`load.mjs` exporte `loadJson(path, { root, maxBytes, maxDepth, maxNodes })`, `inspectJson(value, limits)` et `ContractLoadError`. La racine par défaut est le répertoire courant ; les chemins relatifs se résolvent sous la racine fournie. Le chargeur refuse URL, chemin hors périmètre, lien/jonction, fichier non régulier et contenu autre que JSON UTF-8. Il ne récupère aucune référence réseau. Les erreurs n'affichent pas le contenu lu.

Les bornes par défaut sont 2 Mio, 48 niveaux et 20 000 nœuds ; les plafonds configurables sont 16 Mio, 96 niveaux et 100 000 nœuds. Les objets en mémoire sont inspectés avant validation : cycles, accesseurs, prototypes exotiques et clés réservées sont refusés. Les noms de fichiers d'artefact sont relatifs POSIX, sans traversée, encodage ambigu ni périphérique Windows. Une archive réellement reçue devra encore subir les contrôles de fichiers/liens/extraction du parcours de packaging.

Les schémas JSON embarqués sont bornés à 256 Kio, 32 niveaux et 4 000 nœuds par document. AJV les vérifie et compile strictement en JSON Schema 2020-12, sans charger de code de module ; formats via `ajv-formats`. Seules les références JSON Pointer locales sont admises. Un `$id` racine `urn:` n'entraîne aucun accès réseau. Les références récursives/dynamiques et les schémas non compatibles avec le compilateur strict sont refusés explicitement dans cette version. Les relations cycliques entre objets métier ne sont pas des références JSON Schema récursives et ne sont pas interdites par cette règle. Les patterns sont limités en taille ; cette compilation n'est pas une garantie générale de coût d'exécution d'un schéma arbitraire sur des données futures.

Les valeurs `default`, contraintes littérales et exemples restent des données, même lorsqu'elles ressemblent à une référence de module, un chemin ou un mot-clé de schéma. Cette validation de contrats ne remplace pas la validation des valeurs et secrets lors de la configuration/exécution.

## Empreintes et fermeture

`contractIntegrity(value)` calcule `sha256-<hex>` sur le JSON canonique du descripteur : clés d'objets triées selon l'ordre UTF-16 JavaScript, tableaux conservés dans leur ordre, primitives sérialisées par `JSON.stringify`, sans espaces. Le verrou emploie ce format pour `compositionIntegrity` et `contractIntegrity`. Cela identifie la déclaration normalisée, indépendamment de l'indentation de son fichier. Les autres empreintes source/archives portent sur leurs octets exacts et restent déclaratives tant que l'archive réelle n'a pas été contrôlée.

Les inventaires runtime/validation sont distincts ; références déclarées, entrées, assets et documents doivent y être présents. Le runtime ne peut dépendre de l'artefact de tests. Les scripts SQL de module, répertoires de tests/CI et démos sont exclus de l'inventaire runtime selon leurs chemins. Le reçu et le verrou détachés portent les empreintes d'archives : aucun paquet n'embarque son propre hash final. La validation de ces déclarations ne prouve pas l'existence, les octets ou les imports transitifs réels des fichiers, et ne détecte pas du SQL ou un comportement caché dans un handler.

## Limites de preuve

Les tests `tests/contracts/` qualifient ce contrôleur Node sur des fixtures déclaratives, notamment plusieurs widgets, trois modes d'actions et une chaîne de dépendances d'origines distinctes. Ils ne constituent ni six suites exécutées d'un vrai module, ni recette Worker/Sites/Cloudflare/ChatGPT. La fermeture d'archive réelle, les signatures/provenances, permissions serveur, contrôle au commit, installation/activation, conservation des données et tests fournisseurs restent des validations d'implémentation distinctes. Une justification déclarée de non-applicabilité n'est pas à elle seule une preuve approuvée de dispense.
