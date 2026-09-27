'use client';

/** Installed-document cards follow Product Hub's PRD, Documents and Changelog layout. */
import {Loader2} from 'lucide-react';
import {Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle} from '../../../../sdk/ui/index.ts';
import type {InstalledModuleDocument, InstalledModuleDocumentMetadata} from '../../../../sdk/modules/documents.ts';

export type InstalledDocumentKind = 'readme' | 'prd' | 'changelog';

const labels: Record<InstalledDocumentKind, string> = {
  readme: 'README', prd: 'PRD', changelog: 'Changelog',
};
const titles: Record<InstalledDocumentKind, string> = {
  readme: 'Documentation du module', prd: 'Product Requirements Document',
  changelog: 'Changelog',
};
const empty: Record<InstalledDocumentKind, string> = {
  readme: 'Aucun README dans cette version installée.',
  prd: 'Aucun PRD dans cette version installée.',
  changelog: 'Aucun changelog dans cette version installée.',
};
const short = (value: string) => value.length > 24 ? `${value.slice(0, 20)}…` : value;

export function sameInstalledDocument(metadata: InstalledModuleDocumentMetadata,
  document: InstalledModuleDocument | null): boolean {
  return !!document && document.moduleId === metadata.moduleId && document.kind === metadata.kind
    && document.origin === metadata.origin && document.version === metadata.version
    && document.sourceRevision === metadata.sourceRevision
    && document.runtimeIntegrity === metadata.runtimeIntegrity && document.path === metadata.path
    && document.digest === metadata.digest && document.byteLength === metadata.byteLength
    && document.blockCount === metadata.blockCount;
}

export function InstalledDocumentCard({kind, metadata, document, loading, error, onRetry}: {
  kind: InstalledDocumentKind;
  metadata: InstalledModuleDocumentMetadata | null;
  document: InstalledModuleDocument | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  return <Card>
    <CardHeader>
      <CardTitle className="flex flex-wrap items-center gap-2 text-base">{titles[kind]}
        {metadata && <Badge variant="secondary">v{metadata.version}</Badge>}
        {metadata && <Badge variant="outline">Version installée</Badge>}
      </CardTitle>
      <CardDescription>{metadata ? <>
        <span>Source : {metadata.origin} · révision {metadata.sourceRevision}</span>
        <span className="mt-1 block font-mono text-xs">Runtime {short(metadata.runtimeIntegrity)} · document {short(metadata.digest)}</span>
      </> : 'Document déclaré par la version réellement installée du module.'}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {!metadata && <p className="text-sm text-slate-500">{empty[kind]}</p>}
      {metadata && loading && <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />Lecture de la version installée…</p>}
      {metadata && error && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-700">
        <span>{error}</span><Button size="sm" variant="outline" onClick={onRetry}>Réessayer</Button></div>}
      {metadata && !loading && !error && sameInstalledDocument(metadata, document)
        && <p className="whitespace-pre-line break-words text-sm text-slate-700">{document!.content}</p>}
      {metadata && !loading && !error && !sameInstalledDocument(metadata, document)
        && <p className="text-sm text-slate-500">Sélectionnez Lire pour afficher ce document installé.</p>}
    </CardContent>
  </Card>;
}

export function InstalledDocumentsPanel({documents, selected, loaded, loading, error, onSelect, onRetry}: {
  documents: readonly InstalledModuleDocumentMetadata[];
  selected: InstalledDocumentKind | null;
  loaded: InstalledModuleDocument | null;
  loading: boolean;
  error: string;
  onSelect: (kind: InstalledDocumentKind) => void;
  onRetry: () => void;
}) {
  const selectedMetadata = documents.find(item => item.kind === selected) ?? null;
  return <div className="space-y-3">
    <Card><CardContent className="space-y-3 p-4">
      <p className="text-sm text-slate-600">Documents de la version installée. Les révisions de travail et le journal des plans restent distincts.</p>
      {documents.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr className="border-b text-xs text-slate-500"><th className="p-2">Fichier</th>
          <th className="p-2">Taille</th><th className="p-2">Accès</th><th className="p-2">Version</th><th className="p-2" /></tr></thead>
        <tbody>{documents.map(item => <tr key={item.kind} className="border-b last:border-0">
          <td className="p-2"><span className="font-medium">{labels[item.kind]}</span>
            <span className="block break-all text-xs text-slate-500">{item.path}</span></td>
          <td className="p-2">{Math.max(1, Math.ceil(item.byteLength / 1024))} Ko</td>
          <td className="p-2"><Badge variant="secondary">{item.visibility === 'restricted' ? 'Restreint' : 'Public'}</Badge></td>
          <td className="p-2">v{item.version}</td>
          <td className="p-2"><Button size="sm" variant="ghost" disabled={loading && selected === item.kind}
            onClick={() => onSelect(item.kind)}
            aria-label={`Lire ${labels[item.kind]} installé`}>Lire</Button></td>
        </tr>)}</tbody>
      </table></div> : <p className="text-sm text-slate-500">Aucun document installé pour ce module.</p>}
    </CardContent></Card>
    {selected && <InstalledDocumentCard kind={selected} metadata={selectedMetadata} document={loaded}
      loading={loading} error={error} onRetry={onRetry} />}
  </div>;
}
