# Réalisation T-13 — Fronts, thèmes et headless

T-13 / US-13 / REQ-1301 et REQ-1302. Branche `core/t13-front-themes`, base main PR #21 `20d48fda` qualifiée avec 923 tests. PR #22 intégrée, main `d12ab795` et candidat `b950fba3` de même arbre. 953 tests réussis en local et CI (candidat 36304940073, main 36305223665). Les recettes navigateur des deux thèmes, conservation des brouillons, écriture inconnue réconciliée sans rejeu et révocation sont qualifiées localement. Aucune recette Sites ou parité complète du CMS n'est revendiquée.

## Présentation facultative, backend commun

`composition.front` conserve ses trois modes : workspace seul, thème ou headless. Les thèmes sont des modules soumis aux mêmes contrats, dépendances, archives, documentation et six suites que les autres extensions. `ui.themes` déclare les exports et emplacements supportés. Le compilateur résout le module/version/thème exact ; aucun téléchargement de JavaScript au runtime.

Les modules actifs exposés à `app` déclarent vues, routes, navigation et slots. Le build produit un registre front distinct ; seuls les éléments autorisés sont transmis au rendu. Les routes paramétrées et leurs entrées utilisent le même parseur et les mêmes validateurs que le workspace. Une contribution de slot doit accepter une entrée vide et une identité sans paramètres ; un thème qui ne supporte pas son emplacement est refusé.

Les choix `workspace` et `headless` n'activent pas le endpoint de projection du front thémé. Ils conservent les API natives autorisées. Le headless peut employer le SDK ou ses propres composants, sans détourner le back-office.

## Réemploi et personnalisation

Le thème standard assemble les primitives publiques et la palette du Creezio original. Le thème ChatGPT-like reprend le rail/sidebar/mobile, la topbar et les zones centrale/latérale de Certivan V5. Les sources exactes et adaptations sont décrites dans les deux modules sous `themes/`. Le métier Certivan et ses appels API ne sont pas embarqués. Le chat réel sera fourni par les modules T14/T15 ; aucun faux assistant n'est présenté.

`application/config/front.ts` et `application/frontend/index.ts` appartiennent à l'application : branding, contexte par défaut et remplacement facultatif du thème. Leur mise à jour est indépendante des thèmes ; changer la présentation n'écrit pas dans les modèles métier. La composition produit initiale reste workspace. Les deux compositions `configuration/composition.front-*.json` sont des recettes synthétiques explicites, pas le front d'une application métier achevée.

## Accès et données

Les comptes du front utilisent la session native `app`. Une session admin, une identité GPT ou un choix de contexte ne donne aucun droit. La projection `/api/front/projection` résout la politique courante de D1 et lie session, principal, contexte, composition et epoch aux vues, navigation et slots autorisés. Les opérations conservent leurs gardes serveur ; une projection UI ne permet pas une écriture ultérieure à elle seule.

Les vues `public-read` ont des props de présentation sans session ni client d'opérations. Les vues protégées réutilisent les panneaux, gardes d'activité, brouillons et portails du SDK workspace. Les opérations HTTP anonymes encore non qualifiées restent refusées ; cette tranche n'invente pas de principal public pour les exécuter.

La restauration d'un panneau front exige l'intégrité runtime exacte de son module, même si la composition n'a pas changé. Un changement de thème conserve les états compatibles ; un module modifié ne récupère pas un ancien brouillon sans cette correspondance. Identité, contexte, droits, route et schéma restent revalidés. Pendant une vérification temporaire, les panneaux protégés sont masqués et inactifs ; un refus confirmé les purge. Les catalogues compilés refusent plus de 1 000 contributions par catégorie et les identifiants qualifiés de plus de 128 caractères.

Le client externe `sdk/front/headless.ts` utilise les codecs HTTP communs et les bindings `app`, avec jeton API ou OAuth fourni par l'appelant. Il n'envoie pas de cookie, ne suit pas les redirections et ne relance pas automatiquement une mutation dont le résultat est inconnu. La reprise utilise un GET par exécution ou clé. Une rotation de credentials invalide la réponse en vol. Le navigateur entre origines reste soumis à la politique de l'hôte ; aucun CORS permissif ajouté.

## Qualification

Contrats et compilation : thèmes absents/inactifs/incompatibles, exports réels, slots invalides, exposition et dépendances facultatives. Tests SDK : codecs natifs préservés, identité et projection périmées, droits et scopes, D1 réel avec écriture/réponse perdue/reprise/révocation. Le module témoin existant T07 est étendu pour éprouver les vues front et les emplacements sans recopier sa logique métier.

Les recettes navigateur des deux thèmes ont été exécutées sur le Worker compilé, avec le même état D1/R2 synthétique persistant. Le passage standard → ChatGPT-like conserve le compte, la fiche à révision 1 et son brouillon non envoyé. Rechargement, retour navigateur, connexion depuis une vue publique et panneaux fonctionnent. Une réponse PATCH 200 coupée produit un résultat incertain ; après rechargement, la lecture de l'exécution confirme la révision 2 sans seconde écriture. La révocation retire fiches, navigation et slot privés. Le volet compact et le menu mobile sont exercés ; les dimensions mobiles réelles ont été contrôlées par CDP, le simple aperçu redimensionné de l'IAB n'étant pas suffisant.

Deux défauts de recette ont été corrigés : retour vers l'ancienne URL publique après connexion, et panneaux absolus du workspace sans hauteur dans le front. Le raccord CSS du front laisse le panneau actif participer au flux sans modifier le workspace d'administration. Les essais initiaux restent conservés comme échecs ; aucune parité visuelle d'un module produit n'est déduite des fiches synthétiques.

Preuves locales séparées : `CREEZIO-T13-NAVIGATEUR-2026-09-27.json`, captures STANDARD/CHATGPT/MOBILE et empreintes de source/artefacts, hors commit. Contrôles complets, trois revues techniques et CI du candidat et du main réussis. Le harnais refuse un schéma ou état partiel inconnu et n'ouvre ni `.wrangler/state` ni une donnée produit. Ses serveurs et onglets sont arrêtés ; le petit état synthétique est conservé.

Les recettes Sites restent séparées et attendent l'accès au compte. Conversations, fichiers, événements et widgets headless seront raccordés à leurs opérations communes au fil des lots correspondants ; le client actuel ne les simule pas.
