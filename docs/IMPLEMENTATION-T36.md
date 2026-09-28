# T36 — Première release de l’original

État : **jalon source initial public et consommable**, T36 global encore en cours. La PR #29 a produit le main `eb97109493b3a945eaa882c216591bc468764014` (arbre `f5fe2e413944bfadeb907c1d9515ab3d927b187b`) ; sa CI main a réussi 1 152/1 152 tests. Le tag `app/v0.0.0` et son archive source sont publics. La qualification ciblée du Site A est distincte de la recette exhaustive de T36.

## Versions et usage

- [Tag applicatif publié `app/v0.0.0`](https://github.com/creezio/Creezio-D1R2/releases/tag/app/v0.0.0), aligné sur [`package.json`](../package.json) et la [composition Sites](../configuration/composition.sites.json). L'archive `creezio-app-0.0.0-source.tar.gz` fait 1 532 513 octets, SHA-256 `097a7eb02e5c955a048d014cd120f95672fac5e501c1e960998f13da18a717fb`. `sdk.coreVersion`, les cinq modules natifs et le thème sélectionné restent à `0.0.0` ; le SDK de composition reste à `1.1.0`.
- Le SDK [`sdk-v1.1.0`](https://github.com/creezio/Creezio-D1R2/releases/tag/sdk-v1.1.0) est public depuis le main `f8dc03c` (arbre `1bb34da8b587f2b8a89b301efda4db8522565f87`, CI 1 152/1 152). Son [archive](https://github.com/creezio/Creezio-D1R2/releases/download/sdk-v1.1.0/creezio-sdk-1.1.0.tgz) fait 66 315 octets, SHA-256 `f874f0ed29a41ec45b8f686884b5e2260b9600d9045588174fff8a7fcdd5eeec`. Les versions du starter jusqu'à `module-v0.1.2` sont publiques ; sa démo indépendante Cloudflare est à qualifier.
- Pour une installation neuve, suivre l’[installation locale](INSTALLATION-LOCALE.md) ou le [parcours opératoire Sites](INSTALLATION-SITES.md). Consulter séparément la [qualification Sites](QUALIFICATION-SITES.md) pour ses preuves et limites. Cette version publique a servi de base au [vrai fork T37](TODO.md#T-37), dont le Site B version 5 est désormais publié.

## Preuves du jalon initial et droits

Le main, le tag annoté, l'archive exacte, ses notices et la CI sont liés à la release. Le Site A `appgprj_6ab93b30a80c8191b764f797c34c56c8` a livré ce main et conservé les données observées ; API, réponse OpenAI et deux widgets ont été qualifiés dans leur périmètre. Voir les preuves extérieures `CREEZIO-T36-APP-PUBLIC-RELEASE-2026-09-28.json` et `CREEZIO-T36-SITES-QUALIFICATION-2026-09-28.json`. L'installation neuve et les autres profils de T36 gardent leurs propres contrôles.

Examiner les conditions de distribution et les droits de reprise/contribution exigés par [REQ-3601](EXIGENCES.md#REQ-3601) : inventorier les sources et composants distribués, les notices et les périmètres effectivement couverts par [LICENSE](../LICENSE), puis consigner la décision pour chaque composant publié. Ce contrôle ne fixe pas de licence commerciale finale.

Le périmètre de cette première archive est le source suivi par Git : cœur et documentation, SDK, modules natifs/témoins, thèmes et fixtures. Les douze fichiers `LICENSE` déjà présents sont conservés ; aucune nouvelle licence ni aucun composant Enterprise n'est ajouté. Les droits du contenu déjà public restent ceux de ses notices existantes. Les dépendances sont référencées par le lockfile mais leurs installations ne sont pas redistribuées dans cette archive. Le build Vite commun produit `dist/client/licenses.md` via `build.license` ; vérifier son contenu et sa disponibilité sur chaque hébergement avant publication. L'archive source exclut dépendances installées, builds, données, secrets et fichiers ignorés. Les conditions commerciales futures et un éventuel accord de contribution restent différés.

Inventaire des notices : racine, SDK, thèmes, module `widgets-witness` et fixtures portent MIT ; les modules natifs Access, Conversations, Modules et extensions, et OpenAI indiquent des conditions non arrêtées (`NOASSERTION`) ; Delivery porte « All rights reserved ». Cette préversion de qualification conserve ces distinctions et ne présente pas l'ensemble comme couvert par MIT. Le mandat autorise sa publication et le fork de test ; il ne tranche pas les conditions commerciales futures.

## État courant de la release initiale

L’archive `app/v0.0.0` reste la preuve historique de la première release source ; `app/v0.0.1` est ensuite devenue publique depuis `a911e4d`. Le Site A historique appartient à l’ancien compte. Le Site A courant `appgprj_6aba07912a888191b9dfbee5b65f2448`, [Creezio original](https://creezio-original.fiduciaire615016.chatgpt.site), sert sa version 5 depuis `833701dd15e6fa81b2f329169a99b7aeb0270412`, avec registre synchronisé. Son témoin version 4 depuis `cb716aa` avait répondu en 14,161 secondes, sans reprise, avec 933 octets persistés ; le tour interrompu précédent reste une preuve distincte. Le Site B du fork sert aussi sa version 5 depuis `1a93fa85a3c1c44794b0e82dfc5eda4c409eba12`. Core `0078fc7` et Lab `949f028` ont porté le correctif de capture T32 ; les mains suivants `22a0d3f` et `6e06182` corrigent l'inspection Cloudflare. Aucun de ces mains plus récents n'est déclaré source des Sites A/B version 5.

## Limites du jalon

La [qualification Cloudflare T32](IMPLEMENTATION-T32.md) couvre une première publication et une mise à jour réelles ; elle ne remplace pas la qualification Site A de cette release. La démo du starter et les intégrations non vérifiées restent ouvertes. Les modules T17–T29 et T33–T35, puis la recette complète [REQ-3602](EXIGENCES.md#REQ-3602), restent à traiter : ce jalon ciblé ne clôt pas T36.
