'use client';

import {useCallback, useEffect, useRef, useState, type ChangeEvent} from 'react';
import {Badge, Button, Card, CardContent, CardHeader, CardTitle} from '@creezio/sdk/ui';
import {useRegisterWorkspaceMetadata} from '@creezio/sdk/workspace/metadata';
import {useDeliveryTransport} from '@creezio/sdk/delivery/context';
import type {RuntimeViewProps} from '../../../../sdk/runtime/ui.ts';
import {createDeliveryController, deliveryViewInput, type DeliveryController,
  type DeliverySnapshot} from '../../../../sdk/delivery/controller.ts';
import {deliveryViewModel} from '../../../../sdk/delivery/view-model.ts';
import {createDeliveryUpdateController, type DeliveryUpdateController,
  type DeliveryUpdateSnapshot} from '../../../../sdk/delivery/update-controller.ts';
import {deliveryUpdateViewModel} from '../../../../sdk/delivery/update-view-model.ts';
import type {DeliveryConfigureInput, DeliverySecretSelection, DeliveryTarget,
  DeliveryTransport} from '../../../../sdk/delivery/transport.ts';
import {deliveryPersistence, deliveryUpdatePersistence} from './persistence.ts';
import {DeliveryOverview, DeliveryUpdateOverview} from './presentation.tsx';

const empty: DeliverySnapshot = {authorized: false, identityVersion: 0, busy: false,
  connection: 'reconnecting', inspection: null, prepared: null, transfer: null, saved: null, error: null};
const emptyUpdate: DeliveryUpdateSnapshot = {authorized: false, identityVersion: 0, busy: false,
  connection: 'reconnecting', inspection: null, prepared: null, update: null, saved: null, error: null};
const blankTarget: DeliveryTarget = {accountId: '', workerName: ''};
const fieldLabels: Record<keyof DeliveryTarget, string> = {
  accountId: 'Identifiant du compte Cloudflare', workerName: 'Nom du Worker',
};
function errorMessage(code: string | null) {
  if (!code) return '';
  if (code === 'unauthorized' || code === 'forbidden') return 'Accès à la livraison refusé. Actualisez votre session.';
  if (code === 'not_ready') return 'La configuration ou la préparation doit être vérifiée avant cette étape.';
  if (code === 'transfer_in_progress') return 'Un transfert identifié est déjà en cours. Vérifiez-le avant toute modification.';
  if (code === 'transfer_conflict') return 'Le service local suit un autre transfert. Vérifiez son identifiant avant de continuer.';
  if (code === 'connection_changed') return 'Le jeton ne correspond pas au transfert préparé. Ressaisissez le jeton de cette cible.';
  if (code === 'provision_unknown') return 'La préparation n’est pas confirmée. Actualisez puis relancez Préparer pour la même cible.';
  if (code === 'registry_registration_required') return 'Inscrivez cette installation au registre Creezio avant de préparer la publication.';
  if (code === 'persistence_unavailable') return 'La reprise du transfert est indisponible dans cet onglet.';
  if (code === 'invalid_response') return 'La réponse du service local est invalide. Vérifiez le transfert existant.';
  if (code === 'outcome_unknown') return 'Le résultat est incertain. Vérifiez le même transfert.';
  if (code === 'in_flight') return 'Une opération est déjà en cours.';
  if (code === 'update_not_ready') return 'La publication courante ou le plan de mise à jour doit être vérifié.';
  if (code === 'update_in_progress' || code === 'update_conflict') return 'Une autre mise à jour est suivie par le service local. Vérifiez son identifiant.';
  if (['source_changed','plan_changed','registry_changed','target_changed','deployment_changed',
    'artifact_changed','schema_unavailable'].includes(code))
    return 'Le plan ne correspond plus à la source ou à la cible. Actualisez avant de continuer.';
  if (code === 'delivery_unknown') return 'La publication doit être vérifiée pour cette même mise à jour.';
  return 'Le service local est indisponible. Réessayez ou vérifiez le transfert identifié.';
}

