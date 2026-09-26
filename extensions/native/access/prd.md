# PRD — comptes et accès natifs

Version de travail 0.0.0 liée à [T-04](../../../docs/TODO.md#T-04), [REQ-0401](../../../docs/EXIGENCES.md#REQ-0401) et [REQ-0402](../../../docs/EXIGENCES.md#REQ-0402). Ce PRD décrit le module cible ; le TODO distingue réalisation et qualification.

Un responsable initialise explicitement le premier compte de son application. Les personnes utilisent une connexion native et leurs sessions révocables ; les droits du workspace restent distincts des pouvoirs d'administration. Un jeton d'API ou une délégation OAuth conserve des limites propres et ne remplace pas une validation humaine.

Critères de la tranche présente : une seule installation consommable malgré la concurrence ; aucune écriture après échec du claim ; refus de session après modification/révocation concurrente ; empreintes et PHC privés ; limitation des tentatives avant KDF ; contraintes et dérive du schéma contrôlées dans une vraie D1.

La cible inclut comptes actifs/inactifs, invitations, activation/reset à usage unique, rôles/héritage/exceptions, comptes de service, gestion des tokens, impersonation auditée, vues natives et fronts autorisés. Le plugin conversationnel utilise les mêmes opérations sans accès direct aux données ni aux secrets. OAuth complet se qualifie en T-10. Aucun de ces parcours restants n'est réputé livré par la seule persistance.
