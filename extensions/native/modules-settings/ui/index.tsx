'use client';

import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ArrowLeft, Loader2, RefreshCw} from 'lucide-react';
import {Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Tabs, TabsContent, TabsList, TabsTrigger} from '@creezio/sdk/ui';
import {createModuleSettingsController} from '../../../../sdk/module-settings/controller.ts';
import type {ModuleSettingsController, ModuleSettingsSnapshot, ModuleCatalogPage, ModuleCatalogItem,
  ModuleDetail, ModuleIntent, ModuleJournalEntry, ModulePlanAcceptance, ModulePlanPreview,
  ModulePlanRead, ModulePlanTransition, ModuleDocumentList} from '../../../../sdk/module-settings/types.ts';
import type {ModuleActionKind} from '../../../../sdk/modules/types.ts';
import type {InstalledModuleDocument} from '../../../../sdk/modules/documents.ts';
import type {RuntimeViewProps} from '../../../../sdk/runtime/ui.ts';
import {useRegisterWorkspaceMetadata} from '@creezio/sdk/workspace/metadata';
import {CatalogCards, DependencyCard, DiagnosticCard, JournalCard, ModuleStatus, PlanPreviewCard,
  moduleWorkspaceLabel} from './presentation.tsx';
import {InstalledDocumentCard, InstalledDocumentsPanel, sameInstalledDocument,
  type InstalledDocumentKind} from './documentation.tsx';
import {modulePendingPersistence} from './persistence.ts';

const PAGE_SIZE = 25;
const DETAIL_VIEW = 'creezio.modules-settings:detail';
const LIST_VIEW = 'creezio.modules-settings:list';

function message(code: string) {
  if (code === 'unauthorized' || code === 'forbidden') return 'Accès réservé à la gestion des modules.';
  if (code === 'stale' || code === 'conflict') return 'Le plan ou la version de référence a changé. Actualisez les données avant de continuer.';
  if (code === 'rate_limited') return 'Trop de demandes. Réessayez plus tard.';
  if (code === 'persistence_unavailable') return 'La reprise de la commande est indisponible dans cet onglet. Aucun plan n’a été envoyé.';
  if (code === 'invalid_response') return 'Réponse du serveur invalide. Aucune modification supplémentaire n’a été lancée.';
  return 'Le serveur est indisponible. Réessayez après actualisation.';
}
function permission(props: RuntimeViewProps, snapshot: ModuleSettingsSnapshot) {
  return props.active && props.authorized && snapshot.authorized && !snapshot.suspended;
}
const emptySnapshot: ModuleSettingsSnapshot = Object.freeze({authorized: false, suspended: false,
  identityVersion: 0, pendingCommand: null});
function useModuleController(props: RuntimeViewProps) {
  const liveController = useRef<ModuleSettingsController | null>(null);
  const [binding, setBinding] = useState<{client: RuntimeViewProps['client']; access: RuntimeViewProps['access'];
    navigation: RuntimeViewProps['navigation']; controller: ModuleSettingsController;
    snapshot: ModuleSettingsSnapshot} | null>(null);
  useEffect(() => {
    const controller = createModuleSettingsController({operations: props.client, access: props.access,
      persistence: modulePendingPersistence(props.navigation)});
    liveController.current = controller;
    let live = true;
    const publish = () => {
      if (live) setBinding({client: props.client, access: props.access, navigation: props.navigation,
        controller, snapshot: controller.getSnapshot()});
    };
    const unsubscribe = controller.subscribe(publish);
    publish();
    return () => {
      live = false; unsubscribe(); controller.dispose();
      if (liveController.current === controller) liveController.current = null;
    };
  }, [props.client, props.access, props.navigation]);
  const current = binding?.controller === liveController.current && binding.client === props.client && binding.access === props.access
    && binding.navigation === props.navigation ? binding : null;
  return {controller: current?.controller ?? null, snapshot: current?.snapshot ?? emptySnapshot};
}

