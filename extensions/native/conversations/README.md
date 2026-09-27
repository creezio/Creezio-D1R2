# Conversations natives

Le module fournit des conversations Chat et Work, messages, brouillons durables, historique, recherche paginée, archives, événements de progression et pièces jointes privées. Les mêmes opérations servent le workspace et le front avec une session ou un OAuth propre à l’audience. Le SDK `sdk/conversations` conserve l’état du panneau pendant la navigation et relit une mutation incertaine par sa clé sans la rejouer.

Les lignes D1 portent le contexte, le propriétaire et l’audience. Les messages, brouillons, tours, événements et liens de fichiers référencent la conversation par une clé composite. Le port fichiers de l’hôte vérifie D1 et R2 puis fournit un plan de publication dans le même batch que le lien métier. Les opérations ne reçoivent ni clé d’objet R2 ni droit SQL.

Sans fournisseur activé, le détail renvoie `no_provider` et l’interface l’annonce. Aucun texte assistant n’est inventé. L’adaptateur OpenAI réel appartient à T15 ; les widgets et le pont ChatGPT à T16. Les suites du module se lancent avec `node gate.mjs`. Les recettes navigateur local et Sites restent distinctes de cette validation de contrat.
