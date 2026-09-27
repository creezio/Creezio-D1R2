# Consentement OAuth Creezio

`consent.ts` lit une prévisualisation de transaction conservée par le service OAuth. Le SDK ne choisit ni client, ni redirection, ni droits. Il vérifie uniquement la forme bornée des données avant de les remettre à `AccessOAuthConsentView` (`extensions/native/access/ui/consent.tsx`).

L’hôte monte cette vue sur `/oauth/consent/[transactionId]`. La vue lit `/oauth/consent/{id}/preview`, affiche le compte natif vérifié, le contexte exact et les permissions permises par le serveur. La connexion utilise `NativeAccessPanel` pour l’audience annoncée par le service. Le formulaire soumet `decision`, `csrfToken` et les `permissionIds` cochées à `/oauth/consent/{id}`. Le service revalide la session, les droits et le jeton CSRF, puis construit seul la réponse OAuth et sa redirection.

Les portées OAuth affichées correspondent aux identifiants de permissions demandés. Les cases à cocher limitent le plafond consenti ; elles ne peuvent pas créer un droit absent de la prévisualisation. Le client ne conserve pas le consentement et ne traite pas les codes ou jetons OAuth.