function PendingNotice({controller, snapshot, onResolved}: {controller: ModuleSettingsController;
  snapshot: ModuleSettingsSnapshot; onResolved: (accepted: ModulePlanAcceptance | ModulePlanTransition) => void}) {
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState('');
  if (!snapshot.pendingCommand) return null;
  async function check() {
    if (checking) return;
    setChecking(true); setFeedback('');
    try {
      const result = await controller.reconcilePending();
      if (result?.kind === 'accepted') onResolved(result.value);
      else if (result) setFeedback('Résultat encore incertain. La commande reste suspendue ; vérifiez à nouveau plus tard.');
    } finally {setChecking(false);}
  }
  return <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
    Une commande de modules doit être vérifiée avant toute autre modification.
    <Button size="sm" variant="outline" className="ml-2" disabled={checking} onClick={() => void check()}>
      {checking ? 'Vérification…' : 'Vérifier la commande'}</Button>
    {feedback && <p className="mt-2">{feedback}</p>}
  </div>;
}
function AcceptedNotice({value, onOpen}: {value: ModulePlanAcceptance | null; onOpen: (planId: string) => void}) {
  return value && <div role="status" className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
    <strong>Plan accepté, publication en attente.</strong> Révision {value.revision} · référence <code>{value.planId}</code>.
    La livraison en cours reste la référence jusqu’à la construction et la publication vérifiées.
    <Button size="sm" variant="outline" className="ml-2" onClick={() => onOpen(value.planId)}>
      Préparer la transmission</Button>
  </div>;
}
function downloadPlanHandoff(value: NonNullable<ModulePlanRead['handoff']>) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`],
    {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url; link.download = `creezio-module-plan-${value.planId}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function PlanRecord({value, controller, disabled, onChanged}: {value: ModulePlanRead | null;
  controller: ModuleSettingsController | null; disabled: boolean; onChanged: () => void}) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  async function close(kind: 'confirm' | 'cancel') {
    if (!value || !controller || busy || disabled || value.status !== 'accepted_pending_publication') return;
    setBusy(true);setError('');
    try {
      const base = {expectedRevision: value.plan.revision, planId: value.plan.id,
        expectedPlanDigest: value.plan.planDigest};
      const result = kind === 'confirm' ? await controller.confirmPublication(base)
        : await controller.cancelPending({...base, reason: reason.trim()});
      if (result.kind === 'accepted') {setReason('');onChanged();}
      else if (result.kind === 'unknown') setError('Résultat incertain. Vérifiez la commande avant toute autre action.');
      else setError(message(result.code));
    } finally {setBusy(false);}
  }
  return value && <Card><CardHeader><CardTitle className="text-base">Plan {value.plan.id}</CardTitle>
    <CardDescription>Révision {value.plan.revision} · {new Date(value.plan.acceptedAtMs).toLocaleString('fr-FR')}</CardDescription></CardHeader>
    <CardContent className="space-y-2 text-sm">
      <Badge variant={value.status === 'effective' ? 'success' : 'warning'}>
        {value.status === 'effective' ? 'Publication vérifiée' : value.status === 'cancelled'
          ? 'Plan annulé' : 'Publication en attente'}</Badge>
      <ul className="list-inside list-disc">{value.plan.summary.changes.map((change, index) =>
        <li key={`${change.moduleId}:${index}`}><code>{change.moduleId}</code> · {change.action}</li>)}</ul>
      {!!value.plan.summary.retiredPermissions?.length && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        Droits retirés par ce plan : {value.plan.summary.retiredPermissions.map(item=>
          `${item.moduleId}:${item.permissionId} (${item.origin})`).join(', ')}.
      </div>}
      {value.status === 'accepted_pending_publication' && <div className="space-y-2 border-t border-slate-200 pt-3">
        {value.handoff && <details className="rounded-md border border-slate-200 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Appliquer le plan</summary>
          <div className="mt-3 space-y-2">
          <p>Exportez le plan vérifié, puis utilisez-le dans le checkout de cette application.
            La commande prépare la composition cible ; la publication suit le canal autorisé pour Docker,
            Cloudflare ou le même Site GPT.</p>
          <Button size="sm" variant="outline" disabled={busy || disabled}
            onClick={() => downloadPlanHandoff(value.handoff!)}>Télécharger le plan JSON</Button>
          <p className="font-mono text-xs break-all">Composition cible : {value.handoff.targetCompositionDigest}<br />
            Verrou cible : {value.handoff.targetLockDigest}</p>
          <p className="text-xs">Dans le checkout applicatif, prévisualiser :
            <code className="block break-all">npm run modules:apply -- --plan &lt;fichier.json&gt; --composition &lt;composition.json&gt;</code>
            Puis appliquer après contrôle :
            <code className="block break-all">npm run modules:apply -- --plan &lt;fichier.json&gt; --composition &lt;composition.json&gt; --write</code>
          </p>
          <p className="text-xs">Après construction et publication, relisez ce plan puis confirmez seulement si
            la composition et le verrou de la livraison correspondent à ces cibles. Sur Sites, la mise à jour
            passe par la publication autorisée du même Site ; cette interface ne publie pas elle-même.</p>
          </div>
        </details>}
        <p>{value.matchesRuntimeTarget
          ? 'La livraison courante correspond exactement à la composition et au verrou cibles. Confirmez sa publication pour clore ce plan.'
          : 'La livraison courante diffère de la cible. Vous pouvez annuler explicitement ce plan avec un motif conservé dans le journal.'}</p>
        {value.matchesRuntimeTarget ? <Button size="sm" disabled={busy || disabled}
          onClick={() => void close('confirm')}>Confirmer la publication</Button>
          : <div className="space-y-2"><label className="block text-sm">Motif de l’annulation
            <textarea className="mt-1 block w-full rounded-md border border-slate-300 p-2" maxLength={512}
              value={reason} onChange={event => setReason(event.target.value)} /></label>
            <Button size="sm" variant="outline" disabled={busy || disabled || !reason.trim()}
              onClick={() => void close('cancel')}>Annuler ce plan en attente</Button></div>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>}
      {value.events.find(event => event.eventKind === 'plan-cancelled')?.reason &&
        <p>Motif conservé : {value.events.find(event => event.eventKind === 'plan-cancelled')?.reason}</p>}
      {value.plan.summary.detailsPaged && <p className="text-xs text-slate-500">Le résumé est partiel ; consultez les autres détails du journal.</p>}
    </CardContent></Card>;
}

