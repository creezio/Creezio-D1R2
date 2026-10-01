# Reste à qualifier et développer

- Vérifier dans le navigateur Original les trois panneaux, deux boîtes, recherche, fil, bascule d’onglets, brouillon repris et pièce jointe privée, avec conservation après actualisation.
- Qualifier dans le navigateur la restauration du panneau après authentification et la lecture de statut d'une commande incertaine, sans second envoi.
- Le bridge hôte, l’émission Resend simulée, la projection atomique, la revalidation fraîche et la reprise sans rejeu sont couverts localement. Qualifier l’envoi réel, la réception, les accusés et la réconciliation sur fournisseur réel, sans serveur IMAP/SMTP résident.
- L’envoi de 50 pièces privées R2 / 10 Mio cumulés est couvert localement. Qualifier le nouveau port hôte borné d’ingestion R2 des pièces entrantes sur fournisseur réel et en navigateur.
- Vérifier en navigateur une pièce jointe sur message reçu et sa lecture protégée ; les tests synthétiques D1/R2 couvrent la publication atomique et les liens privés.
- Qualifier la parité des commandes de corbeille et de suppression définitive sur données et fichiers ; la suppression définitive d’un message n’est pas exposée dans l’écran actuel.
- Vérifier l’éditeur riche natif et les liens HTML dans les navigateurs cibles. Les liens ne doivent garder que des URL HTTP(S) assainies.
- Qualifier les trois widgets de lecture sur ChatGPT réel : boîtes, pagination messages/brouillons, refus et reprise du détail, avec boîtes communes admin/app.
- Ne pas déclarer les critères REQ-1801 de transport ni la compatibilité ChatGPT réelle acquis avant les recettes correspondantes.
