# T36 — Première release de l’original

État : **jalon source initial public et consommable**, T36 global encore en cours. La PR #29 a produit le main `eb97109493b3a945eaa882c216591bc468764014` (arbre `f5fe2e413944bfadeb907c1d9515ab3d927b187b`) ; sa CI main a réussi 1 152/1 152 tests. Le tag `app/v0.0.0` et son archive source sont publics. La qualification ciblée du Site A est distincte de la recette exhaustive de T36.

## Versions et usage

- [Tag applicatif publié `app/v0.0.0`](https://github.com/creezio/Creezio-D1R2/releases/tag/app/v0.0.0), aligné sur [`package.json`](../package.json) et la [composition Sites](../configuration/composition.sites.json). L'archive `creezio-app-0.0.0-source.tar.gz` fait 1 532 513 octets, SHA-256 `097a7eb02e5c955a048d014cd120f95672fac5e501c1e960998f13da18a717fb`. `sdk.coreVersion`, les cinq modules natifs et le thème sélectionné restent à `0.0.0` ; le SDK de composition reste à `1.1.0`.
- Le SDK [`sdk-v1.1.0`](https://github.com/creezio/Creezio-D1R2/releases/tag/sdk-v1.1.0) est public depuis le main `f8dc03c` (arbre `1bb34da8b587f2b8a89b301efda4db8522565f87`, CI 1 152/1 152). Son [archive](https://github.com/creezio/Creezio-D1R2/releases/download/sdk-v1.1.0/creezio-sdk-1.1.0.tgz) fait 66 315 octets, SHA-256 `f874f0ed29a41ec45b8f686884b5e2260b9600d9045588174fff8a7fcdd5eeec`. Le starter `module-v0.1.0` reste public ; sa démo Cloudflare est à qualifier.
- Pour une installation neuve, suivre l’[installation locale](INSTALLATION-LOCALE.md) ou le [parcours opératoire Sites](INSTALLATION-SITES.md). Consulter séparément la [qualification Sites](QUALIFICATION-SITES.md) pour ses preuves et limites. Cette version publique sert de base au [vrai fork T37](TODO.md#T-37) ; le Site B du fork n'est pas encore publié.

## Preuves du jalon initial et droits

Le main, le tag annoté, l'archive exacte, ses notices et la CI sont liés à la release. Le Site A `appgprj_6ab93b30a80c8191b764f797c34c56c8` a livré ce main et conservé les données observées ; API, réponse OpenAI et deux widgets ont été qualifiés dans leur périmètre. Voir les preuves extérieures `CREEZIO-T36-APP-PUBLIC-RELEASE-2026-09-28.json` et `CREEZIO-T36-SITES-QUALIFICATION-2026-09-28.json`. L'installation neuve et les autres profils de T36 gardent leurs propres contrôles.

Examiner les conditions de distribution et les droits de reprise/contribution exigés par [REQ-3601](EXIGENCES.md#REQ-3601) : inventorier les sources et composants distribués, les notices et les périmètres effectivement couverts par [LICENSE](../LICENSE), puis consigner la décision pour chaque composant publié. Ce contrôle ne fixe pas de licence commerciale finale.

Le périmètre de cette première archive est le source suivi par Git : cœur et documentation, SDK, modules natifs/témoins, thèmes et fixtures. Les douze fichiers `LICENSE` déjà présents sont conservés ; aucune nouvelle licence ni aucun composant Enterprise n'est ajouté. Les droits du contenu déjà public restent ceux de ses notices existantes. Les dépendances sont référencées par le lockfile mais leurs installations ne sont pas redistribuées dans cette archive. Le build Vite commun produit `dist/client/licenses.md` via `build.license` ; vérifier son contenu et sa disponibilité sur chaque hébergement avant publication. L'archive source exclut dépendances installées, builds, données, secrets et fichiers ignorés. Les conditions commerciales futures et un éventuel accord de contribution restent différés.

Inventaire des notices : racine, SDK, thèmes, module `widgets-witness` et fixtures portent MIT ; les modules natifs Access, Conversations, Modules et extensions, et OpenAI indiquent des conditions non arrêtées (`NOASSERTION`) ; Delivery porte « All rights reserved ». Cette préversion de qualification conserve ces distinctions et ne présente pas l'ensemble comme couvert par MIT. Le mandat autorise sa publication et le fork de test ; il ne tranche pas les conditions commerciales futures.

## État courant de la release initiale

L’archive `app/v0.0.0` ci-dessus reste la preuve historique de la première release source. L’original `app/v0.0.1` est ensuite devenu public depuis `a911e4d` ; le main Core actuel `f1c1943` a une CI à 1 162/1 162. Le Site A qualifié ici appartient à l’ancien compte, inaccessible depuis le compte courant. Le nouveau Site A `appgprj_6aba07912a888191b9dfbee5b65f2448` est publié depuis la source `43b8ab4fa2c1855fd6576a18f803ecde37e3e622` (déploiement `appgdep_6aba0ba9a92c8191b7ed6ce4fdf3a1da`, registre synchronisé). Son premier tour de chat a fini interrompu en `provider_unknown` ; ni la réponse ni le widget ne sont qualifiés sur ce nouveau Site. La capture `CREEZIO-SITES-ORIGINAL-CHAT-INTERRUPTED-2026-09-28.png` est conservée hors dépôt. Sa recette applicative sur le compte courant reste ouverte et doit être enregistrée séparément.

## Limites du jalon

La [qualification Cloudflare T32](IMPLEMENTATION-T32.md) couvre une première publication et une mise à jour réelles ; elle ne remplace pas la qualification Site A de cette release. La démo du starter et les intégrations non vérifiées restent ouvertes. Les modules T17–T29 et T33–T35, puis la recette complète [REQ-3602](EXIGENCES.md#REQ-3602), restent à traiter : ce jalon ciblé ne clôt pas T36.
