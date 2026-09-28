# T36 — Première release de l’original

État : **préparation du jalon initial**, T36 global en cours. Base de travail : main `f8dc03c` après PR #28 ; la release doit porter le SHA main final qualifié après la PR documentaire et les qualifications restantes. Aucun tag ni artefact applicatif public n’est attesté ici.

## Versions et usage

- Tag applicatif prévu : `app/v0.0.0`, aligné sur [`package.json`](../package.json) et la [composition Sites](../configuration/composition.sites.json). Conserver `sdk.coreVersion`, les cinq modules natifs et le thème sélectionné à `0.0.0` ; ne pas augmenter les versions du SDK ou du starter pour cette release.
- Le SDK [`sdk-v1.1.0`](https://github.com/creezio/Creezio-D1R2/releases/tag/sdk-v1.1.0) est public depuis le main `f8dc03c` (arbre `1bb34da8b587f2b8a89b301efda4db8522565f87`, CI 1 152/1 152). Son [archive](https://github.com/creezio/Creezio-D1R2/releases/download/sdk-v1.1.0/creezio-sdk-1.1.0.tgz) fait 66 315 octets, SHA-256 `f874f0ed29a41ec45b8f686884b5e2260b9600d9045588174fff8a7fcdd5eeec`. Le starter `module-v0.1.0` reste public ; sa démo Cloudflare est à qualifier.
- Pour une installation neuve, suivre l’[installation locale](INSTALLATION-LOCALE.md) ou le [parcours opératoire Sites](INSTALLATION-SITES.md). Consulter séparément la [qualification Sites](QUALIFICATION-SITES.md) pour ses preuves et limites. La première version applicative publiée et qualifiée pourra servir de base au [vrai fork T37](TODO.md#T-37).

## Preuves et droits à renseigner avant publication

Après PR, revue et fusion selon le [Git flow](GIT-FLOW.md) : consigner le SHA et l’arbre du main final, le tag annoté immuable `app/v0.0.0`, l’archive exacte et son empreinte, les versions/provenances de la composition, du lockfile et des modules. Vérifier l’installation à neuf, la publication sur le Site A autorisé et les parcours ciblés ; relier les résultats CI et l’artefact public. La première version devient consommable par T37 seulement après ces preuves.

Examiner les conditions de distribution et les droits de reprise/contribution exigés par [REQ-3601](EXIGENCES.md#REQ-3601) : inventorier les sources et composants distribués, les notices et les périmètres effectivement couverts par [LICENSE](../LICENSE), puis consigner la décision pour chaque composant publié. Ce contrôle ne fixe pas de licence commerciale finale.

Le périmètre de cette première archive est le source suivi par Git : cœur et documentation, SDK, modules natifs/témoins, thèmes et fixtures. Les douze fichiers `LICENSE` déjà présents sont conservés ; aucune nouvelle licence ni aucun composant Enterprise n'est ajouté. Les droits du contenu déjà public restent ceux de ses notices existantes. Les dépendances sont référencées par le lockfile mais leurs installations ne sont pas redistribuées dans cette archive. Le build Vite commun produit `dist/client/licenses.md` via `build.license` ; vérifier son contenu et sa disponibilité sur chaque hébergement avant publication. L'archive source exclut dépendances installées, builds, données, secrets et fichiers ignorés. Les conditions commerciales futures et un éventuel accord de contribution restent différés.

Inventaire des notices : racine, SDK, thèmes, module `widgets-witness` et fixtures portent MIT ; les modules natifs Access, Conversations, Modules et extensions, et OpenAI indiquent des conditions non arrêtées (`NOASSERTION`) ; Delivery porte « All rights reserved ». Cette préversion de qualification conserve ces distinctions et ne présente pas l'ensemble comme couvert par MIT. Le mandat autorise sa publication et le fork de test ; il ne tranche pas les conditions commerciales futures.

## Limites du jalon

La [qualification Cloudflare T32](IMPLEMENTATION-T32.md) couvre une première publication et une mise à jour réelles ; elle ne remplace pas la qualification Site A de cette release. La démo du starter et les intégrations non vérifiées restent ouvertes. Les modules T17–T29 et T33–T35, puis la recette complète [REQ-3602](EXIGENCES.md#REQ-3602), restent à traiter : ce jalon ciblé ne clôt pas T36.
