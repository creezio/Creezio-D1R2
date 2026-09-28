# Installation et publication sur Sites

Le profil Sites utilise le même Worker, les mêmes modules et les mêmes comptes que les autres hébergements. Seuls les bindings logiques DB/BUCKET, le profil de compilation et le parcours opérateur changent. `configuration/composition.sites.json` sélectionne le socle natif et le thème ChatGPT-like ; les vues métier synthétiques des tests n'y figurent pas. L'origine et les secrets sont des variables du déploiement, sans valeur propre à un compte dans le dépôt générique.

La cible se lit depuis le manifeste `.openai/hosting.json` du Site sélectionné. Un changement de compte GPT qui rend une ancienne cible inaccessible autorise une nouvelle cible publique, avec conservation de sa provenance ; les publications suivantes réutilisent cette cible. Les sources et données de l'ancien Site sont préservées.

Dans un checkout neuf sous Node 24, exécuter `npm ci --ignore-scripts` puis `npm run sdk:build` avant `npm run build:sites`. Le build Sites prépare le schéma central et compile le Worker commun avec la composition Sites. Par défaut, le manifeste est celui du checkout courant ; `CREEZIO_SITES_MANIFEST` peut indiquer le chemin absolu d'un checkout Sites sélectionné. Cela permet de réutiliser les dépendances du checkout de développement. Le résultat reste dans son unique `dist/`. La source publiée doit contenir les mêmes fichiers applicatifs et le journal DDL de la cible ; ne pas copier de dépendances, données locales ou secrets.

## Schéma central

`scripts/sites/schema.mjs` reçoit le plan de composition approuvé. Il génère les déclarations actuelles dans `db/schema.ts`, et emploie le journal DDL personnalisé de Drizzle pour conserver exactement les contraintes et les tables WITHOUT ROWID produites par le compilateur commun. Ce n'est pas un deuxième modèle de données à maintenir. Les auteurs de modules ne fournissent aucun script de transformation.

Les fichiers générés SQL, instantanés et journal sont versionnés avec la source du Site. La génération initiale crée les objets ; les suivantes ajoutent les nouveaux objets ou des colonnes explicitement nullables sans défaut, et conservent les objets retirés de la composition. L'historique garde la déclaration canonique et le texte exact attendu dans `sqlite_schema` après un `ALTER TABLE`, pour que l'inspection de l'opérateur reste stricte. Les contraintes et définitions existantes doivent rester identiques ; suppression, renommage, changement de type ou ajout obligatoire sont refusés. Aucun jeu de données, compte ou clé n'est inséré dans le DDL. Les fichiers déjà appliqués sont immuables ; le fournisseur peut avoir appliqué du SQL avant une publication Worker échouée.

## Premier compte

L'outil `scripts/sites/prepare-operator.mjs` produit un artefact opérateur distinct pour la cible neuve. Il réutilise les services natifs de première installation. Son unique commande exige un jeton secret, une origine HTTPS exacte, une échéance maximale d'une heure et le plan attendu. Il compare les définitions réelles de la base, y compris les objets propres à l'hébergeur préalablement inspectés, avant toute écriture ; le contrôle accompagne les batchs.

Une installation consommée renvoie son compte existant. Une réponse perdue se réconcilie par inspection et ne remplace pas le compte. Si l'interruption précède la consommation de la capacité native, l'état `capability_pending` est conservé jusqu'à expiration de cette capacité ; l'opérateur ne réarme pas une capacité encore vivante. Cette limite de disponibilité ne permet ni reset ni création d'un deuxième propriétaire.

Après création du compte, publier le Worker applicatif ordinaire sur le même Site, puis retirer les secrets de l'opérateur. `worker.ts` n'importe jamais l'installateur et ne contient aucune route bootstrap permanente. La recette doit confirmer la connexion au compte conservé après remplacement de l'artefact et la disparition de la route opérateur.

## Publication et preuve

Le contrôle du registre central précède le publisher et journalise sa déclaration. Le parcours natif Sites publie une version dont la source a été poussée et dont l'archive correspond ; le statut du fournisseur confirme la livraison. Une déclaration incertaine se réconcilie sans redéployer. Aucun bouton du CMS ne prétend déclencher une publication Sites.

Le parcours a été exécuté sur une cible neuve : l'application a remplacé l'opérateur, le même compte natif se connecte et l'ancienne route opérateur renvoie 404. Les réponses OpenAI du workspace et du front, la persistance du brouillon et la relecture R2 ont leurs preuves hébergées propres. La recette finale du candidat reste distincte de ces étapes intermédiaires ; voir [la qualification Sites](QUALIFICATION-SITES.md).
