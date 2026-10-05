# Admission locale d’un module externe

L’admission rend un paquet externe inconnu visible comme **candidate** dans le Product Hub. Elle ne l’installe pas, ne sélectionne pas le module, ne change pas la composition ni ses droits, et n’exécute aucun code du paquet. L’installation exige ensuite un plan accepté par l’administrateur, `modules:apply`, le build et la confirmation de publication décrits dans [MODULES-APPLY-OPERATEUR.md](MODULES-APPLY-OPERATEUR.md).

1. Qualifier la provenance hors du runtime et autoriser explicitement son `origin` dans `configuration/module-inventory.json` sous `allowedOrigins`. Cette commande ne modifie jamais la liste de confiance.
2. Placer les trois fichiers obtenus indépendamment sous `.creezio/packages/` dans le checkout cible : archive runtime `.tgz`, archive de validation `.tgz` et reçu JSON. Relever un SHA-256 de **chaque** fichier et écrire chaque valeur sous la forme `sha256-` suivi de 64 chiffres hexadécimaux minuscules. Les chemins doivent être relatifs au checkout, distincts et sans lien symbolique.
3. Lancer la simulation ci-dessous. Lire `would_admit`, le `candidateKey`, l’identité et la version ; aucun fichier n’est écrit. Puis relancer avec `--write` pour remplacer atomiquement le seul inventaire. Une réponse inconnue impose la relecture de l’inventaire avant toute nouvelle tentative. L’écriture prend le verrou exclusif commun à l’applicateur `.creezio/module-apply/active.json` ; si un verrou existe déjà, la commande refuse sans l’enlever. L’opérateur doit en examiner la provenance avant toute reprise.

```sh
node scripts/modules/admit.mjs \
  --module-id creezio.purchase-requests \
  --origin https://github.com/creezio/Creezio-Extension-Starter \
  --package-name @creezio/purchase-requests --version 0.1.2 \
  --runtime .creezio/packages/creezio-purchase-requests-0.1.2.tgz \
  --runtime-sha256 sha256-<64-hex> \
  --validation .creezio/packages/creezio-purchase-requests-0.1.2-validation.tgz \
  --validation-sha256 sha256-<64-hex> \
  --receipt .creezio/packages/manifest-0.1.2.json \
  --receipt-sha256 sha256-<64-hex>
```

`--write` s’ajoute à cette même commande après contrôle de la simulation. `--root`, `--composition` et `--inventory` désignent un autre checkout ou profil local lorsque nécessaire ; leurs valeurs par défaut sont le dossier courant, `configuration/composition.json` et `configuration/module-inventory.json`.

Le préflight compare les trois empreintes et vérifie le reçu détaché, le manifeste, l’identité du module, le nom/version du paquet, l’origine autorisée, les exports et les chemins déclarés. Une mise à jour doit garder le même module, la même origine et le même nom de paquet, avec une version strictement supérieure. Un nom npm possédé par un autre module, un chemin d’archive réutilisé avec une autre empreinte ou un autre rôle, les liens, les sorties du checkout et un inventaire résultant dépassant 64 Kio sont refusés avant écriture. Deux versions peuvent partager un même chemin et une même empreinte de validation si les octets sont identiques. La candidate est revalidée dans l’inventaire résultant avec le même chargeur statique que le build. Les fichiers d’archive restent sous `.creezio/packages/` après admission, car la prévisualisation et l’application relisent exactement ces octets.
