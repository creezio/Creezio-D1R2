# T12 — Documents de la version installée

REQ-1201/1202, US-12. Branche `core/t12-installed-documentation`, issue de main `037c0a0b` qualifié avec 908 tests. PR #21 intégrée : candidat `ae312982043971eabe27bc984e15f60451d463db`, main `20d48fda89d570f43c446eee71721b2a8750ab2f`, arbre `aef9cdb412a6adcb68d783e32decf06bd0de82f3`. 923/923 tests locaux et CI candidat 36301642996/main 36302251823, zéro échec/ignoré/annulé/todo ; types/build/Workerd, source inchangée et artefact courant. Trois revues indépendantes et protections vérifiées avant squash sans bypass.

## Source et lecture

README, PRD et changelog sont capturés à la construction depuis les mêmes octets que l'archive runtime vérifiée. La sélection précise la version et ses intégrités ; un candidat disponible mais non sélectionné ne fournit aucun document installé. Les documents de développement restent dans l'artefact de validation. Le runtime n'accède ni au filesystem Node ni à GitHub.

La capacité privée de l'hôte transmet les textes immuables au module natif `modules-settings`. Celui-ci déclare deux requêtes `docs.list` et `docs.read`, accessibles par HTTP et MCP admin avec sa permission `manage` et les mêmes contrôles frais que ses fiches. `public` dans les métadonnées d'un document n'accorde pas un accès anonyme. Les comptes machine ne reçoivent pas une exception aux règles d'administration native.

Les documents sont bornés à 64 Kio chacun, 192 Kio par module et 1 Mio cumulé. L'inventaire compilé complet conserve son plafond de 4 Mio. Une lecture fournit au plus 16 Kio de texte UTF-8, sans couper un point de code. Version, révision source, intégrité runtime, empreinte documentaire et nombre de blocs sont liés. Le client vérifie ordre, identité, taille et empreinte du texte reconstitué ; une publication remplaçant le document exige une nouvelle sélection explicite.

## Interface conservée

La fiche adapte les onglets et cartes PRD/Documents/Changelog de `packages/product-hub/ui/plugin-detail.tsx` du Creezio original, révision `6bd6507633b4c17bfc31206d82d1caa9a8af19af`. README apparaît dans Documents. Le texte est échappé, avec les sauts de ligne conservés ; aucun HTML exécutable ou moteur Markdown supplémentaire n'est nécessaire.

Le changelog de l'éditeur, le journal des plans de l'application et le PRD local de travail restent distincts. T23 réalisera l'édition et la validation humaine de ce dernier ; T32 la publication. Ces fonctions ne sont pas simulées par des boutons sans effet.

## Contrôles prévus

Capture exacte et versions candidates, UTF-8 et plafonds ; refus des documents hors sélection, liens, dérives de version ou d'empreinte ; correspondance API/MCP et droits frais ; assemblage des blocs et invalidation des réponses périmées ; lecture et conservation des onglets dans le navigateur. Les six suites du module et le contrôle global restent requis avant intégration. Recettes Sites et ChatGPT distinctes et encore en attente des accès.

La première qualification a révélé un dépassement du budget brut local de 3 599 octets : 2 803 599 bruts / 603 357 gzip, contre 2 644 629 / 575 390 en T11. L'attribution indépendante couvre exactement le delta : 33 142 octets de documents, code de lecture, interface et validateurs des deux opérations ; aucun double embarquement des textes observé. Le plafond brut local passe à 2 900 000 ; gzip 625 000, démarrage 15 s et routes 3 s restent inchangés. Ce budget n'est pas un quota Cloudflare ou Sites.

La suite Windows T11 utilisait déjà environ 230 s sur les 240 s autorisées. Le premier parcours T12 a atteint cette borne après le test 700, sans résumé TAP, et reste un échec conservé. La borne de la suite complète passe à 360 s avec durée mesurée ; aucune limite produit, aucun compteur requis et aucun test ne sont retirés. La recette navigateur est arrêtée pendant le nouveau contrôle pour limiter la concurrence locale.

## Recette finale

Le navigateur local a vérifié les trois documents de deux modules, version/source, retour au panneau conservé, réponse HTTP200 perdue puis reprise sans afficher un texte incomplet, révocation des vues et déconnexion. Le premier essai avait révélé une lecture trop tôt lors de la réactivation ; corrigée puis rejouée sur l’artefact final `sha256-18a77b216fc728c229c7457c87a9f9a26a19ee2723b14995500d0907e1be388d`. Preuves CREEZIO-T12-CONTROLES, REVUE-API/SDK/UI/ROOT et NAVIGATEUR conservées hors commit ; essais initiaux échoués conservés séparément. Aucun hébergement ou ChatGPT réel qualifié par cette recette.