function useJournal(controller: ModuleSettingsController | null, enabled: boolean, identityVersion: number) {
  const [items, setItems] = useState<readonly ModuleJournalEntry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [record, setRecord] = useState<ModulePlanRead | null>(null);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!enabled || !controller) return;
    const current = ++generation.current;
    setRecord(null);
    const result = await controller.journal({limit: PAGE_SIZE});
    if (current !== generation.current) return;
    if (!result.ok) {setError(message(result.error)); return;}
    setItems(result.value.items); setNext(result.value.nextAfterRevision); setError('');
  }, [controller, enabled]);
  useEffect(() => {
    generation.current++; setItems([]); setNext(null); setRecord(null); setError('');
    if (enabled) void refresh();
  }, [enabled, identityVersion, refresh]);
  async function more() {
    if (!enabled || !controller || next === null) return;
    const current = generation.current;
    const result = await controller.journal({limit: PAGE_SIZE, afterRevision: next});
    if (current !== generation.current) return;
    if (!result.ok) {setError(message(result.error)); return;}
    setItems(previous => [...previous, ...result.value.items]); setNext(result.value.nextAfterRevision);
  }
  async function open(planId: string) {
    if (!enabled || !controller) return;
    const current = generation.current;
    const result = await controller.read(planId);
    if (current !== generation.current) return;
    if (!result.ok) {setError(message(result.error)); return;}
    setRecord(result.value); setError('');
  }
  return {items, next, record, error, refresh, more, open};
}

function JournalPanel({journal, controller, disabled}: {journal: ReturnType<typeof useJournal>;
  controller: ModuleSettingsController | null; disabled: boolean}) {
  return <div className="space-y-3">{journal.error && <p role="alert" className="text-sm text-red-700">{journal.error}</p>}
    <JournalCard items={journal.items} onOpen={id => void journal.open(id)} />
    {journal.next !== null && <Button size="sm" variant="outline" onClick={() => void journal.more()}>Plus anciens</Button>}
    <PlanRecord value={journal.record} controller={controller} disabled={disabled}
      onChanged={() => {void journal.refresh();}} />
  </div>;
}

function documentMessage(code: string): string {
  if (code === 'not_found') return 'Aucun document installé trouvé pour ce module ou cette version.';
  if (code === 'conflict') return 'La version installée a changé. Actualisez les documents.';
  if (code === 'stale') return 'La lecture a été interrompue. Réessayez.';
  if (code === 'invalid_response') return 'Le document reçu ne correspond pas à la version installée. Réessayez après actualisation.';
  return message(code);
}

