# Access — comptes et accès natifs

Version de travail 0.0.0, tranche de persistance de [T-04](../../../docs/IMPLEMENTATION-T04.md). Ce module possède les modèles privés d'identité ; le cœur assure leurs règles, la cryptographie et les décisions de droits.

Le premier compte nécessite une capacité d'installation provisionnée explicitement par le responsable du déploiement. Les mots de passe utilisent Argon2id ; les sessions utilisent des secrets opaques dont seule l'empreinte est stockée. L'acquisition d'une installation et ses effets sont atomiques dans une seule D1 ; une session est revalidée à chaque lecture et à son émission après vérification du mot de passe.

Aucune route HTTP, UI, MCP ni widget n'est exposé dans cette tranche. Les comptes persistants sont qualifiés par des harnais D1 ; ce n'est pas encore un parcours de connexion publié. Le module reste hors de la composition par défaut jusqu'à son raccordement complet. Les interfaces prévues dans le PRD restent à réaliser.

Les modèles canoniques sont dans `module/models.json`. Le manifeste et `data/schema/access.sql` sont des sorties déterministes du générateur central. `npm run data:access` les actualise explicitement ; `npm run check:data` refuse une dérive sans la corriger. L'empreinte source du manifeste désigne les octets du snapshot de modèles, pas une archive distribuée. Les contrôles complets identifient aussi tous les fichiers du dépôt.

`node extensions/native/access/gate.mjs` exécute les six suites. Backend/package/docs sont requis ; UI/API-MCP/widgets vérifient explicitement l'absence d'exposition, sans certifier des parcours non construits. La recette indépendante workerd/D1 du cœur complète ces suites dans `npm run check`.
