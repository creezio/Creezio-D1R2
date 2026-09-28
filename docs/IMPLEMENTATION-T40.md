# T40 — conservation lors des mises à jour

Cette correction applique les exigences existantes REQ-1104/1105 et REQ-1602/1603. Elle ne change ni les priorités ni l’architecture du produit.

## Point de départ vérifié

Lab main `26180ed6c2409ae85944f33b1909e7d076c661aa`, CI 1 165/1 165, adopte le module externe de demandes d’achat 0.1.2. Le même Site B a été mis à jour le 28 septembre 2026 à 09:21 UTC, version 4, environnement 4, source Sites `cd422d6`. Le registre a confirmé cette publication. Docker Linux utilise ce même main dans son volume conservé.

Les lectures natives après mise à jour confirment les comptes, demandes révision 5, fichiers R2 octet exact, messages, deux tours terminés et brouillon conservés. En revanche, deux widgets créés avec le paquet 0.1.0 affichent « Widget indisponible ». Leurs messages persistent ; la projection rejette les anciennes empreintes HTML et d’opération. La mise à jour n’est donc pas entièrement qualifiée.

Une connexion indépendante au MCP applicatif 0.1.2 dans ChatGPT a réussi, avec la seule portée `creezio.purchase-requests:use` dans le contexte Application. Cette portée couvre les huit outils métier, y compris les mutations ; seuls les outils de lecture ont été appelés durant la recette. Les widgets fiche et liste, une lecture directe sans tour IA, la transmission d’une sélection au contexte du tour suivant et l’envoi volontaire d’une proposition ont été observés. Le modèle restitue la sélection distincte, mais les deux identifiants figuraient déjà dans un retour de liste : le test établit le transfert du contexte sans attribuer avec certitude tout le raisonnement à celui-ci. Un picker a nécessité « Réessayer » après un tour ultérieur avant de réafficher ses deux choix. Les deux demandes sont restées à la même révision et au même montant ; le chat natif témoin n’a pas été modifié. Cette preuve ne valide pas les anciens widgets du chat Creezio.

## Cycle durable des plans

La correction candidate ajoute une table d’issues aux plans, sans modifier les tables SQL déjà installées. La confirmation vérifie la composition et le verrou réellement servis avant d’enregistrer l’effet, dans le même batch que la révision conditionnelle. L’annulation exige un motif lorsque la cible n’est pas servie. Le journal distingue acceptation, publication confirmée et annulation ; la lecture d’un plan confirmé reste historique après une mise à jour ultérieure.

Un ancien plan sans événement de confirmation ne devient pas rétroactivement confirmé. Après adoption du correctif, si son ancienne cible diffère du runtime, sa clôture utilise une annulation motivée décrivant cette situation. La preuve externe de sa publication passée reste conservée séparément. Aucun retour à une ancienne version ni publication artificielle n’est nécessaire.

Les 30 tests ciblés du cycle couvrent le CAS D1, les refus de confirmation, l’annulation, la lecture historique, l’acceptation suivante et la conservation d’une commande incertaine. Ils ne constituent pas une recette hébergée du nouveau contrat.

## Widgets historiques

La correction candidate utilise la compatibilité déclarée du widget et le schéma courant pour projeter l’ancien message vers le renderer actuel. Elle ne charge aucun ancien HTML et ne rejoue aucune action. La requête native `widget.render.read` repart du message enregistré et de son exécution liée, avec les droits, l’acteur, la surface et le contexte actuels. Les contrôles des opérations ordinaires restent inchangés. Un résultat absent, incompatible ou inaccessible conserve un repli explicite.

Les contextes conservent la version d’origine du widget. Leurs valeurs sont revalidées avec les champs persistés de l’action courante ; les références locales de schéma gardent leur racine d’origine. Les approbations et commandes incertaines gardent leur journal et ne sont pas relancées sous un nouveau contrat. Les contrôles ciblés historiques et backend passent 13/13, la composition 31/31 et les six suites du module Conversations sont vertes. Le test D1 vérifie séparément les droits et le confinement de la lecture ; la nouvelle requête reste à qualifier de bout en bout sur Lab.

## Qualification restante

- Finaliser les verrous et le contrôle commun, puis revue et CI de la candidate exacte.
- Adopter les corrections dans Lab en conservant module 0.1.2, front, données et ressources existantes.
- Revoir les mêmes anciens messages et widgets, sans recréer leurs tours.
- Qualifier le cycle durable sur un prochain changement réel ; les deux cycles D1 restent une preuve locale distincte.
- Publier Lab dans ses propres ressources Cloudflare et conserver les limites documentées de la recette ChatGPT.

L’évolution de la D1 locale initialisée utilise le même moteur central que les autres publications. Le raccord opérateur `schema:inspect` / `schema:apply` est testé : inspection sous verrou, confirmation du digest exact puis application additive, sans réinstallation du compte et sans script SQL dans les modules. Six contrôles ciblés passent, dont une D1 initialisée conservant son compte et sa ligne témoin pendant l’ajout de `plan-outcomes`. L’application réelle sur Docker Lab reste à faire.

La première CI de cette correction a exécuté 1 172 tests, dont trois échecs : deux inventaires attendus restés aux anciens nombres de tables/outils, et une fixture D1 dépourvue du nouveau validateur de contexte. Les attentes et la fixture sont corrigées sans assouplir la production ; les contrôles schéma et D1 concernés passent. La CI du candidat final reste requise.

Preuves de recette conservées hors dépôt : `CREEZIO-T40-SITES-LAB-POST-012-NATIVE-READONLY`, `CREEZIO-T40-SITES-LAB-012-WIDGET-DIAGNOSTIC`, `CREEZIO-T40-LAB-012-LINUX-ADOPTION` et `CREEZIO-T40-MODULE-PLAN-CYCLE-SOL-LOCAL`, datées du 28 septembre 2026. Aucune de ces preuves n’annonce déjà le déploiement des corrections T40.
