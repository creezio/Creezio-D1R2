# User stories
Révision 2 — 26 septembre 2026. Chaque story exprime un résultat pour une personne ou un rôle de développement. Elle est terminée seulement après satisfaction des exigences liées et de leurs preuves sur les profils prévus. Les modules détaillent leurs propres stories dans leur PRD, sans remplacer les exigences communes.

<a id="US-01"></a>
## US-01 — Gouvernance effective et revue indépendante

En tant que **mainteneur**, je veux **encadrer les contributions par le même parcours vérifié**, afin de **ne pas dépendre de la seule obéissance d’un agent**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-0101](EXIGENCES.md#REQ-0101), [REQ-0102](EXIGENCES.md#REQ-0102), [REQ-0103](EXIGENCES.md#REQ-0103), [REQ-0104](EXIGENCES.md#REQ-0104) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Politique/identités approuvées, premiers validateurs documentaires et de gouvernance construits puis qualifiés, règles distantes et propriétaires réels activés, tests de refus. T-02 ajoute ensuite les schémas métier et critères de modules.

Profil : **GitHub et local selon le profil**. Réalisation : [T-01](TODO.md#T-01) ; dépendances et statut y sont suivis.

<a id="US-02"></a>
## US-02 — Contrats exécutables et contrôle commun

En tant que **développeur de module**, je veux **disposer d’un contrat validé indépendamment de mes propres tests**, afin de **produire des extensions compatibles dès leur création**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-0201](EXIGENCES.md#REQ-0201), [REQ-0202](EXIGENCES.md#REQ-0202), [REQ-0203](EXIGENCES.md#REQ-0203), [REQ-0204](EXIGENCES.md#REQ-0204) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Schémas initiaux et validateur SDK sur fixtures positives/négatives, raccordés à la garde de gouvernance T-01 ; suites applicatives qualifiées ensuite avec leurs vrais modules en T-11 et T-30.

Profil : **local et CI, puis intégration des modules**. Réalisation : [T-02](TODO.md#T-02) ; dépendances et statut y sont suivis.

<a id="US-03"></a>
## US-03 — Runtime commun et démarrage local

En tant que **créateur d’app**, je veux **démarrer le dépôt sans reconstruire le backend**, afin de **commencer directement mon application**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-0301](EXIGENCES.md#REQ-0301), [REQ-0302](EXIGENCES.md#REQ-0302), [REQ-0303](EXIGENCES.md#REQ-0303) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Versions figées, lockfile, profils de build, installation sur base neuve et module témoin ; mesures initiales.

Profil : **local workerd/Miniflare**. Réalisation : [T-03](TODO.md#T-03) ; dépendances et statut y sont suivis.

<a id="US-04"></a>
## US-04 — Identités, comptes et droits

En tant que **responsable d’équipe**, je veux **accorder seulement les fonctions nécessaires à chaque personne**, afin de **utiliser le workspace en sécurité sans donner l’administration à tous**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-0401](EXIGENCES.md#REQ-0401), [REQ-0402](EXIGENCES.md#REQ-0402), [REQ-0403](EXIGENCES.md#REQ-0403) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Identités/sessions, invitations, comptes de service, rôles/contextes et module natif access.

Profil : **local, puis Sites/Cloudflare**. Réalisation : [T-04](TODO.md#T-04) ; dépendances et statut y sont suivis.

<a id="US-05"></a>
## US-05 — Données, fichiers, recherche et coffre

En tant que **éditeur d’app**, je veux **utiliser des modèles et fichiers protégés**, afin de **conserver des données fiables sur les différents hébergements**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-0501](EXIGENCES.md#REQ-0501), [REQ-0502](EXIGENCES.md#REQ-0502), [REQ-0503](EXIGENCES.md#REQ-0503), [REQ-0504](EXIGENCES.md#REQ-0504) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Services D1/R2/coffre, modèle composé et journal SQL central ; module natif data-explorer, recherche native et export/restauration.

Profil : **local, puis Sites/Cloudflare**. Réalisation : [T-05](TODO.md#T-05) ; dépendances et statut y sont suivis.

<a id="US-06"></a>
## US-06 — Opérations, événements et exécutions bornées

En tant que **opérateur ou service externe**, je veux **effectuer une action par le canal autorisé de mon choix**, afin de **obtenir les mêmes effets et garanties partout**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-0601](EXIGENCES.md#REQ-0601), [REQ-0602](EXIGENCES.md#REQ-0602), [REQ-0603](EXIGENCES.md#REQ-0603) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Registre d’opérations, API, erreurs typées, audit, idempotence, outbox, suivi et reprises.

Profil : **local, puis appel externe hébergé**. Réalisation : [T-06](TODO.md#T-06) ; dépendances et statut y sont suivis.

<a id="US-07"></a>
## US-07 — Workspace et conservation des onglets

En tant que **utilisateur du workspace**, je veux **retrouver chaque vue dans son état**, afin de **travailler sur plusieurs objets sans perdre mes brouillons**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-0701](EXIGENCES.md#REQ-0701), [REQ-0702](EXIGENCES.md#REQ-0702), [REQ-0703](EXIGENCES.md#REQ-0703) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Workspace réemployé/adapté, SDK navigation et adaptateur routeur isolé ; recette navigateur reproductible.

Profil : **navigateur local, puis Sites**. Réalisation : [T-07](TODO.md#T-07) ; dépendances et statut y sont suivis.

<a id="US-08"></a>
## US-08 — Registre minimal et identité de publication

En tant que **mainteneur Creezio**, je veux **identifier le propriétaire et les installations officielles**, afin de **suivre leur origine sans récupérer leurs données métier**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-0801](EXIGENCES.md#REQ-0801), [REQ-0802](EXIGENCES.md#REQ-0802), [REQ-0803](EXIGENCES.md#REQ-0803) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Service central séparé, vérification GitHub/email, token d’installation et contrôle de publication ; bootstrap documenté.

Profil : **service central et app cliente**. Réalisation : [T-08](TODO.md#T-08) ; dépendances et statut y sont suivis.

<a id="US-09"></a>
## US-09 — Première tranche sur Sites

En tant que **créateur d’app sur GPT**, je veux **utiliser immédiatement le même socle hébergé**, afin de **valider tôt que l’architecture fonctionne sur la cible principale**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-0901](EXIGENCES.md#REQ-0901), [REQ-0902](EXIGENCES.md#REQ-0902) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Site A réutilisé si adapté : compte, module témoin, onglets, opération et fichier ; comparaison local/Sites.

Profil : **Site public réel**. Réalisation : [T-09](TODO.md#T-09) ; dépendances et statut y sont suivis.

<a id="US-10"></a>
## US-10 — MCP, OAuth et accès machine

En tant que **utilisateur d’app ou orchestrateur externe**, je veux **appeler mes opérations depuis un client compatible**, afin de **retrouver les mêmes permissions hors du navigateur**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-1001](EXIGENCES.md#REQ-1001), [REQ-1002](EXIGENCES.md#REQ-1002), [REQ-1003](EXIGENCES.md#REQ-1003) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Endpoints admin/app, découverte, ressources, OAuth natif et tokens machine ; clients de recette figés.

Profil : **clients MCP réels et Site public**. Réalisation : [T-10](TODO.md#T-10) ; dépendances et statut y sont suivis.

<a id="US-11"></a>
## US-11 — SDK et cycle de vie des modules

En tant que **développeur d’extension**, je veux **ajouter une fonctionnalité avec le contrat commun**, afin de **éviter toute intégration ad hoc dans chaque app**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-1101](EXIGENCES.md#REQ-1101), [REQ-1102](EXIGENCES.md#REQ-1102), [REQ-1103](EXIGENCES.md#REQ-1103), [REQ-1104](EXIGENCES.md#REQ-1104), [REQ-1105](EXIGENCES.md#REQ-1105), [REQ-1106](EXIGENCES.md#REQ-1106) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : SDK versionné, résolveur et verrou transitif, module natif modules-settings, catalogue/configuration/diagnostic « dépend de / utilisé par », plan de changement et gardes communes du cycle de vie. Contributions facultatives et relations persistantes contrôlées selon DEPENDANCES-MODULES.md.

Profil : **local et app hôte**. Réalisation : [T-11](TODO.md#T-11) ; dépendances et statut y sont suivis.

<a id="US-12"></a>
## US-12 — Documentation vivante des modules

En tant que **administrateur et développeur**, je veux **consulter la spécification et l’historique de chaque module installé**, afin de **comprendre et piloter les évolutions sans confondre source et livraison**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-1201](EXIGENCES.md#REQ-1201), [REQ-1202](EXIGENCES.md#REQ-1202) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Contrôles docs, documentation embarquée et lecture UI/API/MCP autorisée ; contrats distinguant PRD installé et révisions de travail. L’édition/validation humaine des révisions est construite en T-23.

Profil : **package, workspace et API/MCP**. Réalisation : [T-12](TODO.md#T-12) ; dépendances et statut y sont suivis.

<a id="US-13"></a>
## US-13 — Fronts, thèmes et headless

En tant que **éditeur d’app**, je veux **choisir mon interface sans changer mon backend**, afin de **servir aussi bien une équipe interne qu’un public externe**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-1301](EXIGENCES.md#REQ-1301), [REQ-1302](EXIGENCES.md#REQ-1302) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Thèmes standard/ChatGPT-like, moteur de composition, composants et client headless ; personnalisation dans application/.

Profil : **navigateur et Site**. Réalisation : [T-13](TODO.md#T-13) ; dépendances et statut y sont suivis.

<a id="US-14"></a>
## US-14 — Conversations et progression persistante

En tant que **utilisateur du chat**, je veux **retrouver mes conversations et actions en cours**, afin de **continuer mon travail après navigation ou interruption**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-1401](EXIGENCES.md#REQ-1401), [REQ-1402](EXIGENCES.md#REQ-1402) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module conversations, états partagés SDK, historique/recherche/archive et transport adapté ; OpenAI indépendant.

Profil : **navigateur local et Sites**. Réalisation : [T-14](TODO.md#T-14) ; dépendances et statut y sont suivis.

<a id="US-15"></a>
## US-15 — Module OpenAI et contrat fournisseur

En tant que **administrateur d’app**, je veux **activer un LLM avec ma clé serveur**, afin de **obtenir de vraies réponses et actions dans le chat standard**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-1501](EXIGENCES.md#REQ-1501), [REQ-1502](EXIGENCES.md#REQ-1502) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module OpenAI, configuration/modèle, adaptation Responses/outils et quotas ; ports autres fournisseurs/voix.

Profil : **OpenAI réel et chats app/workspace**. Réalisation : [T-15](TODO.md#T-15) ; dépendances et statut y sont suivis.

<a id="US-16"></a>
## US-16 — Widgets et plugins conversationnels compatibles GPT

En tant que **utilisateur de l’app**, je veux **agir sur mes données depuis un widget dans Creezio ou GPT**, afin de **utiliser la même fonctionnalité dans mes conversations**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-1601](EXIGENCES.md#REQ-1601), [REQ-1602](EXIGENCES.md#REQ-1602), [REQ-1603](EXIGENCES.md#REQ-1603), [REQ-1604](EXIGENCES.md#REQ-1604), [REQ-1605](EXIGENCES.md#REQ-1605), [REQ-1606](EXIGENCES.md#REQ-1606), [REQ-1607](EXIGENCES.md#REQ-1607) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Hôte multiwidgets, ressources MCP Apps, paquet plugin/skills, modes message/contexte/direct par action, adaptateur GPT et recette réelle des trois modes dans les deux chats.

Profil : **chat Creezio et conversation ChatGPT**. Réalisation : [T-16](TODO.md#T-16) ; dépendances et statut y sont suivis.

<a id="US-17"></a>
## US-17 — Tâches humaines et travail

En tant que **responsable d’équipe**, je veux **organiser tâches et validations dans l’app**, afin de **suivre le travail même sans moteur externe**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-1701](EXIGENCES.md#REQ-1701) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module tasks-work avec PRD/docs/CI et parcours de travail humain.

Profil : **workspace, API et MCP**. Réalisation : [T-17](TODO.md#T-17) ; dépendances et statut y sont suivis.

<a id="US-18"></a>
## US-18 — Messagerie native

En tant que **collaborateur**, je veux **préparer et conserver mes échanges dans l’app**, afin de **ne pas dépendre du transport pour mon travail de rédaction**.

Lorsque je suis autorisé dans le workspace et le front, je retrouve les mêmes boîtes, brouillons et pièces jointes dans le même contexte. Retirer mon droit dans une interface ne duplique pas mes données et ne m’accorde aucun droit dans l’autre.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-1801](EXIGENCES.md#REQ-1801) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module messaging : boîtes/messages/brouillons/pièces jointes et port de transport.

Profil : **workspace et API/MCP**. Réalisation : [T-18](TODO.md#T-18) ; dépendances et statut y sont suivis.

<a id="US-19"></a>
## US-19 — Support

En tant que **équipe de support**, je veux **suivre les demandes et réponses**, afin de **maintenir un historique partagé des résolutions**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-1901](EXIGENCES.md#REQ-1901) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module support et relations autorisées avec contacts/messages/tâches.

Profil : **workspace et API/MCP**. Réalisation : [T-19](TODO.md#T-19) ; dépendances et statut y sont suivis.

<a id="US-20"></a>
## US-20 — CRM

En tant que **collaborateur**, je veux **gérer contacts entreprises et prospects**, afin de **relier les actions aux bonnes entités métier**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-2001](EXIGENCES.md#REQ-2001) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module crm, entités/relations/recherche et vues.

Profil : **workspace et API/MCP**. Réalisation : [T-20](TODO.md#T-20) ; dépendances et statut y sont suivis.

<a id="US-21"></a>
## US-21 — Pages et navigation

En tant que **administrateur éditorial**, je veux **composer landing et navigation**, afin de **publier les contenus de mon app sans recoder son front**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-2101](EXIGENCES.md#REQ-2101) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module pages-navigation, médias/SEO/édition et reset contrôlé.

Profil : **front, workspace et API/MCP**. Réalisation : [T-21](TODO.md#T-21) ; dépendances et statut y sont suivis.

<a id="US-22"></a>
## US-22 — Analytics et diagnostics

En tant que **administrateur autorisé**, je veux **comprendre usage et erreurs**, afin de **suivre mon application sans exposer les données de mes utilisateurs**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-2201](EXIGENCES.md#REQ-2201) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module analytics, consultation de l’audit, productivité/usage et exports limités.

Profil : **workspace et API/MCP**. Réalisation : [T-22](TODO.md#T-22) ; dépendances et statut y sont suivis.

<a id="US-23"></a>
## US-23 — Intentions et développement piloté

En tant que **propriétaire d’app**, je veux **valider les spécifications et suivre leur réalisation**, afin de **garder le contrôle des évolutions même assistées par IA**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-2301](EXIGENCES.md#REQ-2301), [REQ-2302](EXIGENCES.md#REQ-2302) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module intentions-development, révisions/validation PRD, tâches, artefacts et historique de livraison.

Profil : **workspace et API/MCP**. Réalisation : [T-23](TODO.md#T-23) ; dépendances et statut y sont suivis.

<a id="US-24"></a>
## US-24 — Règles et automatisation sans scheduler

En tant que **administrateur d’app**, je veux **définir les réactions et reprises autorisées**, afin de **automatiser le métier avec un orchestrateur externe**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-2401](EXIGENCES.md#REQ-2401) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module automation-rules, événements, conditions/actions et journal.

Profil : **API/MCP externe et workspace**. Réalisation : [T-24](TODO.md#T-24) ; dépendances et statut y sont suivis.

<a id="US-25"></a>
## US-25 — Catalogue métier réutilisable

En tant que **éditeur d’app**, je veux **installer un catalogue commun**, afin de **réutiliser des produits sans dépendre d’un métier particulier**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-2501](EXIGENCES.md#REQ-2501) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module catalogue, données produit et ports publics de référence.

Profil : **app fraîche et widgets**. Réalisation : [T-25](TODO.md#T-25) ; dépendances et statut y sont suivis.

<a id="US-26"></a>
## US-26 — Connecteur n8n

En tant que **administrateur d’app**, je veux **configurer mon n8n existant puis utiliser ses workflows**, afin de **intégrer l’automatisation sans maintenance tierce dans Creezio**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-2601](EXIGENCES.md#REQ-2601), [REQ-2602](EXIGENCES.md#REQ-2602) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module n8n : connexion, workflows autorisés, déclenchements/suivi/widgets et callbacks.

Profil : **n8n réel + Site public**. Réalisation : [T-26](TODO.md#T-26) ; dépendances et statut y sont suivis.

<a id="US-27"></a>
## US-27 — Connecteur Stripe

En tant que **éditeur d’app**, je veux **activer les paiements avec mes accès Stripe**, afin de **utiliser des opérations de paiement déjà intégrées**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-2701](EXIGENCES.md#REQ-2701) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module Stripe : produits/prix/clients/checkout/abonnements selon PRD, webhooks et widgets.

Profil : **Stripe en mode test**. Réalisation : [T-27](TODO.md#T-27) ; dépendances et statut y sont suivis.

<a id="US-28"></a>
## US-28 — Connecteur Meili

En tant que **administrateur d’app**, je veux **brancher un moteur de recherche existant**, afin de **améliorer la recherche selon les déclarations des modules**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-2801](EXIGENCES.md#REQ-2801) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module Meili, projections, indexation incrémentale et reconstruction reprenable.

Profil : **Meili réel et recherche native**. Réalisation : [T-28](TODO.md#T-28) ; dépendances et statut y sont suivis.

<a id="US-29"></a>
## US-29 — Autres connecteurs et frontières externes

En tant que **éditeur d’app**, je veux **retrouver les intégrations utiles sous forme de modules**, afin de **préserver les fonctions du produit sans alourdir son runtime**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-2901](EXIGENCES.md#REQ-2901), [REQ-2902](EXIGENCES.md#REQ-2902) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : PRD et tâches par fournisseur : Hermes, mail, navigateur distant/relais, Granola, agents/exécution de développement, observabilité, desktop/infrastructure et autres IA/voix selon les capacités de la matrice.

Profil : **chaque fournisseur réel autorisé**. Réalisation : [T-29](TODO.md#T-29) ; dépendances et statut y sont suivis.

<a id="US-30"></a>
## US-30 — Starter, paquets et extension externe

En tant que **éditeur de module externe**, je veux **partir d’un dépôt prêt puis publier une extension installable**, afin de **contribuer sans reconstruire les conventions du CMS**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-3001](EXIGENCES.md#REQ-3001), [REQ-3002](EXIGENCES.md#REQ-3002), [REQ-3003](EXIGENCES.md#REQ-3003), [REQ-3004](EXIGENCES.md#REQ-3004) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Starter destiné à un dépôt public, paquet runtime, validation autonome, plugin et démo locale ; comparateur fournisseur de référence, chaîne de dépendances interéditeurs et intégration facultative depuis les archives réelles. Vérifier les droits avant toute distribution concernée ; publication de la démo qualifiée en T-32.

Profil : **tarball dans app de validation indépendante et démo locale**. Réalisation : [T-30](TODO.md#T-30) ; dépendances et statut y sont suivis.

<a id="US-31"></a>
## US-31 — Docker local persistant

En tant que **développeur hors GPT**, je veux **développer et tester sans compte Cloudflare**, afin de **travailler hors ligne avant publication**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-3101](EXIGENCES.md#REQ-3101) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Docker/Miniflare/workerd, volumes et diagnostic ; recette redémarrage/restauration.

Profil : **Docker local réel**. Réalisation : [T-31](TODO.md#T-31) ; dépendances et statut y sont suivis.

<a id="US-32"></a>
## US-32 — Publication complète Cloudflare

En tant que **propriétaire d’app**, je veux **publier toute mon application depuis le local**, afin de **faire fonctionner la production sans garder mon ordinateur allumé**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-3201](EXIGENCES.md#REQ-3201), [REQ-3202](EXIGENCES.md#REQ-3202), [REQ-3203](EXIGENCES.md#REQ-3203) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Module livraison locale et exécuteur limité, Worker/assets, bindings D1/R2, transfert cohérent et reprise ; original et démo du starter publiés. Le fork sera exercé en T-38.

Profil : **compte Cloudflare autorisé réel**. Réalisation : [T-32](TODO.md#T-32) ; dépendances et statut y sont suivis.

<a id="US-33"></a>
## US-33 — Stockages distincts hors Sites

En tant que **éditeur d’app ayant ce besoin**, je veux **isoler physiquement les données de plusieurs contextes**, afin de **adapter le stockage sans dupliquer mon application**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-3301](EXIGENCES.md#REQ-3301) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Résolveur de ressources autorisées, provisionnement/bindings et qualification des quotas.

Profil : **local puis Cloudflare direct**. Réalisation : [T-33](TODO.md#T-33) ; dépendances et statut y sont suivis.

<a id="US-34"></a>
## US-34 — Éditions, politiques et activation

En tant que **mainteneur Creezio**, je veux **séparer l’enregistrement des droits commerciaux**, afin de **faire évoluer les offres sans recoder les permissions métier**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-3401](EXIGENCES.md#REQ-3401), [REQ-3402](EXIGENCES.md#REQ-3402) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Politiques versionnées, justificatifs signés, états de facturation/activation et tests Community/Enterprise.

Profil : **service central et app**. Réalisation : [T-34](TODO.md#T-34) ; dépendances et statut y sont suivis.

<a id="US-35"></a>
## US-35 — Accompagnement avec accès consenti

En tant que **propriétaire d’app**, je veux **autoriser Creezio à m’aider sur mon code**, afin de **obtenir une assistance sans céder tous mes accès**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-3501](EXIGENCES.md#REQ-3501) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Consentement limité/révocable, périmètres lecture/branche-PR/déploiement distincts, audit et révocation.

Profil : **dépôt de test consenti**. Réalisation : [T-35](TODO.md#T-35) ; dépendances et statut y sont suivis.

<a id="US-36"></a>
## US-36 — Release de l’original

En tant que **mainteneur**, je veux **publier une version vérifiée et installable**, afin de **offrir une base fiable aux nouvelles applications**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-3601](EXIGENCES.md#REQ-3601), [REQ-3602](EXIGENCES.md#REQ-3602) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Release de l’original, manifeste versions/propriété, docs, artefacts et adoption selon Git flow.

Profil : **CI, Site A et artefacts publiés**. Réalisation : [T-36](TODO.md#T-36) ; dépendances et statut y sont suivis.

<a id="US-37"></a>
## US-37 — Vrai fork Creezio Lab et Site B

En tant que **créateur d’app**, je veux **forker le socle puis personnaliser mon application**, afin de **conserver une origine et des mises à jour suivables**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-3701](EXIGENCES.md#REQ-3701), [REQ-3702](EXIGENCES.md#REQ-3702) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Fork public Creez-io/Creezio-Lab après validation du socle, Site B, thème et demandes d’achat/validation budget.

Profil : **GitHub et deux Sites publics**. Réalisation : [T-37](TODO.md#T-37) ; dépendances et statut y sont suivis.

<a id="US-38"></a>
## US-38 — Adoption des mises à jour et contributions

En tant que **éditeur d’app dérivée**, je veux **adopter les évolutions choisies du socle et de mes modules**, afin de **profiter de la communauté sans perdre mon travail**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-3801](EXIGENCES.md#REQ-3801), [REQ-3802](EXIGENCES.md#REQ-3802), [REQ-3803](EXIGENCES.md#REQ-3803) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Release A→B, update individuelle de module/thème, starter installé, issue/PR amont, refus d’update/retrait cassant les consommateurs et preuves des intégrations facultatives ; publication Cloudflare du fork via le parcours T-32.

Profil : **A/B, Cloudflare, tarballs et GitHub**. Réalisation : [T-38](TODO.md#T-38) ; dépendances et statut y sont suivis.

<a id="US-39"></a>
## US-39 — Recette finale et validation utilisateur

En tant que **propriétaire du produit**, je veux **voir fonctionner l’original et son dérivé de bout en bout**, afin de **valider le socle avant de reconstruire des applications métier**.

Étant donné une installation ou un dépôt de test avec les prérequis déclarés, lorsque ce parcours est exécuté avec un acteur autorisé, alors les résultats définis dans [REQ-3901](EXIGENCES.md#REQ-3901) sont observables. Avec des droits, une configuration ou un artefact invalides, les refus et conservations prévus par ces mêmes critères sont vérifiés.

Livrable observable : Rapport associé à ses preuves : versions/SHA/profils, scénarios positifs/négatifs, limites et démonstration utilisateur.

Profil : **deux Sites, Cloudflare et clients GPT/MCP**. Réalisation : [T-39](TODO.md#T-39) ; dépendances et statut y sont suivis.