/** The native host injects a permission-bound operator transport through the SDK context. */
export function DeliveryAdminView(props: RuntimeViewProps) {
  useRegisterWorkspaceMetadata(props.panelId, {title: 'Livraison', kind: 'section', trail: [{label: 'Livraison'}]});
  const transport = useDeliveryTransport() as DeliveryTransport | null;
  const liveController = useRef<DeliveryController | null>(null);
  const liveUpdateController = useRef<DeliveryUpdateController | null>(null);
  const [binding, setBinding] = useState<{controller: DeliveryController; snapshot: DeliverySnapshot} | null>(null);
  const [updateBinding, setUpdateBinding] = useState<{
    controller: DeliveryUpdateController; snapshot: DeliveryUpdateSnapshot} | null>(null);
  const [target, setTarget] = useState<DeliveryTarget>(blankTarget);
  const [apiToken, setApiToken] = useState('');
  const [rewrap, setRewrap] = useState<readonly string[]>([]);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!transport) {liveController.current = null; setBinding(null); return;}
    const controller = createDeliveryController({transport, access: props.access,
      persistence: deliveryPersistence(props.navigation)});
    liveController.current = controller;
    let live = true;
    const publish = () => {if (live) setBinding({controller, snapshot: controller.getSnapshot()});};
    const unsubscribe = controller.subscribe(publish);
    publish();
    return () => {live = false; unsubscribe(); controller.dispose();
      if (liveController.current === controller) liveController.current = null;};
  }, [transport, props.access, props.navigation]);
  useEffect(() => {
    if (!transport) {liveUpdateController.current = null; setUpdateBinding(null); return;}
    const controller = createDeliveryUpdateController({transport, access: props.access,
      persistence: deliveryUpdatePersistence(props.navigation)});
    liveUpdateController.current = controller;
    let live = true;
    const publish = () => {if (live) setUpdateBinding({controller, snapshot: controller.getSnapshot()});};
    const unsubscribe = controller.subscribe(publish);
    publish();
    return () => {live = false; unsubscribe(); controller.dispose();
      if (liveUpdateController.current === controller) liveUpdateController.current = null;};
  }, [transport, props.access, props.navigation]);
  const current = binding?.controller === liveController.current ? binding : null;
  const controller = current?.controller ?? null, snapshot = current?.snapshot ?? empty;
  const currentUpdate = updateBinding?.controller === liveUpdateController.current ? updateBinding : null;
  const updateController = currentUpdate?.controller ?? null;
  const updateSnapshot = currentUpdate?.snapshot ?? emptyUpdate;
  const enabled = !!controller && props.active && props.authorized && snapshot.authorized;
  const fixedTarget = !!snapshot.saved || !!snapshot.inspection?.activeTransferId
    || !!updateSnapshot.saved || !!updateSnapshot.inspection?.activeUpdateId;
  const identityVersion = snapshot.identityVersion;
  const refresh = useCallback(async () => {
    if (!controller || !enabled) return;
    const inspected = await controller.inspect();
    if (inspected.ok && inspected.value.hostProfile === 'docker-local'
      && (inspected.value.activeTransferId || controller.getSnapshot().saved)) await controller.status();
  }, [controller, enabled]);
  const refreshUpdate = useCallback(async () => {
    if (!updateController || !enabled) return;
    const inspected = await updateController.inspect();
    if (inspected.ok && (inspected.value.activeUpdateId || updateController.getSnapshot().saved))
      await updateController.status();
  }, [updateController, enabled]);
  useEffect(() => {if (enabled) void refresh();}, [enabled, identityVersion, refresh]);
  useEffect(() => {if (enabled) void refreshUpdate();}, [enabled, identityVersion, refreshUpdate]);
  useEffect(() => {
    if (!enabled || !controller || (!snapshot.saved?.started && !snapshot.transfer)
      || snapshot.transfer?.phase === 'delivered') return;
    const timer = window.setInterval(() => {void controller.status();}, 5000);
    return () => window.clearInterval(timer);
  }, [enabled, controller, snapshot.saved?.started, snapshot.transfer?.phase]);
  useEffect(() => {
    if (!enabled || !updateController || (!updateSnapshot.saved?.started && !updateSnapshot.update)
      || updateSnapshot.update?.phase === 'delivered') return;
    const timer = window.setInterval(() => {void updateController.status();}, 5000);
    return () => window.clearInterval(timer);
  }, [enabled, updateController, updateSnapshot.saved?.started, updateSnapshot.update?.phase]);
  useEffect(() => {setApiToken(''); setRewrap([]); setEditing(false); setNotice('');}, [identityVersion, props.authorized]);
  useEffect(() => {setTarget(blankTarget);}, [identityVersion]);
  useEffect(() => {
    const publishedTarget = snapshot.inspection?.target ?? updateSnapshot.inspection?.target;
    if (publishedTarget && (!editing || fixedTarget)) setTarget(publishedTarget);
  }, [editing, fixedTarget, snapshot.inspection?.target, updateSnapshot.inspection?.target]);
  const model = deliveryViewModel(deliveryViewInput(snapshot));
  const updateModel = deliveryUpdateViewModel(updateSnapshot);
  const showUpdate = !!(updateSnapshot.saved || updateSnapshot.inspection?.activeUpdateId
    || updateSnapshot.inspection?.currentPublicationId);
  function update(field: keyof DeliveryTarget) {
    return (event: ChangeEvent<HTMLInputElement>) => setTarget(previous => ({...previous, [field]: event.target.value}));
  }
  async function configure() {
    if (!controller || !enabled || !apiToken) return;
    const input: DeliveryConfigureInput = {target: fixedTarget
      ? snapshot.inspection?.target ?? updateSnapshot.inspection?.target ?? target : target,
      credentials: {apiToken}};
    const result = await controller.configure(input);
    if (result.ok) {setApiToken(''); setEditing(false); setNotice('Configuration enregistrée sans restituer le jeton.');
      void refreshUpdate();}
  }
  function prepare() {
    if (!controller || !enabled) return;
    const secretSelections: DeliverySecretSelection[] = (snapshot.inspection?.secretConnections ?? []).map(connection => ({
      contextId: connection.contextId, reference: connection.reference, bindingId: connection.bindingId,
      mode: rewrap.includes(`${connection.contextId}:${connection.reference}:${connection.bindingId}`) ? 'rewrap' : 'disable',
    }));
    void controller.prepare({secretSelections});
  }
  if (!transport) return <p role="status" className="p-6 text-sm text-slate-600">
    La livraison est disponible uniquement depuis l’administration du profil Docker local.</p>;
  if (!controller) return <p className="p-6 text-sm text-slate-500">Connexion au service local…</p>;
  if (!enabled) return <p className="p-6 text-sm text-slate-500">Accès à la livraison indisponible pour cette session.</p>;
  if (snapshot.inspection?.hostProfile === 'other') return <p role="status" className="p-6 text-sm text-slate-600">
    La livraison depuis cet hébergement n’est pas disponible. Ouvrez l’administration du profil Docker local.</p>;
  if (showUpdate) return <>
    <DeliveryUpdateOverview model={updateModel} busy={updateSnapshot.busy}
      onConfigure={() => setEditing(true)}
      onPrepare={() => {void updateController?.prepare();}}
      onStart={() => {void updateController?.start();}}
      onRefresh={() => {void refreshUpdate();}}
      onReconcile={() => {void updateController?.reconcile();}} />
    {updateSnapshot.error && <p role="alert" className="mx-6 mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {errorMessage(updateSnapshot.error)}</p>}
    {notice && <p role="status" className="mx-6 mb-4 text-sm text-emerald-800">{notice}</p>}
    {editing && <Card className="mx-6 mb-6"><CardHeader><CardTitle className="text-base">Cible Cloudflare</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {Object.keys(fieldLabels).map(key => <label key={key} className="block space-y-1 text-sm">
          <span>{fieldLabels[key as keyof DeliveryTarget]}</span>
          <input className="h-9 w-full rounded-md border border-slate-300 px-3" required disabled
            value={target[key as keyof DeliveryTarget]} onChange={update(key as keyof DeliveryTarget)} />
        </label>)}
        <label className="block space-y-1 text-sm"><span>Jeton Cloudflare</span>
          <input type="password" autoComplete="off" className="h-9 w-full rounded-md border border-slate-300 px-3"
            required value={apiToken} onChange={event => setApiToken(event.target.value)} /></label>
        <p className="text-xs text-slate-600">Le jeton de cette cible est transmis une fois à l’opérateur local et n’est pas conservé dans cet écran.</p>
        <div className="flex gap-2"><Button size="sm" disabled={snapshot.busy || !apiToken
          || Object.values(target).some(value => !value.trim())} onClick={() => void configure()}>Enregistrer</Button>
          <Button size="sm" variant="outline" onClick={() => {setEditing(false);setApiToken('');}}>Annuler</Button></div>
      </CardContent></Card>}
    {updateSnapshot.prepared && <Card className="mx-6 mb-6"><CardHeader>
      <CardTitle className="text-base">Plan préparé</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm"><p>{updateSnapshot.prepared.summary.title}</p>
        <p>Mise à jour <code>{updateSnapshot.prepared.updateId}</code> · plan <code>{updateSnapshot.prepared.planDigest}</code></p>
        <ul className="list-inside list-disc">{updateSnapshot.prepared.summary.details.map((line,index) => <li key={index}>{line}</li>)}</ul>
        {updateSnapshot.prepared.summary.warnings.map((line,index) => <p key={index} className="text-amber-800">{line}</p>)}
        <Badge variant="info">Données et secrets conservés</Badge>
      </CardContent></Card>}
    {updateSnapshot.update?.finalUrl && /^https:\/\//.test(updateSnapshot.update.finalUrl)
      && <p className="mx-6 mb-6 text-sm">Adresse publiée : <a className="text-sky-700 underline"
        href={updateSnapshot.update.finalUrl} target="_blank" rel="noopener noreferrer">{updateSnapshot.update.finalUrl}</a>
        {' '}· registre {updateSnapshot.update.registryStatus === 'effective' ? 'effectif' : 'à vérifier'}</p>}
  </>;
  return <>
    <DeliveryOverview model={model} busy={snapshot.busy} onConfigure={() => setEditing(true)}
      onPrepare={prepare} onStart={() => {void controller.start();}}
      onRefresh={() => {void refresh();}} onReconcile={() => {void controller.reconcile();}} />
    {snapshot.error && <p role="alert" className="mx-6 mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {errorMessage(snapshot.error)}</p>}
    {notice && <p role="status" className="mx-6 mb-4 text-sm text-emerald-800">{notice}</p>}
    {editing && <Card className="mx-6 mb-6"><CardHeader><CardTitle className="text-base">Cible Cloudflare</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {Object.keys(fieldLabels).map(key => <label key={key} className="block space-y-1 text-sm">
          <span>{fieldLabels[key as keyof DeliveryTarget]}</span>
          <input className="h-9 w-full rounded-md border border-slate-300 px-3" required disabled={fixedTarget}
            value={target[key as keyof DeliveryTarget]} onChange={update(key as keyof DeliveryTarget)} />
        </label>)}
        <label className="block space-y-1 text-sm"><span>Jeton Cloudflare</span>
          <input type="password" autoComplete="off" className="h-9 w-full rounded-md border border-slate-300 px-3"
            required value={apiToken} onChange={event => setApiToken(event.target.value)} /></label>
        <p className="text-xs text-slate-600">Le service local crée les ressources D1/R2 et détermine l’adresse publique. Le jeton n’est pas conservé dans cet écran.</p>
        <div className="flex gap-2"><Button size="sm" disabled={snapshot.busy || !apiToken
          || Object.values(target).some(value => !value.trim())} onClick={() => void configure()}>Enregistrer</Button>
          <Button size="sm" variant="outline" onClick={() => {setEditing(false);setApiToken('');}}>Annuler</Button></div>
      </CardContent></Card>}
    {!!snapshot.inspection?.secretConnections.length && !snapshot.saved && <Card className="mx-6 mb-6">
      <CardHeader><CardTitle className="text-base">Connexions protégées</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm"><p>Chaque connexion reste désactivée sur la cible sauf sélection explicite pour son transfert.</p>
        {snapshot.inspection.secretConnections.map(connection => {
          const key = `${connection.contextId}:${connection.reference}:${connection.bindingId}`;
          return <label key={key} className="flex items-start gap-2"><input type="checkbox" checked={rewrap.includes(key)}
            onChange={event => setRewrap(previous => event.target.checked ? [...previous, key] : previous.filter(item => item !== key))} />
            <span>{connection.label} <span className="text-slate-500">({connection.contextId})</span></span></label>;
        })}
      </CardContent></Card>}
    {snapshot.prepared && <Card className="mx-6 mb-6"><CardHeader><CardTitle className="text-base">Plan préparé</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm"><p>{snapshot.prepared.summary.title}</p>
        <p>Transfert <code>{snapshot.prepared.transferId}</code> · plan <code>{snapshot.prepared.planDigest}</code></p>
        <ul className="list-inside list-disc">{snapshot.prepared.summary.details.map((line, index) => <li key={index}>{line}</li>)}</ul>
        {snapshot.prepared.summary.warnings.map((line, index) => <p key={index} className="text-amber-800">{line}</p>)}
        <Badge variant="info">Aucun secret affiché</Badge>
      </CardContent></Card>}
    {snapshot.transfer?.finalUrl && /^https:\/\//.test(snapshot.transfer.finalUrl)
      && <p className="mx-6 mb-6 text-sm">Adresse publiée : <a className="text-sky-700 underline"
        href={snapshot.transfer.finalUrl} target="_blank" rel="noopener noreferrer">{snapshot.transfer.finalUrl}</a>
        {' '}· registre {snapshot.transfer.registryStatus === 'effective' ? 'effectif' : 'à vérifier'}</p>}
  </>;
}
