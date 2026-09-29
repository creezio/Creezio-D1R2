# Facturation Stripe projetée

Le connecteur lit des pages Stripe autorisées et conserve une projection locale bornée. Pour connaître la portée d'un résultat, lire d'abord `stripe_sync_state` : `partial` signifie que le parcours n'est pas terminé et `pages_exhausted` signifie seulement que sa dernière page a été atteinte. Les outils de lecture `stripe_customer_list`, `stripe_subscription_list` et `stripe_invoice_list` retournent des pages de cette projection contextuelle, sans carte Stripe brute.

Ne pas décrire ces données comme un MRR fiable ni comme un paiement confirmé. Le widget affiche l'état des parcours ; aucun Checkout, webhook, paiement ou mutation distante Stripe n'est fourni dans cette tranche. La configuration et la synchronisation manuelle exigent la permission administrative `stripe.manage` et une clé conservée par le coffre de l'hôte.
