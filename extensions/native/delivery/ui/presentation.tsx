'use client';

import {Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle} from '@creezio/sdk/ui';
import type {DeliveryStepStatus, DeliveryViewModel} from '../../../../sdk/delivery/types.ts';
import type {DeliveryUpdateViewModel} from '../../../../sdk/delivery/update-view-model.ts';

export interface DeliveryOverviewProps {
  readonly model: DeliveryViewModel;
  readonly busy?: boolean;
  readonly onConfigure: () => void;
  readonly onPrepare: () => void;
  readonly onStart: () => void;
  readonly onRefresh: () => void;
  readonly onReconcile: () => void;
}

const stepLabel: Record<DeliveryStepStatus, string> = {
  waiting: 'À venir', current: 'En cours', done: 'Terminé', attention: 'À vérifier',
};
const stepVariant: Record<DeliveryStepStatus, 'muted' | 'info' | 'success' | 'warning'> = {
  waiting: 'muted', current: 'info', done: 'success', attention: 'warning',
};

/** Native workspace content. The controller supplies actions and validated, non-secret state. */
export function DeliveryOverview({model, busy = false, onConfigure, onPrepare, onStart,
  onRefresh, onReconcile}: DeliveryOverviewProps) {
  return <div className="space-y-4 p-6">
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="text-lg font-semibold">Livraison Cloudflare</h1>
      <Badge variant="outline">{model.profileLabel}</Badge>
      <Button size="sm" variant="outline" className="ml-auto" disabled={busy || !model.canRefresh}
        onClick={onRefresh}>{model.connection === 'connected' ? 'Actualiser' : 'Réessayer la connexion'}</Button>
    </div>
    <Card><CardHeader><CardTitle className="text-base">{model.headline}</CardTitle>
      <CardDescription>{model.connectionLabel}</CardDescription></CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-700">
        <p>{model.detail}</p>
        {model.transferId && <p>Transfert <code className="break-all rounded bg-slate-100 px-1 py-0.5">{model.transferId}</code></p>}
        {model.transferId && model.canConfigure && <Button size="sm" variant="outline" disabled={busy} onClick={onConfigure}>
          Ressaisir le jeton de cette cible</Button>}
        {model.canReconcile && <Button size="sm" variant="outline" disabled={busy} onClick={onReconcile}>
          Vérifier ce transfert</Button>}
      </CardContent></Card>
    {model.showCaptureNotice && <div role="note" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <strong>Interruption locale prévue.</strong> Le runtime Docker local s’arrête pendant la capture, la compilation
      et le transfert. Gardez cet onglet ouvert pour suivre le service opérateur. Après un rechargement, revenez
      une fois le runtime redémarré pour vérifier le même transfert.
    </div>}
    {!model.transferId && <Card><CardHeader><CardTitle className="text-base">Préparation</CardTitle>
      <CardDescription>Un seul profil est disponible pour cette livraison.</CardDescription></CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || !model.canConfigure} onClick={onConfigure}>Configurer la cible</Button>
        <Button size="sm" variant="outline" disabled={busy || !model.canPrepare} onClick={onPrepare}>Préparer</Button>
        <Button size="sm" disabled={busy || !model.canStart} onClick={onStart}>Lancer la livraison</Button>
      </CardContent></Card>}
    {model.transferId && <Card><CardHeader><CardTitle className="text-base">Progression</CardTitle>
      <CardDescription>Étapes du transfert identifié, sans estimation de pourcentage.</CardDescription></CardHeader>
      <CardContent><ol className="space-y-2">
        {model.steps.map(step => <li key={step.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-0"
          aria-current={step.status === 'current' ? 'step' : undefined}>
          <span>{step.label}</span><Badge variant={stepVariant[step.status]}>{stepLabel[step.status]}</Badge>
        </li>)}
      </ol></CardContent></Card>}
  </div>;
}

export function DeliveryUpdateOverview({model, busy = false, onPrepare, onStart,
  onRefresh, onReconcile, onConfigure}: Omit<DeliveryOverviewProps, 'model'> & {
    readonly model: DeliveryUpdateViewModel;
  }) {
  return <div className="space-y-4 p-6">
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="text-lg font-semibold">Livraison Cloudflare</h1>
      <Badge variant="outline">Docker local</Badge>
      <Button size="sm" variant="outline" className="ml-auto" disabled={busy || !model.canRefresh}
        onClick={onRefresh}>Actualiser</Button>
    </div>
    <Card><CardHeader><CardTitle className="text-base">{model.headline}</CardTitle>
      <CardDescription>Mise à jour du Worker existant</CardDescription></CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-700">
        <p>{model.detail}</p>
        {model.updateId && <p>Mise à jour <code className="break-all rounded bg-slate-100 px-1 py-0.5">{model.updateId}</code></p>}
        {model.canConfigure && <Button size="sm" variant="outline" disabled={busy}
          onClick={onConfigure}>Ressaisir le jeton de cette cible</Button>}
        {model.canReconcile && <Button size="sm" variant="outline" disabled={busy}
          onClick={onReconcile}>Vérifier cette mise à jour</Button>}
      </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Plan explicite</CardTitle>
      <CardDescription>La mise à jour conserve les données D1/R2 et les secrets de la cible.</CardDescription></CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || !model.canPrepare}
          onClick={onPrepare}>Préparer la mise à jour</Button>
        <Button size="sm" disabled={busy || !model.canStart}
          onClick={onStart}>Lancer la mise à jour</Button>
      </CardContent></Card>
    {model.updateId && <Card><CardHeader><CardTitle className="text-base">Progression</CardTitle>
      <CardDescription>Étapes de cette mise à jour identifiée, sans estimation de pourcentage.</CardDescription></CardHeader>
      <CardContent><ol className="space-y-2">
        {model.steps.map(step => <li key={step.id}
          className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-0"
          aria-current={step.status === 'current' ? 'step' : undefined}>
          <span>{step.label}</span><Badge variant={stepVariant[step.status]}>{stepLabel[step.status]}</Badge>
        </li>)}
      </ol></CardContent></Card>}
  </div>;
}
