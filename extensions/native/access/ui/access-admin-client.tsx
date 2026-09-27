'use client';

/** Original roles, accounts and audit screen, backed by the native Access SDK. */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Minus, RefreshCw, RotateCcw, Save, ShieldCheck, UserRound } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent,
  TabsList, TabsTrigger, Toaster, toast } from '@creezio/sdk/ui';
import type { AccessAdminAuditCursor, AccessAdminAuditDetailPage, AccessAdminAuditEntry,
  AccessAdminAudience, AccessAdminCommandOutcome, AccessAdminController, AccessAdminDeltaInput,
  AccessAdminPolicyRead, AccessAdminPrincipal, AccessAdminSession } from '../../../../sdk/access/admin-types.ts';
import { changedEffects, draftRefreshDecision, matrixFromPolicy, principalScope, rolePermissionKey, rolePermissionTuple,
  shouldPurgeAdminView,
  type AccessEffect, type MatrixGroup, type MatrixRole, type MatrixView } from './projection.ts';

const DEFAULT_CONTEXT = 'application';
const DEFAULT_ROLE = '__creezio_add_role__';
const MAX_DELTA = 32;
const MAX_DELTA_BYTES = 12 * 1024;
type Apply = (changes: readonly AccessAdminDeltaInput[], success: string) => Promise<boolean>;
type Command = (run: () => Promise<AccessAdminCommandOutcome>, success: string) => Promise<boolean>;

function safeError(code: string) {
  if (code === 'conflict') return 'La politique a changé. Les données ont été actualisées ; vérifiez puis recommencez.';
  if (code === 'forbidden' || code === 'unauthorized') return 'Accès réservé (permission creezio.access:manage).';
  if (code === 'rate_limited') return 'Trop de demandes. Réessayez plus tard.';
  if (code === 'unknown' || code === 'unavailable') return 'Résultat incertain. Vérifiez la commande avant toute nouvelle tentative.';
  return 'Opération refusée. Actualisez les données avant de réessayer.';
}
const date = (ms: number) => new Date(ms).toLocaleString('fr-FR');

