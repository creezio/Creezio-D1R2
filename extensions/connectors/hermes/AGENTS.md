# Consignes du module Hermes

Respecter `docs/STANDARD-MODULE.md` et `docs/connectors/T29-HERMES.md`. Toute requête distante passe par le port connecteur déclaré ; jamais de `fetch` libre ni de clé visible dans un handler/UI. Conserver les six suites et leurs limites réelles. Ne pas lancer Hermes localement ni supposer qu’une capacité annoncée par la documentation est activée sur l’instance cible. Les mutations inconnues ne sont pas rejouées ; l’approbation POST reste différée jusqu’à une fixture vérifiée.
