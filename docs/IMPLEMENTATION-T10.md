# T-10 — MCP et OAuth natifs

État : PR #19 intégrée, candidat `d691805e`, main `f52a17b9`, arbre commun `8d8e63d3`. Local et CI candidat/main (36296748920/36297058152) : 866/866, types/build/Workerd et artefact courant. Trois revues indépendantes sans blocage. Ce document précise la réalisation de [T-10](TODO.md#T-10) sans remplacer ses critères : le Site public et ChatGPT restent des preuves distinctes.

La recette navigateur locale confirme connexion native, sélection/refus/consentement, outils administratifs, mutation idempotente et révocation. Le callback OAuth réel est vérifié par le client SDK. Sa navigation visuelle dans le navigateur intégré a été bloquée par l'inspecteur (`ERR_BLOCKED_BY_CLIENT`) ; elle n'est pas revendiquée qualifiée. Le DCR dispose de quotas globaux, qui ne prouvent pas l'équité entre appelants anonymes ; durcissement à traiter avant exposition publique du produit.

## Surfaces et opérations communes

Le même Worker expose `/mcp/admin` et `/mcp/app`. La composition choisit les modules et leurs contributions dans chaque audience. Le catalogue MCP est compilé depuis leurs déclarations, puis vérifié contre le registre d'opérations T-06. Une contribution ne peut inventer un handler privilégié, relâcher son acteur ou accéder à une autre audience. Les dix opérations Access existantes deviennent utilisables par OAuth administratif explicitement consenti ; elles réutilisent leur logique, leur garde et le batch résultat/audit déjà qualifié.

Le transport stateless utilise le SDK MCP officiel et ses clients de recette. Chaque requête authentifie un Bearer natif ; aucun cookie de navigateur ou en-tête GPT ne lui sert de repli. La découverte filtre contexte, acteurs et permissions actuels. L'invocation repasse par le moteur commun et sa garde fraîche. Une ressource n'est annoncée que si l'hôte sait effectivement la charger sous ces mêmes règles. Les outils anonymes et les notifications persistantes ne sont pas annoncés par cette tranche.

## Comptes et consentement

OAuth délègue un compte humain Creezio existant, sans compte GPT ou session humaine fabriquée. La ressource est l'origine configurée suivie du chemin MCP exact. Un grant appartient à un compte, un client, une ressource, une audience et un contexte. Ses scopes sont les identifiants canoniques de permissions du module ; leur intersection avec les droits actuels reste obligatoire. Une portée vide n'accorde aucun droit implicite. L'API machine garde ses credentials de service distincts et choisit un contexte explicitement autorisé, via `X-Creezio-Context` (défaut `application`).

Le consentement reprend la carte `consentPage` du Creezio original (`packages/mcp-facade/src/oauth/routes.ts`) avec le SDK de connexion native. La page hôte est `/oauth/consent/{transactionId}`. Elle présente application cliente, compte, audience, contexte et permissions ; la décision et le jeton CSRF restent liés à la transaction et à la session. Seul le serveur construit la redirection vers l'URI enregistrée. Aucun destinataire fourni par le widget n'est adopté librement.

Les clients publics utilisent PKCE S256, code à usage unique et renouvellement avec rotation ; le rejeu d'un refresh token révoque sa famille. La préinscription et le DCR borné sont implémentés ; CIMD n'est pas annoncé sans implémentation effective. L'émetteur vient de `CREEZIO_APP_ORIGIN`, jamais de Host/Forwarded. HTTPS est requis en hébergement ; HTTP loopback est explicitement réservé au développement local. Les métadonnées et flux respectent les audiences réellement exposées.

## Persistance et autorité

Six modèles privés du module Access portent clients, transactions, grants, codes, access tokens et refresh tokens. Ils passent par le même compilateur SQL central que les autres modèles. Aucune valeur claire de credential n'y est stockée. Les versions du compte, du mot de passe et du principal invalident les grants concernés ; la révocation du client, du grant ou du token et les changements d'ACL sont relus.

L'autorité administrative est discriminée session/OAuth. La colonne historique `session_id` reste vide pour OAuth ; `credential_id` conserve l'identifiant du jeton d'accès utilisé, avec le contexte et l'audience dans l'audit Access. L'audit d'opération conserve l'acteur et le sujet. Les écritures sont conditionnées par une garde D1 dans le batch qui contient effets, résultat et audit. Une révocation entre résolution et commit bloque tout le batch. Un timeout n'établit pas l'absence d'effet et ne permet pas de rejouer une commande consommée.

L'impersonation reste un parcours distinct initié par session humaine autorisée. L'éligibilité d'une délégation humaine à confirmer ne constitue jamais une preuve de confirmation : les opérations exigeant une approbation restent fermées tant que leur mécanisme commun n'est pas qualifié.

## Contrôles et limites

Les suites obligatoires `tests/oauth`, `tests/mcp`, `tests/data` et les tests Access couvrent protocole, vrai D1, clients MCP réels, séparation des audiences, consentement, plafonds, révocation, PKCE, rejeu et atomicité. Le résultat du contrôle global et la recette navigateur doivent être rattachés au candidat exact avant intégration. Les essais en processus ou Workerd ne prouvent pas une connexion dans ChatGPT ni le fonctionnement d'un Site inaccessible au compte courant.

La configuration OAuth GitHub du registre central est indépendante de l'OAuth natif de l'application. Son attente ne bloque pas ces développements. Le paquet de plugin, les ressources UI MCP Apps, les widgets multiples et le chat interne restent dans leurs lots dédiés ; ce transport ne les déclare pas livrés.
