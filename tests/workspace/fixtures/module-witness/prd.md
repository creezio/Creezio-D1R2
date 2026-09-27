# PRD de la fixture workspace

Objectif T-07 : vérifier que deux instances de la même vue conservent leurs brouillons, historique, sous-vues et activité sans mélanger les identités. L'accueil épinglé ouvre `alpha` et `beta`. Les vues inactives sont inertes ; la reprise d'une vérification de session préserve les panneaux masqués, tandis qu'une révocation retire les vues interdites.

Chaque fiche lit réellement le modèle D1 par `read_record` et peut renommer via `rename_record` avec version comparée et clé d'idempotence. Les handlers utilisent uniquement le DataPort. Le navigateur ne déduit aucun droit de la session ; la projection de droits détermine l'affichage et le moteur revérifie chaque opération.

La fixture source 1.0.0 n'est ni un module produit ni une preuve hébergée. L'état incertain impose une vérification explicite, sans nouveau claim automatique.

T13 réutilise ces mêmes modèles, opérations et vues dans les thèmes standard et ChatGPT-like. Les surfaces front sont déclarées dans le manifeste ; deux présentations sans logique métier vérifient une route publique et les slots public/privé. Le changement de thème doit conserver les objets D1 et les personnalisations de l'application. Aucun enregistrement de route dans un thème n'est nécessaire.