/** Matrice originale, avec clé structurée et delta borné par le contrat serveur. */
function MatrixPanel({ data, disabled, onApply }: { data: MatrixView; disabled: boolean; onApply: Apply }) {
  const fresh = useCallback((view: MatrixView) => {
    const initial = new Map<string, AccessEffect>(view.overrides.map(row =>
      [rolePermissionKey(row.role, row.permission), row.effect] as const));
    return {view, initial, draft: new Map(initial)};
  }, []);
  const [edit, setEdit] = useState(() => fresh(data));
  const [saving, setSaving] = useState(false);
  const changes = changedEffects(edit.initial, edit.draft);
  const refresh = draftRefreshDecision(edit.view.epoch, data.epoch, edit.initial, edit.draft);
  const stale = refresh !== 'same';
  useEffect(() => { if (refresh === 'adopt') setEdit(fresh(data)); }, [refresh, fresh, data]);
  const defaults = useMemo(() => new Map(edit.view.roles.flatMap(role =>
    edit.view.groups.flatMap(group => group.permissions.map(permission =>
      [rolePermissionKey(role.id, permission.id), role.defaults.includes(permission.id)] as const)))), [edit.view]);
  const effective = useCallback((roleId: string, permissionId: string) => {
    const key = rolePermissionKey(roleId, permissionId), effect = edit.draft.get(key) ?? 'inherit';
    return effect === 'allow' || effect === 'inherit' && (defaults.get(key) ?? false);
  }, [edit.draft, defaults]);
  function toggle(roleId: string, permissionId: string) {
    const key = rolePermissionKey(roleId, permissionId), next = !effective(roleId, permissionId);
    const effect: AccessEffect = next === (defaults.get(key) ?? false) ? 'inherit' : next ? 'allow' : 'deny';
    setEdit(previous => { const draft = new Map(previous.draft); if (effect === 'inherit') draft.delete(key); else draft.set(key, effect); return {...previous, draft}; });
  }
  async function save() {
    if (!changes.length || stale || disabled || saving) return;
    const delta: AccessAdminDeltaInput[] = changes.map(({key, effect}) => {
      const [roleId, permissionId] = rolePermissionTuple(key);
      return {kind: 'role-override', roleId, permissionId, effect};
    });
    setSaving(true);
    try { if (await onApply(delta, `${delta.length} changement(s) appliqué(s)`))
      setEdit(previous => ({...previous, draft: new Map(previous.initial)})); }
    finally { setSaving(false); }
  }
  return <Card>
    <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
      <div><CardTitle className="text-base">Matrice des accès</CardTitle>
        <CardDescription>Toggles par rôle et par module. Un point marque un écart au défaut du rôle — réinitialisable cellule par cellule.</CardDescription></div>
      <Button size="sm" onClick={() => void save()} disabled={!changes.length || stale || disabled || saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Enregistrer
      </Button>
    </CardHeader>
    <CardContent className="overflow-x-auto">{stale && <div role="alert" className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
      La politique a changé pendant votre édition. Votre brouillon est conservé et ne peut plus être soumis sur son ancien epoch.
      <Button variant="outline" size="sm" className="ml-2" onClick={() => setEdit(fresh(data))}>Abandonner le brouillon et charger la politique actuelle</Button>
    </div>}<table className="w-full border-collapse text-sm">
      <thead><tr className="border-b border-slate-200"><th className="py-2 pr-4 text-left font-medium text-slate-500">Permission</th>
        {edit.view.roles.map(role => <th key={role.id} className="min-w-[110px] px-2 py-2 text-center font-medium text-slate-700">{role.label}</th>)}</tr></thead>
      <tbody>{edit.view.groups.map(group => <GroupRows key={group.id} group={group} roles={edit.view.roles} disabled={disabled || saving || stale}
        effective={effective} overridden={(role, permission) => edit.draft.has(rolePermissionKey(role, permission))}
        onToggle={toggle} onReset={(role, permission) => setEdit(previous => {
          const draft = new Map(previous.draft); draft.delete(rolePermissionKey(role, permission)); return {...previous, draft};
        })} />)}</tbody>
    </table></CardContent>
  </Card>;
}

function GroupRows({group, roles, disabled, effective, overridden, onToggle, onReset}: {
  group: MatrixGroup; roles: readonly MatrixRole[]; disabled: boolean;
  effective: (role: string, permission: string) => boolean;
  overridden: (role: string, permission: string) => boolean;
  onToggle: (role: string, permission: string) => void;
  onReset: (role: string, permission: string) => void;
}) {
  return <>
    <tr className="border-b border-slate-100 bg-slate-50/60"><td colSpan={roles.length + 1}
      className="px-1 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{group.label}</td></tr>
    {group.permissions.map(permission => <tr key={permission.id} className="border-b border-slate-100 last:border-0">
      <td className="py-1.5 pr-4"><div className="text-[13px] text-slate-800">{permission.label}</div>
        <div className="font-mono text-[11px] text-slate-400">{permission.id}</div></td>
      {roles.map(role => {
        const on = effective(role.id, permission.id), changed = overridden(role.id, permission.id);
        return <td key={role.id} className="px-2 py-1.5 text-center"><span className="relative inline-flex items-center">
          <button type="button" disabled={disabled || role.locked} onClick={() => onToggle(role.id, permission.id)}
            title={on ? 'Autorisé — cliquer pour refuser' : 'Refusé — cliquer pour autoriser'}
            data-creezio-aid={`access-cell-${role.id}-${permission.id}`}
            className={cn('inline-flex h-6 w-10 items-center rounded-full transition-colors', on ? 'bg-emerald-500' : 'bg-slate-200',
              disabled || role.locked ? 'cursor-not-allowed opacity-60' : 'hover:opacity-90')}>
            <span className={cn('inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform',
              on ? 'translate-x-[18px]' : 'translate-x-[2px]')}>{on ? <Check className="h-3 w-3 text-emerald-600" /> : <Minus className="h-3 w-3 text-slate-400" />}</span>
          </button>
          {changed && <button type="button" disabled={disabled} onClick={() => onReset(role.id, permission.id)}
            title="Revenir au défaut du rôle" className="absolute -right-5 text-amber-500 hover:text-amber-600">
            <RotateCcw className="h-3 w-3" /></button>}
        </span></td>;
      })}</tr>)}
  </>;
}

/** Account override editor follows all assigned roles in the selected context/audience. */
function UserPermissionsEditor({principal, policy, groups, contextId, audience, disabled, onApply}: {
  principal: AccessAdminPrincipal; policy: AccessAdminPolicyRead; groups: readonly MatrixGroup[];
  contextId: string; audience: AccessAdminAudience; disabled: boolean; onApply: Apply;
}) {
  const fresh = useCallback((view: AccessAdminPolicyRead) => {
    const scope = principalScope(view, principal.id, contextId, audience, principal.kind);
    const initial = new Map<string, AccessEffect>(scope.overrides.map(row => [row.permissionId, row.effect] as const));
    return {epoch: view.epoch, scope, initial, draft: new Map(initial)};
  }, [principal.id, contextId, audience]);
  const [edit, setEdit] = useState(() => fresh(policy));
  const [saving, setSaving] = useState(false);
  const changes = changedEffects(edit.initial, edit.draft);
  const refresh = draftRefreshDecision(edit.epoch, policy.epoch, edit.initial, edit.draft);
  const stale = refresh !== 'same';
  useEffect(() => { if (refresh === 'adopt') setEdit(fresh(policy)); }, [refresh, fresh, policy]);
  const baseline = useMemo(() => new Set(edit.scope.baseline), [edit.scope]);
  const eligibleGroups = useMemo(() => groups.map(group => ({...group,
    permissions: group.permissions.filter(permission => policy.permissions.find(row => row.id === permission.id)
      ?.actors.includes(principal.kind === 'human' ? 'user' : 'machine'))
  })).filter(group => group.permissions.length), [groups, policy.permissions, principal.kind]);
  const effective = (permissionId: string) => {
    const effect = edit.draft.get(permissionId) ?? 'inherit';
    return effect === 'allow' || effect === 'inherit' && baseline.has(permissionId);
  };
  function toggle(permissionId: string) {
    const next = !effective(permissionId);
    const effect: AccessEffect = next === baseline.has(permissionId) ? 'inherit' : next ? 'allow' : 'deny';
    setEdit(previous => { const draft = new Map(previous.draft); if (effect === 'inherit') draft.delete(permissionId); else draft.set(permissionId, effect); return {...previous, draft}; });
  }
  async function save() {
    if (!changes.length || stale || disabled || saving) return;
    setSaving(true);
    try { if (await onApply(changes.map(({key: permissionId, effect}) => ({kind: 'principal-override',
      principalId: principal.id, contextId, audience, permissionId, effect})),
    `Permissions de ${principal.displayName} mises à jour`))
      setEdit(previous => ({...previous, draft: new Map(previous.initial)})); }
    finally { setSaving(false); }
  }
  return <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
    <div className="mb-2 flex items-center justify-between"><p className="text-[12px] text-slate-500">
      Permissions du compte <strong>{principal.displayName}</strong> — un point orange marque un écart aux rôles (réinitialisable).</p>
      <Button size="sm" onClick={() => void save()} disabled={!changes.length || stale || disabled || saving}
        data-creezio-aid={`access-user-perms-save-${principal.id}`}>
        {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}Enregistrer</Button></div>
    {stale && <div role="alert" className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
      La politique a changé pendant votre édition. Votre brouillon est conservé et ne peut plus être soumis sur son ancien epoch.
      <Button variant="outline" size="sm" className="ml-2" onClick={() => setEdit(fresh(policy))}>Abandonner le brouillon et charger la politique actuelle</Button>
    </div>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{eligibleGroups.map(group => <div key={group.id}
      className="rounded border border-slate-200 bg-white p-2"><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{group.label}</p>
      <div className="space-y-1">{group.permissions.map(permission => {
        const on = effective(permission.id), changed = edit.draft.has(permission.id);
        return <div key={permission.id} className="flex items-center justify-between gap-2">
          <span className="truncate text-[12px] text-slate-700" title={permission.id}>{permission.label}</span>
          <span className="relative inline-flex shrink-0 items-center"><button type="button" disabled={disabled || saving || stale}
            onClick={() => toggle(permission.id)} title={on ? 'Autorisé — cliquer pour refuser' : 'Refusé — cliquer pour autoriser'}
            data-creezio-aid={`access-user-cell-${principal.id}-${permission.id}`}
            className={cn('inline-flex h-5 w-9 items-center rounded-full transition-colors hover:opacity-90', on ? 'bg-emerald-500' : 'bg-slate-200')}>
            <span className={cn('inline-flex h-4 w-4 items-center justify-center rounded-full bg-white shadow transition-transform',
              on ? 'translate-x-[18px]' : 'translate-x-[2px]')}>{on ? <Check className="h-2.5 w-2.5 text-emerald-600" /> : <Minus className="h-2.5 w-2.5 text-slate-400" />}</span></button>
            {changed && <button type="button" disabled={disabled || saving || stale} onClick={() => setEdit(previous => {
              const draft = new Map(previous.draft); draft.delete(permission.id); return {...previous, draft};
            })} title="Revenir aux rôles" className="absolute -right-4 text-amber-500 hover:text-amber-600"><RotateCcw className="h-2.5 w-2.5" /></button>}
          </span></div>;
      })}</div></div>)}</div>
  </div>;
}

function SessionsPanel({principal, controller, disabled, onCommand}: {
  principal: AccessAdminPrincipal; controller: AccessAdminController; disabled: boolean; onCommand: Command;
}) {
  const [items, setItems] = useState<readonly AccessAdminSession[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (afterId: string | null) => {
    setLoading(true); setError('');
    try {
      const result = await controller.listSessions({principalId: principal.id, afterId, limit: 50});
      if (!result.ok) { setError(safeError(result.error)); return; }
      setItems(previous => afterId ? [...previous, ...result.value.items] : result.value.items);
      setNext(result.value.nextAfterId);
    } catch { setError('Chargement des sessions impossible.'); }
    finally { setLoading(false); }
  }, [controller, principal.id]);
  useEffect(() => { void load(null); return () => { setItems([]); }; }, [load]);
  async function revoke(sessionId: string) {
    if (await onCommand(() => controller.revokeSession({sessionId}), 'Session révoquée')) await load(null);
  }
  return <div className="rounded-md border border-slate-200 bg-white p-3">
    <p className="mb-2 text-[12px] font-semibold text-slate-700">Sessions de {principal.displayName}</p>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {loading && !items.length && <p className="text-xs text-slate-500">Chargement…</p>}
    {!loading && !items.length && !error && <p className="text-xs text-slate-500">Aucune session.</p>}
    <div className="space-y-1">{items.map(session => <div key={session.id}
      className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1 text-xs">
      <span className="font-mono">{session.id} · {session.audience} · {date(session.createdAtMs)}</span>
      <span className="flex items-center gap-2"><Badge variant={session.active ? 'success' : 'outline'}>
        {session.active ? 'Active' : 'Terminée'}</Badge>
        {session.active && <Button variant="outline" size="sm" disabled={disabled} onClick={() => void revoke(session.id)}>Révoquer</Button>}</span>
    </div>)}</div>
    {next && <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load(next)}>Autres sessions</Button>}
  </div>;
}

/** Original accounts screen, expanded for tuple-scoped multiple roles and session controls. */
function UsersPanel({principals, next, policy, groups, controller, disabled, onApply, onCommand, onMore, portalContainer}: {
  principals: readonly AccessAdminPrincipal[]; next: string | null; policy: AccessAdminPolicyRead;
  groups: readonly MatrixGroup[]; controller: AccessAdminController; disabled: boolean;
  onApply: Apply; onCommand: Command; onMore: () => void;
  portalContainer?: HTMLElement | null;
}) {
  const [contextId, setContextId] = useState(DEFAULT_CONTEXT);
  const [audience, setAudience] = useState<AccessAdminAudience>('admin');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const contexts = policy.policy.contexts;
  useEffect(() => { if (!contexts.some(row => row.id === contextId)) setContextId(contexts[0]?.id ?? DEFAULT_CONTEXT); }, [contexts, contextId]);
  const visibleGroups = useMemo(() => groups.map(group => ({...group,
    permissions: group.permissions.filter(permission => policy.permissions.find(row => row.id === permission.id)?.audiences.includes(audience))
  })).filter(group => group.permissions.length), [groups, policy.permissions, audience]);
  async function change(changes: readonly AccessAdminDeltaInput[], principalId: string, success: string) {
    setBusyId(principalId);
    try { await onApply(changes, success); } finally { setBusyId(null); }
  }
  async function command(principalId: string, run: () => Promise<AccessAdminCommandOutcome>, success: string) {
    setBusyId(principalId);
    try { await onCommand(run, success); } finally { setBusyId(null); }
  }
  return <Card><CardHeader><CardTitle className="text-base">Comptes</CardTitle>
    <CardDescription>Rôles et permissions par compte, contexte et audience. Le compteur décrit la politique avant l’état du compte et la portée du credential. Révoquer toutes les sessions invalide aussi les capacités liées à la version du compte.</CardDescription>
    <div className="flex flex-wrap gap-2 pt-2 text-xs"><label className="flex items-center gap-2">Contexte
      <Select value={contextId} onValueChange={setContextId}><SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
        <SelectContent portalContainer={portalContainer}>{contexts.map(row => <SelectItem key={row.id} value={row.id}>{row.id}</SelectItem>)}</SelectContent></Select></label>
      <label className="flex items-center gap-2">Audience
        <Select value={audience} onValueChange={value => setAudience(value as AccessAdminAudience)}>
          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger><SelectContent portalContainer={portalContainer}>
            <SelectItem value="admin">admin</SelectItem><SelectItem value="app">app</SelectItem>
          </SelectContent></Select></label></div>
    {contexts.find(row => row.id === contextId)?.status === 'disabled' &&
      <p role="status" className="pt-2 text-xs text-amber-700">Contexte désactivé : les décisions de politique affichées ne donnent pas d’accès effectif.</p>}
  </CardHeader><CardContent className="overflow-x-auto"><table className="w-full border-collapse text-sm">
    <thead><tr className="border-b border-slate-200">{['Compte', 'Type', 'Rôles', 'Permissions'].map(label =>
      <th key={label} className="py-2 pr-4 text-left font-medium text-slate-500">{label}</th>)}</tr></thead>
    <tbody>{principals.map(principal => {
      const scope = principalScope(policy, principal.id, contextId, audience, principal.kind);
      const memberActive = scope.membership?.status === 'active';
      const busy = disabled || busyId === principal.id;
      const available = policy.policy.roles.filter(role => !scope.assignmentIds.includes(role.id));
      return <Fragment key={principal.id}><tr className="border-b border-slate-100 last:border-0">
        <td className="py-2 pr-4"><span className="flex items-center gap-2 text-[13px] text-slate-800">
          <UserRound className="h-3.5 w-3.5 text-slate-400" />{principal.displayName}
          {principal.status !== 'active' && <Badge variant="outline">inactif</Badge>}
          {principal.humanStatus === 'pending' && <Badge variant="warning">en attente</Badge>}
        </span><span className="font-mono text-[10px] text-slate-400">{principal.id}</span></td>
        <td className="py-2 pr-4 text-[12px] text-slate-500">{principal.kind === 'service' ? 'Service' : 'Humain'}
          <div className="mt-1 flex flex-wrap gap-1">{principal.kind === 'human' && <>
            <Button variant="outline" size="sm" disabled={busy}
              onClick={() => void command(principal.id, () => controller.setHumanStatus({principalId: principal.id,
                expectedAuthVersion: principal.authVersion, status: principal.status === 'active' ? 'disabled' : 'active'}),
              principal.status === 'active' ? 'Principal suspendu' : 'Principal réactivé ; inscription humaine inchangée')}>
              {principal.status === 'active' ? 'Suspendre' : 'Réactiver le principal'}</Button>
            <Button variant="outline" size="sm" disabled={busy}
              title="Invalide aussi les capacités liées à la version du compte"
              onClick={() => void command(principal.id, () => controller.revokeAllSessions({principalId: principal.id,
                expectedAuthVersion: principal.authVersion}), 'Sessions révoquées')}>Révoquer les sessions</Button>
          </>}</div></td>
        <td className="py-2 pr-4 text-[12px] text-slate-600"><div className="flex flex-wrap gap-1">
          {scope.assignmentIds.map(roleId => <Badge key={roleId} variant="secondary">{roleId}
            <button type="button" disabled={busy} className="ml-1" title={`Retirer ${roleId}`}
              onClick={() => void change([{kind: 'role-assignment', principalId: principal.id, contextId, audience,
                roleId, present: false}], principal.id, 'Rôle retiré')}>×</button></Badge>)}
          {!scope.assignmentIds.length && <span className="text-slate-400">Aucun rôle</span>}
        </div>{!memberActive ? <Button size="sm" variant="outline" disabled={busy} className="mt-1"
          onClick={() => void change([{kind: 'membership', principalId: principal.id, contextId, audience,
            status: 'active'}], principal.id, 'Accès au contexte activé')}>
          {scope.membership ? 'Réactiver dans ce contexte' : 'Activer dans ce contexte'}</Button>
          : <div className="mt-1 flex flex-wrap gap-1"><Select value={DEFAULT_ROLE} disabled={busy || !available.length}
            onValueChange={roleId => { if (roleId !== DEFAULT_ROLE) void change([{kind: 'role-assignment',
              principalId: principal.id, contextId, audience, roleId, present: true}], principal.id, 'Rôle ajouté'); }}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger><SelectContent portalContainer={portalContainer}>
              <SelectItem value={DEFAULT_ROLE} disabled>Ajouter un rôle</SelectItem>
              {available.map(role => <SelectItem key={role.id} value={role.id}>{role.id}</SelectItem>)}
            </SelectContent></Select>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void change([{kind: 'membership',
              principalId: principal.id, contextId, audience, status: 'disabled'}], principal.id, 'Accès au contexte désactivé')}>
              Désactiver ici</Button></div>}</td>
        <td className="py-2 text-[12px] text-slate-500"><button type="button" disabled={busy}
          onClick={() => setExpandedId(current => current === principal.id ? null : principal.id)}
          data-creezio-aid={`access-user-perms-${principal.id}`}
          className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[12px] text-slate-600 hover:bg-slate-50"
          title={scope.effective.join('\n')}>{scope.effective.length} permission{scope.effective.length > 1 ? 's' : ''}
          {scope.overrides.length > 0 && <span className="text-amber-500">({scope.overrides.length} écart{scope.overrides.length > 1 ? 's' : ''})</span>}
          <span className="text-slate-400">{expandedId === principal.id ? '▲' : '▼'}</span></button></td>
      </tr>{expandedId === principal.id && <tr className="border-b border-slate-100"><td colSpan={4} className="space-y-2 py-2">
        <UserPermissionsEditor key={`${principal.id}:${contextId}:${audience}`} principal={principal} policy={policy}
          groups={visibleGroups} contextId={contextId} audience={audience} disabled={busy || !memberActive} onApply={onApply} />
        {principal.kind === 'human' && <SessionsPanel principal={principal} controller={controller} disabled={busy} onCommand={onCommand} />}
      </td></tr>}</Fragment>;
    })}</tbody>
  </table>{next && <Button variant="ghost" size="sm" onClick={onMore}>Autres comptes</Button>}</CardContent></Card>;
}

