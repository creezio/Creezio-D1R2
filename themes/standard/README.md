# Thème front standard Creezio

Ce module fournit la présentation front standard de l'application. Il reprend la palette crème et encre du système visuel Creezio et les primitives publiques du SDK. L'hôte fournit les vues, la navigation et les emplacements autorisés ; le thème ne lit aucun droit ni donnée métier par lui-même.

Le choix de composition est `front: {kind: "theme", moduleId: "creezio.theme-standard", theme: "standard"}` après sélection et verrouillage du module. Les emplacements pris en charge sont `front.header`, `front.sidebar`, `front.context` et `front.footer`. Un module sans vue front n'ajoute aucun écran ici. Le workspace d'administration reste indépendant.

Les commandes Se connecter, Se déconnecter et Actualiser appellent uniquement les fonctions fournies par l'hôte natif. Le module ne crée ni session, ni chat, ni opération serveur. Les conversations réelles relèvent de T14/T15.

Sources de présentation : `packages/shell-ui/ui/theme/theme.css` et primitives de `packages/shell-ui/ui/primitives/` dans le Creezio original, adaptées aux composants publics `sdk/ui/` du socle. La landing publique d'origine est une contribution spécifique, non la page universelle du thème.

Vérification locale : `node themes/standard/gate.mjs`. Les six suites déclarées contrôlent aussi explicitement les capacités absentes ; cette commande ne prouve pas une session ni une recette navigateur.
