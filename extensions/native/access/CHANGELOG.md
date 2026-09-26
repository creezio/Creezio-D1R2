# Changelog access

## 0.0.0 — travail non publié

Entrées navigateur `/access/admin` et `/access/app` via le SDK partagé de l'hôte, activées par composition et audience. Le manifeste garde les vues métier privées absentes ; les tests du SDK, du rendu et du navigateur sont distingués des six suites du module. Aucun modèle ou SQL ajouté pour l'interface de connexion.

Modèles d'identité : comptes, mots de passe, sessions, installation explicite, audit technique et admission. SQL généré centralement et persistance exercée dans D1.

Ajout des modèles de contextes, memberships par audience, rôles, héritages, grants, exceptions et affectations. Le bootstrap crée leur seed minimal dans son batch conditionné ; l'audit accepte les mises à jour d'autorisation. Les liens composites empêchent les affectations et exceptions orphelines ou rattachées à une autre audience. Résolution et mutations protégées se qualifient avec les services du cœur.

Ajout du modèle privé `account_capabilities` pour invitation, activation et reset : empreinte unique, versions de la cible, expiration et états consommé/révoqué. L'audit garde désormais acteur, cible et identifiant de capacité ; les événements de cycle de compte sont distincts. Les contraintes D1 et les services internes se qualifient dans la tranche T-04 correspondante, sans attribution de rôle ni connexion automatique. Aucun e-mail n'est envoyé par ce modèle.

Ajout des credentials API privés et de leurs scopes relationnels par contexte/audience/permission. Parseur strict partagé pour déclarations et projections D1, sans fusion silencieuse ni produit cartésien. L'audit accepte création/statut de service et émission/rotation/révocation de jeton, avec identifiant de credential historique. Les services machine et leurs guards se qualifient séparément ; aucun rôle natif implicite ni validation humaine par token.

Administration humaine : actions `human-status-updated`, `human-sessions-revoked` et `human-session-revoked`, cible historique de session séparée de la session de l'acteur, et quatre index pour pagination/invalidation bornées. Le modèle conserve dix-neuf tables privées. Les services distinguent statut du principal et état du compte humain, incrémentent la version pour l'invalidation globale et ne suppriment aucun historique. Refus de l'auto-désactivation ; auto-révocation explicite permise. Impersonation et transports restent distincts de ce lot.

Impersonation : ajout de deux modèles privés et des références d'audit acteur/sujet/source/délégation/contexte/audience. Credential et purpose distincts, acteur `impersonated-user`, permission native impersonate réservée sans grant bootstrap ; déclaration de manage alignée sur les humains directs. Le moteur exige l'éligibilité explicite de l'opération et de ses permissions, refuse approbation humaine et gestion native, et conserve un scope exact. La fin explicite ne change pas les sessions personnelles de la cible ; aucune interface ou restauration silencieuse de session n'est annoncée par ce lot interne.

Raccordement du transport HTTP natif login/session/logout du cœur à la composition : module access activé et audiences admin/app exposées explicitement, drapeaux générés fermés par défaut et namespace réservé. Aucun nouveau modèle, SQL ni contrat API métier artificiel. Les garanties d'origine, cookies et parsing borné se qualifient avec les recettes du transport ; aucun bootstrap ou parcours administratif n'est ajouté aux routes natives.

Gestion visuelle des droits, interfaces et qualification hébergée encore à construire ; aucune publication produit ni version de paquet distribuée annoncée.
