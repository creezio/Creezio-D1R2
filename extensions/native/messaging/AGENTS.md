# Travail dans le module Messaging

Le module natif appartient au lot T-18 et à REQ-1801. Garder les opérations, droits, modèles, écran workspace et projection MCP alignés. Ne jamais déduire un droit du panneau affiché : toute lecture ou mutation passe par l’exécuteur autorisé avec contexte, audience et révision.

Préserver les boîtes, brouillons, messages et références R2 lors d’une mise à jour. Ne pas importer SQLite, IMAP, SMTP, serveur persistant ou scripts de migration du Creezio historique. Reprendre l’interface originale seulement à travers les ports du SDK et le déploiement serverless actuel. La mention d’une adresse de boîte ne prouve ni réception ni envoi.

Exécuter les six suites ciblées du module et documenter les limites réellement observées. Un résultat incertain d’une mutation ne déclenche aucun rejeu automatique. Le HTML reste assaini et isolé dans le lecteur ; aucune clé fournisseur ni contenu privé n’entre dans le widget ou les journaux publics.
