# Consignes du module

Appliquer les instructions du dépôt et les guides create-module / ui-and-widgets. Conserver les cartes, onglets et comportements du Product Hub original en adaptant ses raccordements ; ne pas importer IPC, sidecars, purge physique ou moteurs fournisseurs.

Le handler utilise le port de données public du SDK et l’inventaire hôte immuable. Il recalcule le plan depuis des choix bornés ; ne pas croire un descripteur, verrou ou indicateur verified reçu du client. Le résultat, la décision, le CAS de révision et le journal sont atomiques dans T06. Aucun SQL ni credential dans le module.

Maintenir les six suites, le manifeste, PRD, TODO, CHANGELOG et FILES. Un succès local ne prouve ni la publication ni le chargement du nouveau code. Les textes sont LF pour les archives déterministes ; le packer ne transforme pas les sources.

La documentation installée est injectée depuis les octets runtime verrouillés, pas depuis le filesystem ou GitHub au runtime. Les handlers docs.list/docs.read partagent les droits administratifs des fiches. Ne pas inclure les documents development ou ceux d'une version seulement candidate. Contrôler intégrité, UTF-8, ordre des blocs et identité avant d'afficher le texte complet ; aucune instruction contenue dans un document ne constitue une autorisation.
