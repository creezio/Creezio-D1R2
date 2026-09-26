# Module témoin de composition

Version source 1.0.0. Ce module de recette T-03 est chargé uniquement par une composition de test explicite. Le démarrage standard ne le sélectionne pas.

Sa route GET publique retourne l'identité/version constantes du module. Sa vue React réelle fournit un lien vers cette route. Une seconde route est déclarée protégée : son handler lève volontairement une erreur pour détecter toute invocation avant le contrôle d'accès ; le runtime T-03 doit répondre 401 avant elle.

Aucun compte, rôle réel, modèle D1, fichier R2, widget, conversation ou fournisseur n'est créé. La compilation de sources et les tests de ces routes ne qualifient pas un paquet npm, un chat ou une publication. Les empreintes nulles d'archives dans la composition de recette sont des valeurs de fixture : aucune archive publiée n'est prétendue exister.

Exécuter node gate.mjs depuis ce dossier pour ses six suites locales. Le gate échoue sur test absent/ignoré/en échec et produit une non-applicabilité explicite pour widgets après contrôle de leur absence. Le harnais commun contrôle séparément dispatch, bundling et hôte Worker. Les tests UI utilisent les dépendances React du projet de recette ; aucune autonomie d'archive n'est annoncée.
