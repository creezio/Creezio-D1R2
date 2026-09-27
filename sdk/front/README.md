# SDK du front

Le front facultatif partage les opérations et comptes de Creezio. [Réalisation T13](../../docs/IMPLEMENTATION-T13.md) décrit le périmètre et les recettes restantes.

- `types.ts` : contrat du thème, branding, projection autorisée et props publiques sans identité.
- `headless.ts` : client externe pour les bindings `app` acceptant un jeton API ou OAuth. Il partage les codecs de `sdk/operations`, n'envoie pas de cookie et ne crée pas de session fictive.
- `navigation.ts` : synchronisation des panneaux avec l'URL courante sans rejouer une ancienne destination après connexion ou retour navigateur.
- `app/front/` : raccord au navigateur et aux routes du runtime. Les thèmes ne réimplémentent pas ces gardes.

Le thème reçoit `children`, la navigation et `renderSlot`. Il n'a pas à coder une route pour chaque module. Les deux thèmes fournis acceptent `front.header`, `front.sidebar`, `front.context` et `front.footer`, dans l'ordre des contributions. Une vue protégée reste servie avec la session native app ; une vue publique reçoit seulement ses entrées, sa localisation et la navigation.

Le client headless exige une origine HTTPS explicite (HTTP réservé au local), des bindings issus de la composition et une fonction `credential` qui lit le coffre de son appelant. Une clé d'application reste côté serveur, jamais dans le bundle du front. Le serveur vérifie l'audience, le contexte et les droits à chaque appel. Le client ne rend pas possible une requête cross-origin interdite par l'hôte.

`invoke` retourne une exécution, un refus certain, ou un résultat inconnu. Après une réponse perdue, `status` relit l'exécution ou sa clé d'idempotence sans renvoyer le corps de mutation. Une lecture absente n'est pas une preuve d'annulation ; `execution_not_observed` reste incertain. Les réponses d'une ancienne identité ou projection ne sont pas réintroduites dans la vue courante.