/** Detailed journal keeps canonical tuple fields and paginates its change rows. */
function AuditPanel({entries, next, controller, onMore}: {entries: readonly AccessAdminAuditEntry[];
  next: AccessAdminAuditCursor | null; controller: AccessAdminController; onMore: () => void}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AccessAdminAuditDetailPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function open(entry: AccessAdminAuditEntry, afterIndex: number | null = null) {
    if (!entry.detailAvailable) return;
    if (openId === entry.id && afterIndex === null) { setOpenId(null); setDetail(null); return; }
    setLoading(true); setError('');
    try {
      const result = await controller.readAuditDetail({auditId: entry.id, limit: 32, afterIndex});
      if (!result.ok) { setError(safeError(result.error)); return; }
      setDetail(previous => afterIndex === null || previous?.auditId !== entry.id ? result.value : {
        ...result.value, changes: [...previous.changes, ...result.value.changes]
      });
      setOpenId(entry.id);
    } catch { setError('Détail indisponible.'); }
    finally { setLoading(false); }
  }
  return <Card><CardHeader><CardTitle className="text-base">Journal d&apos;audit</CardTitle>
    <CardDescription>Derniers changements de rôles et de permissions (plus récents en premier). Les détails anciens restent signalés lorsqu’ils n’existent pas.</CardDescription>
  </CardHeader><CardContent className="overflow-x-auto">
    {error && <p role="alert" className="mb-2 text-xs text-red-700">{error}</p>}
    {!entries.length ? <p className="py-6 text-center text-sm text-slate-400">Aucun changement enregistré.</p>
      : <table className="w-full border-collapse text-sm"><thead><tr className="border-b border-slate-200">
        {['Date', 'Acteur', 'Action', 'Détail'].map(label => <th key={label}
          className="py-2 pr-4 text-left font-medium text-slate-500">{label}</th>)}</tr></thead>
        <tbody>{entries.map(entry => <Fragment key={entry.id}><tr className="border-b border-slate-100 last:border-0">
          <td className="whitespace-nowrap py-1.5 pr-4 text-[12px] text-slate-500">{date(entry.createdAtMs)}</td>
          <td className="py-1.5 pr-4 text-[13px] text-slate-800">{entry.actorDisplayName || entry.principalId}</td>
          <td className="py-1.5 pr-4"><Badge variant="outline" className="text-[11px]">{entry.action}</Badge></td>
          <td className="py-1.5 text-[11px] text-slate-500">{entry.summary}
            {entry.detailAvailable ? <Button variant="ghost" size="sm" disabled={loading}
              onClick={() => void open(entry)}>{openId === entry.id ? 'Masquer' : 'Voir les changements'}</Button>
              : entry.action === 'authorization-updated'
                ? <span className="ml-2 italic">Détail historique indisponible</span> : null}</td>
        </tr>{openId === entry.id && detail && <tr className="border-b border-slate-100"><td colSpan={4} className="p-3">
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs">
            <p className="mb-2 font-medium">Politique : epoch {detail.fromEpoch} → {detail.toEpoch}</p>
            <div className="space-y-1">{detail.changes.map(change => <div key={change.index} className="border-t border-slate-200 py-1">
              <span className="font-semibold">{change.kind}</span>{' · '}
              <span className="font-mono">{[change.principalId, change.contextId, change.audience,
                change.roleId, change.parentRoleId, change.permissionId].filter(Boolean).join(' / ')}</span>{' : '}
              {change.before} → {change.after}
            </div>)}</div>
            {detail.nextAfterIndex !== null && <Button variant="ghost" size="sm" disabled={loading}
              onClick={() => void open(entry, detail.nextAfterIndex)}>Autres changements</Button>}
          </div>
        </td></tr>}</Fragment>)}</tbody></table>}
    {next && <Button variant="ghost" size="sm" onClick={onMore}>Journal précédent</Button>}
  </CardContent></Card>;
}

