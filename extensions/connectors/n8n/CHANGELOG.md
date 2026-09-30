# Changelog

## 0.2.0 — candidat source non publié

Deuxième coffre pour un Webhook node de production n8n, permission de déclenchement distincte, intention D1 immuable, POST unique corrélé, suivi par ID d’exécution, écran admin/app et deux widgets de lecture seule. Les tests D1 utilisent uniquement un fournisseur simulé ; aucune qualification n8n réelle ni publication n’est revendiquée.

Correctif de qualification : désactiver l’API ou révoquer sa clé désarme le webhook dans le même lot CAS ; le déclenchement relit l’API avant le POST. Les widgets acceptent les enveloppes distinctes du chat interne et de MCP externe, y compris la relecture directe interne sans instance.

## Correctif de configuration — origine et clé

Une origine différente est refusée tant qu’une clé reste scellée, même si la connexion est désactivée. Le changement d’instance exige une révocation locale de la clé, puis une nouvelle origine et une nouvelle clé, avec révisions attendues.

## 0.1.0 — candidat source non publié

Configuration versionnée d’une instance n8n externe avec clé scellée, lecture bornée de métadonnées workflows/exécutions et surfaces UI/API/MCP. La connexion réelle, les mutations distantes, déclenchements et callbacks ne sont pas encore qualifiés.
