'use client';

/** Product Hub cards adapted to the verified Creezio module catalogue. */
import { GitBranch, History, Puzzle, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../sdk/ui/index.ts';
import type { ModuleCatalogItem, ModuleDependency, ModuleDiagnostic, ModuleJournalEntry,
  ModulePlanPreview } from '../../../../sdk/module-settings/types.ts';

function date(ms: number) { return Number.isFinite(ms) ? new Date(ms).toLocaleString('fr-FR') : '—'; }
function shortDigest(value: string) { return value.length > 22 ? `${value.slice(0, 18)}…` : value; }

/** A display-only label that fits the workspace metadata contract. */
export function moduleWorkspaceLabel(title: string, moduleId: string): string {
  let cleaned = '';
  for (const scalar of title.replace(/\s+/gu, ' ').trim()) {
    const code = scalar.codePointAt(0)!;
    if (scalar.length === 1 && code >= 0xD800 && code <= 0xDFFF) cleaned += '\uFFFD';
    else if (!/\p{Cc}/u.test(scalar)) cleaned += scalar;
  }
  const value = cleaned.replace(/\s+/gu, ' ').trim() || moduleId;
  if (value.length <= 200) return value;
  let shortened = '';
  for (const scalar of value) {
    if (shortened.length + scalar.length > 199) break;
    shortened += scalar;
  }
  return `${shortened.trimEnd()}…`;
}

export function ModuleStatus({item}: {item: ModuleCatalogItem}) {
  return <span className="flex flex-wrap gap-1.5" aria-label={`État de ${item.moduleId}`}>
    <Badge variant={item.visibility === 'current' ? 'info' : 'secondary'}>
      {item.visibility === 'current' ? 'Sélectionné' : 'Disponible au catalogue'}
    </Badge>
    <Badge variant={item.codePresent ? 'success' : 'muted'}>
      {item.codePresent ? 'Présent dans la livraison' : 'Absent de la livraison'}
    </Badge>
    {item.codePresent && <Badge variant={item.enabled ? 'success' : 'warning'}>
      {item.enabled ? 'Activé' : 'Désactivé'}
    </Badge>}
    {item.enabled && <Badge variant={item.configuration === 'ready' ? 'success' : 'warning'}>
      {item.configuration === 'ready' ? 'Configuré' : item.configuration === 'missing' ? 'Configuration manquante' : 'Configuration inconnue'}
    </Badge>}
    {item.enabled && <Badge variant={item.operational === 'ready' ? 'success' : item.operational === 'unavailable' ? 'danger' : 'muted'}>
      {item.operational === 'ready' ? 'Opérationnel' : item.operational === 'unavailable' ? 'Indisponible' : 'Fonctionnement non vérifié'}
    </Badge>}
  </span>;
}

export function CatalogCards({items, onOpen}: {items: readonly ModuleCatalogItem[]; onOpen: (moduleId: string) => void}) {
  if (!items.length) return <p className="rounded-md border border-dashed p-5 text-sm text-slate-500">Aucun module dans cette page du catalogue.</p>;
  return <ul className="space-y-2">{items.map(item => <li key={item.moduleId} className="rounded-md border border-slate-200 px-4 py-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-2">
        <div><h3 className="font-medium text-slate-900">{item.title}</h3>
          <p className="font-mono text-xs text-slate-500">{item.moduleId} · v{item.version}</p></div>
        {item.description && <p className="text-sm text-slate-600">{item.description}</p>}
        <p className="flex items-center gap-1 text-xs text-slate-500"><GitBranch aria-hidden="true" className="h-3.5 w-3.5" />Origine : {item.origin}</p>
        <ModuleStatus item={item} />
      </div>
      <Button size="sm" variant="outline" onClick={() => onOpen(item.moduleId)} aria-label={`Voir la fiche de ${item.title}`}>Voir la fiche</Button>
    </div>
  </li>)}</ul>;
}

export function DependencyCard({title, description, items}: {title: string; description: string; items: readonly ModuleDependency[]}) {
  return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
    <CardContent>{items.length ? <ul className="space-y-2">{items.map((item, index) => <li key={`${item.moduleId}:${index}`} className="rounded-md border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="font-mono text-xs">{item.moduleId}</strong>
        <span className="flex gap-1"><Badge variant={item.required ? 'outline' : 'info'}>{item.required ? 'Obligatoire' : 'Facultative'}</Badge>
          <Badge variant={item.active ? 'success' : 'muted'}>{item.active ? 'Active' : 'Inactive'}</Badge></span></div>
      <p className="mt-1 text-xs text-slate-600">Versions : {item.versionRange}</p>
      {item.via.length > 0 && <p className="mt-1 text-xs text-slate-500">Chaîne : {item.via.join(' → ')}</p>}
    </li>)}</ul> : <p className="text-sm text-slate-500">Aucune relation déclarée dans ce sens.</p>}</CardContent>
  </Card>;
}

export function DiagnosticCard({items}: {items: readonly ModuleDiagnostic[]}) {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck aria-hidden="true" className="h-4 w-4" /> Diagnostics</CardTitle>
    <CardDescription>Compatibilité, configuration et disponibilité vérifiées par le serveur.</CardDescription></CardHeader>
    <CardContent>{items.length ? <ul className="space-y-2">{items.map((item, index) => <li key={`${item.code}:${item.moduleId ?? ''}:${index}`}
      className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm">
      <Badge variant={item.severity === 'error' ? 'danger' : item.severity === 'warning' ? 'warning' : 'info'}>
        {item.severity === 'error' ? 'Bloquant' : item.severity === 'warning' ? 'Attention' : 'Information'}
      </Badge><span>{item.message}{item.moduleId && <span className="block font-mono text-xs text-slate-500">{item.moduleId}</span>}</span>
    </li>)}</ul> : <p className="text-sm text-slate-500">Aucun diagnostic signalé.</p>}</CardContent>
  </Card>;
}

const actionLabel: Record<string, string> = {add: 'Ajouter', update: 'Mettre à jour', enable: 'Activer', disable: 'Désactiver',
  remove: 'Retirer', configure: 'Configurer', integration: 'Intégration facultative'};
function audienceLabel(audiences: readonly ('admin' | 'app')[]) {
  if (!audiences.length) return 'Sans interface (headless)';
  if (audiences.includes('admin') && audiences.includes('app')) return 'Administrateur et utilisateurs';
  return audiences.includes('admin') ? 'Administrateur' : 'Utilisateurs';
}
export function PlanPreviewCard({plan, onAccept, disabled}: {plan: ModulePlanPreview; onAccept: () => void; disabled: boolean}) {
  const blocked = plan.diagnostics.some(item => item.severity === 'error');
  return <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Puzzle aria-hidden="true" className="h-4 w-4" /> Plan de changement</CardTitle>
    <CardDescription>Révision {plan.baseRevision} · Plan {shortDigest(plan.planDigest)}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {plan.actions.length ? <ul className="space-y-2">{plan.actions.map((item, index) => <li key={`${item.moduleId}:${item.kind}:${index}`}
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-3 text-sm">
        <span><strong>{actionLabel[item.kind] ?? item.kind}</strong> <code className="text-xs">{item.moduleId}</code>
          <span className="block text-xs text-slate-500">{item.fromVersion ?? 'absent'} → {item.toVersion ?? 'absent'}</span>
          {item.audiences && <span className="block text-xs text-slate-600">Interface prévue : {audienceLabel(item.audiences)}</span>}</span>
        {item.requiresPublication && <Badge variant="warning">Publication nécessaire</Badge>}
      </li>)}</ul> : <p className="text-sm text-slate-500">Aucun changement dans ce plan.</p>}
      <DiagnosticCard items={plan.diagnostics} />
      {plan.disabledContributionCount > 0 && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {plan.disabledContributionCount} contribution(s) seront désactivées par ce plan. Vérifiez les modules dépendants et les intégrations facultatives avant d’accepter.
      </p>}
      <p className="text-xs text-slate-500">Composition cible : <code>{shortDigest(plan.targetCompositionDigest)}</code><br />
        Verrou cible : <code>{shortDigest(plan.targetLockDigest)}</code></p>
      {plan.requiresPublication && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        L’acceptation enregistrera la demande. Le module ne sera installé ou activé qu’après construction et publication vérifiées.
      </p>}
      {!plan.requiresPublication && !blocked && plan.actions.length > 0 && <p role="status" className="text-sm text-slate-600">
        Ce plan ne change ni la composition ni le verrou. Il n’y a rien à accepter.
      </p>}
      <Button onClick={onAccept} disabled={disabled || blocked || !plan.requiresPublication || plan.actions.length === 0}>Accepter le plan</Button>
    </CardContent></Card>;
}

export function JournalCard({items, onOpen}: {items: readonly ModuleJournalEntry[]; onOpen?: (planId: string) => void}) {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><History aria-hidden="true" className="h-4 w-4" /> Journal des plans</CardTitle>
    <CardDescription>Demandes acceptées, distinctes des versions effectivement publiées.</CardDescription></CardHeader>
    <CardContent>{items.length ? <ol className="space-y-2">{items.map(item => <li key={`${item.revision}:${item.planId}`} className="rounded-md border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>Révision {item.revision}</strong><Badge variant="info">Plan accepté</Badge></div>
      <p className="font-mono text-xs text-slate-500">{item.planId}</p>
      <p className="text-xs text-slate-500">{date(item.occurredAtMs)}</p>
      {onOpen && <Button size="sm" variant="ghost" onClick={() => onOpen(item.planId)}>Voir le plan</Button>}
    </li>)}</ol> : <p className="text-sm text-slate-500">Aucun plan accepté.</p>}</CardContent>
  </Card>;
}