export function AccessAdminClient({controller, active = true, authorized = true, portalContainer}: {
  controller: AccessAdminController; active?: boolean; authorized?: boolean; portalContainer?: HTMLElement | null;
}) {
  const [snapshot, setSnapshot] = useState(() => controller.getSnapshot());
  const [policy, setPolicy] = useState<AccessAdminPolicyRead | null>(null);
  const [principals, setPrincipals] = useState<readonly AccessAdminPrincipal[]>([]);
  const [principalNext, setPrincipalNext] = useState<string | null>(null);
  const [audit, setAudit] = useState<readonly AccessAdminAuditEntry[]>([]);
  const [auditNext, setAuditNext] = useState<AccessAdminAuditCursor | null>(null);
  const [tab, setTab] = useState('matrix');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const identityVersion = useRef(snapshot.identityVersion);
  useEffect(() => controller.subscribe(() => setSnapshot(controller.getSnapshot())), [controller]);
  useEffect(() => {
    if (snapshot.authorized && authorized && snapshot.identityVersion === identityVersion.current) return;
    generation.current++;
    setLoading(false);
    if (!shouldPurgeAdminView(snapshot, identityVersion.current)) return;
    identityVersion.current = snapshot.identityVersion;
    setPolicy(null); setPrincipals([]); setPrincipalNext(null); setAudit([]); setAuditNext(null);
    setError('Accès réservé (permission creezio.access:manage).');
  }, [snapshot, authorized]);
  const load = useCallback(async () => {
    if (!active || !authorized || !controller.getSnapshot().authorized) return;
    const current = ++generation.current;
    setLoading(true); setError('');
    try {
      const [p, people, journal] = await Promise.all([
        controller.readPolicy(), controller.listPrincipals({kind: 'all', limit: 50, afterId: null}),
        controller.listAudit({limit: 50, before: null})
      ]);
      if (current !== generation.current || !authorized || !controller.getSnapshot().authorized) return;
      if (!p.ok || !people.ok || !journal.ok) {
        setError(safeError(!p.ok ? p.error : !people.ok ? people.error : !journal.ok ? journal.error : 'unavailable'));
        return;
      }
      setPolicy(p.value); setPrincipals(people.value.items); setPrincipalNext(people.value.nextAfterId);
      setAudit(journal.value.items); setAuditNext(journal.value.nextCursor);
    } catch { if (current === generation.current) setError('Chargement impossible — réessayer.'); }
    finally { if (current === generation.current) setLoading(false); }
  }, [controller, active, authorized]);
  useEffect(() => { if (snapshot.authorized && authorized && active) void load(); }, [snapshot.authorized, authorized, active, load]);

  const afterCommand = useCallback(async (outcome: AccessAdminCommandOutcome, success: string) => {
    if (outcome.kind === 'succeeded') { toast.success(success); await load(); return true; }
    if (outcome.kind === 'unknown') { toast.error('Résultat incertain : utilisez « Vérifier la commande » avant une autre action.'); return false; }
    toast.error(safeError(outcome.code));
    if (outcome.code === 'conflict') await load();
    return false;
  }, [load]);
  const onApply: Apply = useCallback(async (changes, success) => {
    if (!policy || !active || !authorized || !snapshot.authorized || snapshot.pendingCommand) return false;
    if (!changes.length || changes.length > MAX_DELTA || new TextEncoder().encode(JSON.stringify({
      expectedEpoch: policy.epoch, changes
    })).byteLength > MAX_DELTA_BYTES) {
      toast.error(`Une commande accepte au plus ${MAX_DELTA} changements et 12 Kio. Réduisez la sélection.`);
      return false;
    }
    return afterCommand(await controller.applyDelta({expectedEpoch: policy.epoch, changes}), success);
  }, [controller, policy, active, authorized, snapshot, afterCommand]);
  const onCommand: Command = useCallback(async (run, success) => {
    if (!active || !authorized || !snapshot.authorized || snapshot.pendingCommand) return false;
    return afterCommand(await run(), success);
  }, [active, authorized, snapshot, afterCommand]);
  async function morePrincipals() {
    if (!principalNext || !authorized || !active) return;
    const current = generation.current;
    const page = await controller.listPrincipals({kind: 'all', limit: 50, afterId: principalNext});
    if (current !== generation.current || !authorized || !controller.getSnapshot().authorized) return;
    if (!page.ok) { toast.error(safeError(page.error)); return; }
    setPrincipals(previous => [...previous, ...page.value.items]); setPrincipalNext(page.value.nextAfterId);
  }
  async function moreAudit() {
    if (!auditNext || !authorized || !active) return;
    const current = generation.current;
    const page = await controller.listAudit({limit: 50, before: auditNext});
    if (current !== generation.current || !authorized || !controller.getSnapshot().authorized) return;
    if (!page.ok) { toast.error(safeError(page.error)); return; }
    setAudit(previous => [...previous, ...page.value.items]); setAuditNext(page.value.nextCursor);
  }
  async function reconcile() {
    const outcome = await controller.reconcilePending();
    if (!outcome) return;
    await afterCommand(outcome, 'Commande confirmée');
  }
  if (loading && !policy) return <div className="flex items-center justify-center py-16 text-slate-400">
    <Loader2 className="mr-2 h-5 w-5 animate-spin" />Chargement…</div>;
  if (error && !policy) return <div className="mx-auto max-w-lg py-16 text-center">
    <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-slate-300" /><p className="text-sm text-slate-500">{error}</p>
    {snapshot.authorized && authorized && <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
      <RefreshCw className="mr-2 h-4 w-4" />Réessayer</Button>}</div>;
  let matrix: MatrixView | null = null;
  try { if (policy) matrix = matrixFromPolicy(policy); }
  catch { return <p role="alert" className="p-6 text-sm text-red-700">Graphe des rôles invalide. Aucune modification n’est possible.</p>; }
  const disabled = !active || !authorized || !snapshot.authorized || !!snapshot.pendingCommand || !!error;
  const visible = active && authorized && snapshot.authorized && snapshot.identityVersion === identityVersion.current;
  return <div className="space-y-4 p-6" hidden={!visible} inert={!visible}><Toaster />
    <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-slate-500" />
      <h1 className="text-lg font-semibold text-slate-900">Rôles &amp; accès</h1>
      <Button variant="outline" size="sm" className="ml-auto" disabled={loading || !active}
        onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button></div>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    {snapshot.pendingCommand && <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      Résultat de commande incertain. Les nouvelles modifications sont suspendues.
      <Button variant="outline" size="sm" className="ml-2" onClick={() => void reconcile()}>Vérifier la commande</Button>
    </div>}
    <Tabs value={tab} onValueChange={setTab}><TabsList>
      <TabsTrigger value="matrix">Matrice des rôles</TabsTrigger>
      <TabsTrigger value="users">Comptes</TabsTrigger>
      <TabsTrigger value="audit">Journal</TabsTrigger>
    </TabsList>
      <TabsContent value="matrix" forceMount hidden={tab !== 'matrix'} className="pt-4">
        {matrix && <MatrixPanel data={matrix} disabled={disabled} onApply={onApply} />}
      </TabsContent>
      <TabsContent value="users" forceMount hidden={tab !== 'users'} className="pt-4">
        {policy && matrix && <UsersPanel principals={principals} next={principalNext} policy={policy} groups={matrix.groups}
          controller={controller} disabled={disabled} onApply={onApply} onCommand={onCommand} onMore={() => void morePrincipals()}
          portalContainer={portalContainer} />}
      </TabsContent>
      <TabsContent value="audit" forceMount hidden={tab !== 'audit'} className="pt-4">
        <AuditPanel entries={audit} next={auditNext} controller={controller} onMore={() => void moreAudit()} />
      </TabsContent>
    </Tabs>
  </div>;
}