/** Loaded content stays in panel memory only; each activation rechecks the installed version. */
function useInstalledDocuments(controller: ModuleSettingsController | null, enabled: boolean,
  authorized: boolean, moduleId: string, identityVersion: number, tab: string) {
  const [list, setList] = useState<ModuleDocumentList | null>(null);
  const [loaded, setLoaded] = useState<Partial<Record<InstalledDocumentKind, InstalledModuleDocument>>>({});
  const [selected, setSelected] = useState<InstalledDocumentKind>('readme');
  const [loadingList, setLoadingList] = useState(false);
  const [loadingKind, setLoadingKind] = useState<InstalledDocumentKind | null>(null);
  const [listError, setListError] = useState('');
  const [readError, setReadError] = useState<{kind: InstalledDocumentKind; message: string} | null>(null);
  const generation = useRef(0), readGeneration = useRef(0);
  const live = useRef({enabled, moduleId, identityVersion});
  live.current = {enabled, moduleId, identityVersion};
  const refresh = useCallback(async () => {
    if (!enabled || !controller || !moduleId) return;
    const current = ++generation.current;
    readGeneration.current++;
    setList(null); setLoaded({}); setListError(''); setReadError(null);
    setLoadingKind(null); setLoadingList(true);
    const isCurrent = () => generation.current === current && live.current.enabled
      && live.current.moduleId === moduleId && live.current.identityVersion === identityVersion;
    const result = await controller.listDocuments(moduleId, isCurrent);
    if (!isCurrent()) return;
    if (result.ok && result.value.moduleId === moduleId) setList(result.value);
    else setListError(documentMessage(result.ok ? 'invalid_response' : result.error));
    setLoadingList(false);
  }, [controller, enabled, moduleId, identityVersion]);
  useLayoutEffect(() => {
    generation.current++; readGeneration.current++;
    setList(null); setLoaded({}); setListError(''); setReadError(null);
    setLoadingKind(null); setLoadingList(enabled);
    return () => {generation.current++; readGeneration.current++;};
  }, [enabled, authorized, refresh]);
  // The workspace pane updates its activity guard in a parent layout effect.
  // Start transport reads after that guard has observed reactivation.
  useEffect(() => {if (enabled) void refresh();}, [enabled, refresh]);
  const read = useCallback(async (kind: InstalledDocumentKind, force = false) => {
    if (!enabled || !controller || list?.moduleId !== moduleId) return;
    const metadata = list.documents.find(item => item.kind === kind);
    if (!metadata || !force && sameInstalledDocument(metadata, loaded[kind] ?? null)) return;
    const current = ++readGeneration.current, listVersion = generation.current;
    setLoadingKind(kind); setReadError(null);
    const isCurrent = () => readGeneration.current === current && generation.current === listVersion
      && live.current.enabled && live.current.moduleId === moduleId
      && live.current.identityVersion === identityVersion;
    const result = await controller.loadDocument(metadata, isCurrent);
    if (!isCurrent()) return;
    if (result.ok && sameInstalledDocument(metadata, result.value))
      setLoaded(previous => ({...previous, [kind]: result.value}));
    else setReadError({kind, message: documentMessage(result.ok ? 'invalid_response' : result.error)});
    setLoadingKind(null);
  }, [controller, enabled, list, loaded, moduleId, identityVersion]);
  useEffect(() => {
    if (!enabled || !list || loadingList) return;
    const kind = tab === 'prd' || tab === 'changelog' ? tab
      : tab === 'documents' ? selected : null;
    if (kind && list.documents.some(item => item.kind === kind)) void read(kind);
  }, [enabled, list, loadingList, tab, selected, read]);
  const select = (kind: InstalledDocumentKind) => {
    if (kind === selected) void read(kind, true);
    else setSelected(kind);
  };
  return {list, loaded, selected, loadingList, loadingKind, listError, readError, refresh, read, select};
}

