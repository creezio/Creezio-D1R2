# Décisions T15

La configuration est propre au contexte et ne transporte qu'une référence opaque de clé. Le pont hôte est seul responsable de l'outbox, des droits frais, de l'exécution des outils et de la progression D1. Responses utilise `background:true`, `stream:true`, `store:false`, avec réponse incertaine conservée comme telle si l'identifiant fournisseur manque. Le modèle doit provenir de la configuration validée, pas d'une liste statique.
