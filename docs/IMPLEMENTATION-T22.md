# T22 — Analytics et diagnostics

`creezio.analytics` conserve les six onglets, indicateurs, graphiques et listes de l'interface originale. Cette tranche exploite uniquement les événements explicitement enregistrés par les opérations Creezio. Elle ne présente pas de mesures fictives en l'absence d'événements.

Un modèle D1 partagé par contexte alimente enregistrement, liste, agrégats et export. L'émission peut être autorisée à une identité applicative ou machine ; lecture et export restent réservés au droit de consultation admin. Pagination, intervalle et taille sont bornés. Un agrégat partiel indique sa borne au lieu de présenter un total exhaustif. Un changement de filtre invalide les réponses de liste et d'export précédentes ; les filtres survivent à une vérification transitoire de la même session.

Les six suites du module passent 13 contrôles, avec absence de widget visuel déclarée. L'intégration D1 réelle vérifie 520 événements, pagination, agrégat limité, idempotence et droits entre audiences. Sur le profil Linux à 13 modules du candidat `589a827`, un événement `activity` a été déclaré par l'API native, confirmé puis relu. La vue admin l'a affiché pour la semaine : un principal, zéro page vue et zéro clic. Cela qualifie le navigateur sur cette donnée explicitement signalée ; aucune recette hébergée n'est acquise.

Instrumentation automatique des autres modules, lecture des journaux techniques de l'hôte, inventaire des endpoints et mesures de productivité restent ouverts. Les mesures dépendantes de Work attendent T17. Aucune lecture directe des tables privées des comptes, opérations ou tâches ne contourne leurs ports publics.