export function ModulesListView(props: RuntimeViewProps) {
  const {controller, snapshot} = useModuleController(props);
  const enabled = permission(props, snapshot);
  const [catalog, setCatalog] = useState<ModuleCatalogPage | null>(null);
  const [items, setItems] = useState<readonly ModuleCatalogItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState<ModulePlanAcceptance | null>(null);
  const [tab, setTab] = useState('catalogue');
  const generation = useRef(0);
  const identityVersion = useRef(snapshot.identityVersion);
  const journal = useJournal(controller, enabled, snapshot.identityVersion);
  const load = useCallback(async () => {
    if (!enabled || !controller) return;
    const current = ++generation.current;
    setLoading(true);
    const result = await controller.list({limit: PAGE_SIZE});
    if (current !== generation.current) return;
    if (result.ok) {setCatalog(result.value); setItems(result.value.items); setNext(result.value.nextAfterId); setError('');}
    else setError(message(result.error));
    setLoading(false);
  }, [controller, enabled]);
  useEffect(() => {
    if (snapshot.identityVersion === identityVersion.current && props.authorized) return;
    identityVersion.current = snapshot.identityVersion;
    generation.current++; setCatalog(null); setItems([]); setNext(null); setAccepted(null); setError('');
  }, [snapshot.identityVersion, props.authorized]);
  useEffect(() => {if (enabled) void load(); else generation.current++;}, [enabled, load, snapshot.identityVersion]);
  async function more() {
    if (!enabled || !controller || next === null) return;
    const current = generation.current;
    const result = await controller.list({limit: PAGE_SIZE, afterId: next});
    if (current !== generation.current) return;
    if (!result.ok) {setError(message(result.error)); return;}
    if (catalog && (result.value.revision !== catalog.revision
      || result.value.compositionDigest !== catalog.compositionDigest
      || result.value.lockDigest !== catalog.lockDigest
      || result.value.inventoryDigest !== catalog.inventoryDigest)) {
      setError('Le catalogue a changé pendant la pagination. Actualisez la liste.'); return;
    }
    setItems(previous => [...previous, ...result.value.items]); setNext(result.value.nextAfterId);
  }
  if (!controller) return <p className="p-6 text-sm text-slate-500">Chargement de la gestion des modules…</p>;
  if (!enabled || snapshot.identityVersion !== identityVersion.current)
    return <p className="p-6 text-sm text-slate-500">{snapshot.suspended ? 'Session temporairement indisponible.' : 'Accès réservé à la gestion des modules.'}</p>;
  return <div className="space-y-4 p-6">
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-semibold">Modules</h1>
      <Badge variant="outline">Catalogue serveur</Badge>
      <Button size="sm" variant="outline" className="ml-auto" disabled={loading} onClick={() => {void load(); void journal.refresh();}}>
        <RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button></div>
    <p className="text-sm text-slate-600">Modules disponibles dans la livraison et composition courante. Les changements passent par un plan vérifié.</p>
    <PendingNotice controller={controller} snapshot={snapshot} onResolved={value => {
      if (value.status === 'accepted_pending_publication') setAccepted(value);
      void journal.refresh();}} />
    <AcceptedNotice value={accepted} onOpen={planId => {setTab('journal'); void journal.open(planId);}} />
    {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="catalogue">Catalogue</TabsTrigger>
      <TabsTrigger value="journal">Journal</TabsTrigger></TabsList>
      <TabsContent value="catalogue" className="space-y-3 pt-4">
        {loading && !catalog ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Chargement…</p>
          : <CatalogCards items={items} onOpen={moduleId => {props.navigation.open(DETAIL_VIEW, {moduleId});}} />}
        {next !== null && <Button size="sm" variant="outline" onClick={() => void more()}>Autres modules</Button>}
      </TabsContent>
      <TabsContent value="journal" className="pt-4"><JournalPanel journal={journal} controller={controller}
        disabled={!!snapshot.pendingCommand} /></TabsContent>
    </Tabs>
  </div>;
}

type Choice = Extract<ModuleActionKind, 'add' | 'update' | 'enable' | 'disable' | 'remove'>;
function choices(item: ModuleCatalogItem): readonly Choice[] {
  if (item.visibility === 'available') return item.candidateKey ? ['add'] : [];
  return [...(item.candidateKey ? ['update' as const] : []), item.enabled ? 'disable' : 'enable', 'remove'];
}
const choiceLabel: Record<Choice, string> = {add: 'Ajouter', update: 'Mettre à jour', enable: 'Activer',
  disable: 'Désactiver', remove: 'Retirer'};
type ExposureChoice = 'admin' | 'app' | 'both' | 'headless';
const exposureAudiences: Record<ExposureChoice, readonly ('admin' | 'app')[]> = {
  admin: ['admin'], app: ['app'], both: ['admin', 'app'], headless: [],
};
function intentFor(page: ModuleCatalogPage, item: ModuleCatalogItem, choice: Choice,
  audiences?: readonly ('admin' | 'app')[]): ModuleIntent {
  const candidate = choice === 'add' || choice === 'update' ? {candidateKey: item.candidateKey!} : {};
  const exposure = choice === 'add' || choice === 'enable' ? {audiences: audiences!} : {};
  return {schemaVersion: 1, base: {revision: page.revision, compositionDigest: page.compositionDigest,
    lockDigest: page.lockDigest, inventoryDigest: page.inventoryDigest},
  actions: [{kind: choice, moduleId: item.moduleId, ...candidate, ...exposure}]};
}

export function ModuleDetailView(props: RuntimeViewProps) {
  const {controller, snapshot} = useModuleController(props);
  const enabled = permission(props, snapshot);
  const moduleId = props.input.moduleId ?? '';
  const [detail, setDetail] = useState<ModuleDetail | null>(null);
  const moduleTitle = moduleWorkspaceLabel(detail?.module.moduleId === moduleId && props.authorized
    ? detail.module.title : moduleId, moduleId);
  useRegisterWorkspaceMetadata(props.panelId, {title: moduleTitle, kind: 'entity', trail: [
    {label: 'Modules et extensions', href: '/admin/modules'}, {label: moduleTitle},
  ]});
  const [choice, setChoice] = useState<Choice | ''>('');
  const [exposure, setExposure] = useState<ExposureChoice | ''>('');
  const [intent, setIntent] = useState<ModuleIntent | null>(null);
  const [plan, setPlan] = useState<ModulePlanPreview | null>(null);
  const [baselineAcknowledged, setBaselineAcknowledged] = useState(false);
  const [accepted, setAccepted] = useState<ModulePlanAcceptance | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('apercu');
  const generation = useRef(0);
  const accepting = useRef(false);
  const identityVersion = useRef(snapshot.identityVersion);
  const journal = useJournal(controller, enabled, snapshot.identityVersion);
  const documentation = useInstalledDocuments(controller, enabled, props.authorized,
    moduleId, snapshot.identityVersion, tab);
  const installedDocuments = documentation.list?.moduleId === moduleId ? documentation.list.documents : [];
  const documentPanel = (kind: 'prd' | 'changelog') => {
    const metadata = installedDocuments.find(item => item.kind === kind) ?? null;
    return <div className="space-y-3">
      {documentation.loadingList && <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />Vérification des documents installés…</p>}
      {documentation.listError && <p role="alert" className="text-sm text-red-700">{documentation.listError}
        <Button size="sm" variant="outline" className="ml-2" onClick={() => void documentation.refresh()}>Réessayer</Button></p>}
      {!documentation.loadingList && !documentation.listError && <InstalledDocumentCard kind={kind} metadata={metadata}
        document={documentation.loaded[kind] ?? null} loading={documentation.loadingKind === kind}
        error={documentation.readError?.kind === kind ? documentation.readError.message : ''}
        onRetry={() => void documentation.read(kind, true)} />}
    </div>;
  };
  const load = useCallback(async () => {
    if (!enabled || !controller || !moduleId) return;
    const current = ++generation.current;
    setPlan(null); setIntent(null); setBaselineAcknowledged(false);
    setLoading(true);
    const result = await controller.detail(moduleId);
    if (current !== generation.current) return;
    if (result.ok) {setDetail(result.value); setError('');}
    else setError(message(result.error));
    setLoading(false);
  }, [controller, enabled, moduleId]);
  useEffect(() => {
    if (snapshot.identityVersion === identityVersion.current && props.authorized) return;
    identityVersion.current = snapshot.identityVersion;
    generation.current++; setDetail(null); setPlan(null); setIntent(null); setAccepted(null);
    setBaselineAcknowledged(false); setError('');
  }, [snapshot.identityVersion, props.authorized]);
  useEffect(() => {if (enabled) void load(); else generation.current++;}, [enabled, load, snapshot.identityVersion]);
  useEffect(() => {setChoice(''); setExposure(''); setIntent(null); setPlan(null);
    setBaselineAcknowledged(false); setAccepted(null);}, [moduleId]);
  async function prepare() {
    const requiresExposure = choice === 'add' || choice === 'enable';
    if (!enabled || !controller || !detail || !choice || busy || snapshot.pendingCommand || requiresExposure && !exposure) return;
    const current = generation.current;
    setBusy(true); setPlan(null); setIntent(null); setBaselineAcknowledged(false); setAccepted(null); setError('');
    try {
      const page = await controller.list({limit: 1});
      if (current !== generation.current) return;
      if (!page.ok) {setError(message(page.error)); return;}
      const nextIntent = intentFor(page.value, detail.module, choice,
        exposure ? exposureAudiences[exposure] : undefined);
      const preview = await controller.preview(nextIntent);
      if (current !== generation.current) return;
      if (!preview.ok) {setError(message(preview.error)); return;}
      if (preview.value.baseRevision !== nextIntent.base.revision
        || preview.value.baseCompositionDigest !== nextIntent.base.compositionDigest
        || preview.value.baseLockDigest !== nextIntent.base.lockDigest) {
        setError(message('invalid_response')); return;
      }
      setIntent(nextIntent); setPlan(preview.value);
    } finally {if (current === generation.current) setBusy(false);}
  }
  async function accept() {
    if (!enabled || !controller || !intent || !plan || busy || accepted || snapshot.pendingCommand
      || accepting.current || plan.baselineChanged && !baselineAcknowledged) return;
    const current = generation.current;
    accepting.current = true;
    setBusy(true); setError('');
    try {
      const result = await controller.accept({expectedRevision: plan.baseRevision,
        expectedPlanDigest: plan.planDigest, intent,
        ...(plan.baselineChanged ? {acknowledgeBaselineChange: true} : {})});
      if (current !== generation.current) return;
      if (result.kind === 'accepted') {setAccepted(result.value); void journal.refresh();}
      else if (result.kind === 'unknown') setError('Résultat incertain. Vérifiez la commande avant de préparer un nouveau plan.');
      else setError(message(result.code));
    } finally {accepting.current = false; if (current === generation.current) setBusy(false);}
  }
  if (!controller) return <p className="p-6 text-sm text-slate-500">Chargement de la gestion des modules…</p>;
  if (!enabled || snapshot.identityVersion !== identityVersion.current)
    return <p className="p-6 text-sm text-slate-500">{snapshot.suspended ? 'Session temporairement indisponible.' : 'Accès réservé à la gestion des modules.'}</p>;
  return <div className="space-y-4 p-6">
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" onClick={() => props.navigation.open(LIST_VIEW)}>
      <ArrowLeft className="mr-1 h-4 w-4" />Modules</Button><h1 className="text-lg font-semibold">{detail?.module.title ?? moduleId}</h1>
      <Button size="sm" variant="outline" className="ml-auto" disabled={loading} onClick={() => {
        void load(); void journal.refresh(); void documentation.refresh();
      }}>
        <RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button></div>
    <PendingNotice controller={controller} snapshot={snapshot} onResolved={value => {
      if (value.status === 'accepted_pending_publication') setAccepted(value);
      void journal.refresh();}} />
    <AcceptedNotice value={accepted} onOpen={planId => {setTab('journal'); void journal.open(planId);}} />
    {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading && !detail && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Chargement…</p>}
    {detail && <Tabs value={tab} onValueChange={setTab}><TabsList className="h-auto max-w-full flex-wrap">
      <TabsTrigger value="apercu">Aperçu</TabsTrigger><TabsTrigger value="dependances">Dépendances</TabsTrigger>
      <TabsTrigger value="prd">PRD</TabsTrigger><TabsTrigger value="documents">Documents</TabsTrigger>
      <TabsTrigger value="changelog">Changelog</TabsTrigger><TabsTrigger value="plan">Plan</TabsTrigger>
      <TabsTrigger value="journal">Journal local</TabsTrigger></TabsList>
      <TabsContent value="apercu" className="space-y-3 pt-4"><Card><CardHeader>
        <CardTitle className="text-base">{detail.module.title}</CardTitle>
        <CardDescription><code>{detail.module.moduleId}</code> · v{detail.module.version} · {detail.module.origin}</CardDescription>
      </CardHeader><CardContent className="space-y-3 text-sm">
        <p>{detail.module.description}</p><ModuleStatus item={detail.module} />
        <p className="text-xs text-slate-500">Cette fiche distingue la présence dans la livraison, l’activation, la configuration et le fonctionnement vérifié.</p>
      </CardContent></Card><DiagnosticCard items={detail.diagnostics} /></TabsContent>
      <TabsContent value="dependances" className="grid gap-3 pt-4 lg:grid-cols-2">
        <DependencyCard title="Dépend de" description="Relations obligatoires directes et transitives." items={detail.dependsOn} />
        <DependencyCard title="Utilisé par" description="Modules qui dépendent de cette sélection." items={detail.usedBy} />
        <DependencyCard title="Intégrations facultatives" description="État actif ou inactif de chaque intégration déclarée." items={detail.optionalIntegrations} />
      </TabsContent>
      <TabsContent value="prd" className="pt-4">{documentPanel('prd')}</TabsContent>
      <TabsContent value="documents" className="space-y-3 pt-4">
        {documentation.loadingList && <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />Vérification des documents installés…</p>}
        {documentation.listError && <p role="alert" className="text-sm text-red-700">{documentation.listError}
          <Button size="sm" variant="outline" className="ml-2" onClick={() => void documentation.refresh()}>Réessayer</Button></p>}
        {!documentation.loadingList && !documentation.listError && <InstalledDocumentsPanel documents={installedDocuments}
          selected={documentation.selected} loaded={documentation.loaded[documentation.selected] ?? null}
          loading={documentation.loadingKind === documentation.selected}
          error={documentation.readError?.kind === documentation.selected ? documentation.readError.message : ''}
          onSelect={documentation.select} onRetry={() => void documentation.read(documentation.selected, true)} />}
      </TabsContent>
      <TabsContent value="changelog" className="pt-4">{documentPanel('changelog')}</TabsContent>
      <TabsContent value="plan" className="space-y-3 pt-4"><Card><CardHeader><CardTitle className="text-base">Préparer un changement</CardTitle>
        <CardDescription>Le serveur vérifie l’inventaire compilé, le verrou et les dépendances avant l’acceptation.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3"><label className="space-y-1 text-sm">Action
          <select className="block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={choice}
            onChange={event => {setChoice(event.target.value as Choice | ''); setExposure('');
              setIntent(null); setPlan(null); setBaselineAcknowledged(false); setAccepted(null);}}
            disabled={busy || !!snapshot.pendingCommand}>
            <option value="">Choisir une action</option>{choices(detail.module).map(value => <option key={value} value={value}>{choiceLabel[value]}</option>)}
          </select></label>
          {(choice === 'add' || choice === 'enable') && <label className="space-y-1 text-sm">Interface exposée
            <select className="block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={exposure}
              onChange={event => {setExposure(event.target.value as ExposureChoice | '');
                setIntent(null); setPlan(null); setBaselineAcknowledged(false); setAccepted(null);}}
              disabled={busy || !!snapshot.pendingCommand}>
              <option value="">Choisir explicitement</option>
              <option value="admin">Administrateur</option><option value="app">Utilisateurs</option>
              <option value="both">Les deux interfaces</option><option value="headless">Sans interface (headless)</option>
            </select></label>}
          <Button disabled={!choice || (choice === 'add' || choice === 'enable') && !exposure || busy || !!snapshot.pendingCommand}
            onClick={() => void prepare()}>
          {busy ? 'Préparation…' : 'Prévisualiser'}</Button></CardContent></Card>
        {plan && <PlanPreviewCard plan={plan} onAccept={() => void accept()}
          baselineAcknowledged={baselineAcknowledged} onAcknowledgeBaseline={setBaselineAcknowledged}
          disabled={busy || !!snapshot.pendingCommand || !!accepted} />}
      </TabsContent>
      <TabsContent value="journal" className="pt-4"><JournalPanel journal={journal} controller={controller}
        disabled={!!snapshot.pendingCommand} /></TabsContent>
    </Tabs>}
  </div>;
}
