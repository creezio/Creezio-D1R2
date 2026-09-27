'use client';

/** Creezio assistant-widget presentation, retained for native conversations.
 * Transport and identity live in the Conversations SDK controller. */
import {useMemo, useRef, useState} from 'react';
import {Archive, ArchiveRestore, Bot, Check, ChevronDown, Loader2, MessageCircle,
  Paperclip, Plus, Search, Send, Sparkles, X} from 'lucide-react';
import {differenceInCalendarDays, formatDistanceToNow, isToday, isYesterday} from 'date-fns';
import {fr} from 'date-fns/locale';
import {Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger, ScrollArea, cn} from '../../../../sdk/ui/index.ts';
import {AssistantMessageContent} from './message-content';
import {WidgetMessage} from './widget-message';
import type {WidgetMessageContentV1} from '../../../../sdk/widgets/types.ts';
import type {ConversationsController} from '../../../../sdk/conversations/types.ts';
import type {AssistantSource} from './source-links';

export type ConversationMode = 'chat' | 'work';
export type ConversationSummary = Readonly<{id: string; title: string; mode: ConversationMode;
  updatedAt: string; archivedAt: string | null}>;
export type ConversationMessage = Readonly<{id: string; role: 'user' | 'assistant' | 'system';
  content: string; widgetContent?: WidgetMessageContentV1|null;
  sources?: readonly AssistantSource[]; createdAt?: string}>;
export type ConversationModelOption = Readonly<{id: string; label: string}>;
export type ConversationProgressStep = Readonly<{id: string; label: string; state: 'running' | 'done' | 'failed'}>;

export type ConversationPanelProps = Readonly<{
  variant: 'floating' | 'embedded';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ConversationMode;
  onModeChange: (mode: ConversationMode) => void;
  selectedId: string | null;
  selectedTitle?: string;
  selectedArchived?: boolean;
  conversations: readonly ConversationSummary[];
  messages: readonly ConversationMessage[];
  draft: string;
  onDraftChange: (draft: string) => void;
  onWidgetContextAction?: ConversationsController['changeWidgetContext'];
  modelOptions?: readonly ConversationModelOption[];
  selectedModelId?: string | null;
  onModelChange?: (modelId: string) => void;
  onSend?: () => void;
  onStop?: () => void;
  onResume?: () => void;
  turnState?: 'queued' | 'running' | 'cancel_requested' | 'unknown' | null;
  cancelOutcomeUnknown?: boolean;
  assistantPreview?: string;
  progressSteps?: readonly ConversationProgressStep[];
  toolDiagnostics?: string | null;
  onCreate: (mode: ConversationMode) => void;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  showArchived: boolean;
  onShowArchivedChange: (show: boolean) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  hasMoreMessages?: boolean;
  onLoadMoreMessages?: () => void;
  loadingMessages?: boolean;
  onAttach?: (file: File) => void;
  attachments?: readonly {readonly fileId: string; readonly filename: string; readonly byteSize: number}[];
  onDownloadAttachment?: (fileId: string) => void;
  attachmentsNextCursor?: string | null;
  onLoadMoreAttachments?: () => void;
  loadingAttachments?: boolean;
  attachmentState?: {readonly phase: 'uploading' | 'linking' | 'ready' | 'unknown' | 'error'; readonly message: string} | null;
  onRetryUpload?: () => void;
  onReconcileUnknown?: () => void;
  loadingList?: boolean;
  loadingThread?: boolean;
  busy?: boolean;
  error?: string | null;
  onNavigate?: (href: string) => void;
  providerStatus: 'no_provider' | 'checking' | 'unavailable' | 'ready';
}>;

export function groupConversations(list: readonly ConversationSummary[]) {
  const buckets: Record<string, ConversationSummary[]> = {
    "Aujourd'hui": [], Hier: [], '7 derniers jours': [], 'Plus ancien': [],
  };
  for (const conversation of list) {
    const date = new Date(conversation.updatedAt);
    if (Number.isNaN(date.getTime())) buckets['Plus ancien'].push(conversation);
    else if (isToday(date)) buckets["Aujourd'hui"].push(conversation);
    else if (isYesterday(date)) buckets.Hier.push(conversation);
    else if (differenceInCalendarDays(new Date(), date) < 7) buckets['7 derniers jours'].push(conversation);
    else buckets['Plus ancien'].push(conversation);
  }
  return Object.entries(buckets).filter(([, items]) => items.length);
}

export function ConversationPanel(props: ConversationPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const title = props.selectedTitle ?? props.conversations.find(item => item.id === props.selectedId)?.title ?? 'Nouvelle conversation';
  const grouped = useMemo(() => groupConversations(props.conversations.filter(item =>
    props.showArchived ? !!item.archivedAt : !item.archivedAt)), [props.conversations, props.showArchived]);
  if (props.variant === 'floating' && !props.open) return <button type="button" data-creezio-assistant-ui
    data-creezio-assistant-launcher
    onClick={() => props.onOpenChange(true)} aria-label="Ouvrir l'assistant"
    className={cn('fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full',
      'bg-sky-600 text-white shadow-lg shadow-sky-900/25 transition hover:bg-sky-700 hover:shadow-xl',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2')}>
    <span className="relative inline-flex"><MessageCircle className="h-6 w-6" />
      <Sparkles className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 text-amber-200" /></span>
  </button>;

  return <>
    {props.variant === 'floating' && <button type="button" data-creezio-assistant-ui
      className="fixed inset-0 z-40 bg-slate-900/40 md:hidden" aria-label="Fermer l'assistant"
      onClick={() => props.onOpenChange(false)} />}
    <aside data-creezio-assistant-ui data-conversations-panel="open"
      className={cn('flex min-h-0 flex-col border-l border-slate-200 bg-white text-slate-900',
        props.variant === 'floating'
          ? 'fixed inset-y-0 right-0 z-50 h-[100dvh] w-full shadow-xl shadow-slate-900/10 md:w-[400px]'
          : 'relative h-full min-h-[480px] w-full border border-slate-200')}
      role="complementary" aria-label="Assistant Creezio">
      <div className="flex shrink-0 items-center gap-1 border-b border-slate-100 px-2 py-2">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild><button type="button" aria-label="Conversations"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
            <Bot className="h-4 w-4 shrink-0 text-sky-700" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{title}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          </button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[min(70vh,480px)] w-[min(100vw-2rem,340px)] overflow-y-auto">
            <DropdownMenuItem className="gap-2 font-medium" disabled={props.busy}
              onSelect={event => {event.preventDefault(); props.onCreate(props.mode); setMenuOpen(false);}}>
              <Plus className="h-4 w-4" /> Nouvelle conversation
            </DropdownMenuItem>
            <div className="px-2 py-1.5"><label className="sr-only" htmlFor="conversation-search">Rechercher les conversations</label>
              <span className="relative block"><Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-slate-400" />
                <input id="conversation-search" value={props.searchQuery}
                  onChange={event => props.onSearchQueryChange(event.target.value)} placeholder="Rechercher"
                  className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" />
              </span></div>
            <DropdownMenuItem onSelect={event => {event.preventDefault(); props.onShowArchivedChange(!props.showArchived);}}>
              {props.showArchived ? 'Voir les conversations actives' : 'Voir les archives'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {props.loadingList && !props.conversations.length && <div className="px-2 py-3 text-xs text-slate-500">Chargement…</div>}
            {!props.loadingList && !grouped.length && <div className="px-2 py-3 text-xs text-slate-500">
              {props.searchQuery ? 'Aucune conversation trouvée.' : props.showArchived ? 'Aucune archive.' : 'Aucune conversation pour l’instant.'}
            </div>}
            {grouped.map(([label, items]) => <div key={label}>
              <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</DropdownMenuLabel>
              {items.map(conversation => <DropdownMenuItem key={conversation.id} className="group flex items-start gap-2 py-2"
                disabled={props.busy} onSelect={event => event.preventDefault()}
                onClick={event => {
                  if (event.target instanceof Element && event.target.closest('[data-conversation-archive]')) return;
                  props.onSelect(conversation.id); setMenuOpen(false);
                }}>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5">
                  {conversation.id === props.selectedId ? <Check className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                    : <span className="inline-block w-3.5 shrink-0" />}
                  <p className="truncate text-sm font-medium text-slate-800">{conversation.title}</p></div>
                  <p className="mt-0.5 pl-5 truncate text-[11px] text-slate-400">
                    {conversation.mode === 'work' ? 'Work · ' : 'Chat · '}
                    {formatDistanceToNow(new Date(conversation.updatedAt), {addSuffix: true, locale: fr})}
                  </p></div>
                <button type="button" data-conversation-archive
                  className="mt-0.5 rounded p-1 text-slate-400 opacity-0 hover:bg-slate-100 hover:text-sky-700 group-hover:opacity-100 focus:opacity-100"
                  aria-label={`${conversation.archivedAt ? 'Restaurer' : 'Archiver'} la conversation ${conversation.title}`}
                  onPointerDown={event => {event.preventDefault();event.stopPropagation();
                    conversation.archivedAt ? props.onRestore(conversation.id) : props.onArchive(conversation.id);}}
                  onClick={event => {event.preventDefault();event.stopPropagation();
                    if (event.detail === 0) conversation.archivedAt ? props.onRestore(conversation.id) : props.onArchive(conversation.id);}}>
                  {conversation.archivedAt ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                </button>
              </DropdownMenuItem>)}
            </div>)}
            {props.hasMore && <DropdownMenuItem disabled={props.loadingList} onSelect={event => {event.preventDefault();props.onLoadMore();}}>
              {props.loadingList ? 'Chargement…' : 'Afficher davantage'}
            </DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0"
          aria-label="Nouvelle conversation" title="Nouvelle conversation" disabled={props.busy}
          onClick={() => props.onCreate(props.mode)}><Plus className="h-4 w-4" /></Button>
        {props.selectedId && props.selectedArchived && <Button type="button" size="sm" variant="outline"
          disabled={props.busy} onClick={() => props.onRestore(props.selectedId!)}>Restaurer</Button>}
        {props.variant === 'floating' && <Button type="button" variant="ghost" size="icon" aria-label="Fermer l'assistant"
          onClick={() => props.onOpenChange(false)}><X className="h-4 w-4" /></Button>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-100 px-3 py-2">
        {(['chat','work'] as const).map(mode => <button key={mode} type="button" disabled={props.busy}
          aria-pressed={props.mode === mode} onClick={() => props.onModeChange(mode)}
          className={cn('rounded-full px-3 py-1 text-xs font-medium', props.mode === mode
            ? mode === 'work' ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-800'
            : 'text-slate-500 hover:bg-slate-100')}>
          {mode === 'work' ? 'Work' : 'Chat'}
        </button>)}
        {props.providerStatus === 'ready' && <label className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-slate-600">
          <span>Modèle</span>
          <select aria-label="Modèle IA" value={props.selectedModelId ?? ''}
            onChange={event => props.onModelChange?.(event.target.value)}
            disabled={props.busy || !!props.turnState || !props.onModelChange || !props.modelOptions?.length}
            className="max-w-[180px] rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800">
            <option value="">Choisir un modèle</option>
            {props.modelOptions?.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select>
        </label>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1 px-3"><div className="space-y-2.5 py-3">
          {props.loadingThread && <p className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Chargement du fil…</p>}
          {!props.loadingThread && !props.messages.length && <p className="text-xs text-slate-600">
            {props.selectedId ? 'Aucun message dans cette conversation.' : 'Choisissez une conversation ou créez-en une nouvelle.'}
          </p>}
          {props.hasMoreMessages && <button type="button" className="text-xs text-sky-700 underline"
            disabled={props.loadingMessages} onClick={props.onLoadMoreMessages}>
            {props.loadingMessages ? 'Chargement…' : 'Charger les messages précédents'}
          </button>}
          {props.messages.map(message => <div key={message.id}
            className={cn('rounded-xl px-2.5 py-2 text-xs', message.role === 'user'
              ? 'ml-6 bg-slate-900 text-white' : 'mr-2 border border-slate-100 bg-slate-50 text-slate-800')}>
            {message.widgetContent && props.selectedId ? <>
              {message.content && <div className="mb-1 whitespace-pre-wrap leading-relaxed">{message.content}</div>}
              <WidgetMessage content={message.widgetContent} messageId={message.id}
                conversationId={props.selectedId} active={props.open && !props.selectedArchived}
                onProposeText={props.onDraftChange} onContextAction={props.onWidgetContextAction} />
            </> : message.role === 'user' ? <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
              : <AssistantMessageContent content={message.content} sources={[...(message.sources ?? [])]}
                onNavigate={props.onNavigate} />}
          </div>)}
          {!!props.progressSteps?.length && <ol aria-label="Étapes du tour" className="space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs text-slate-600">
            {props.progressSteps.map(step => <li key={step.id} className="flex items-center gap-2">
              {step.state === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {step.state === 'done' && <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />}
              {step.state === 'failed' && <X className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />}
              <span>{step.label}</span>
            </li>)}
          </ol>}
          {props.toolDiagnostics && <p role="status" className="text-xs text-slate-600">{props.toolDiagnostics}</p>}
          {props.assistantPreview && <div role="status" aria-label="Réponse en cours"
            className="mr-2 rounded-xl border border-sky-100 bg-sky-50 px-2.5 py-2 text-xs text-slate-800">
            <AssistantMessageContent content={props.assistantPreview} sources={[]} onNavigate={props.onNavigate} />
          </div>}
          {!!props.attachments?.length && <section aria-label="Pièces jointes" className="rounded-lg border border-slate-200 p-2">
            <p className="mb-1 text-[11px] font-medium text-slate-500">Pièces jointes</p>
            {props.attachments.map(file => <button key={file.fileId} type="button"
              className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs text-sky-700 hover:bg-sky-50"
              onClick={() => props.onDownloadAttachment?.(file.fileId)}>
              <Paperclip className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{file.filename}</span>
              <span className="text-slate-500">{Math.ceil(file.byteSize / 1024)} Ko</span>
            </button>)}
          </section>}
          {props.loadingAttachments && <p role="status" className="text-xs text-slate-500">Chargement des pièces jointes…</p>}
          {props.attachmentsNextCursor && <button type="button" className="text-xs text-sky-700 underline"
            disabled={props.loadingAttachments} onClick={props.onLoadMoreAttachments}>Afficher davantage de pièces jointes</button>}
        </div></ScrollArea>
        <div className="shrink-0 border-t border-slate-100 p-2.5">
          {props.providerStatus === 'no_provider' && <div role="status"
            className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-950">
            <p className="font-medium">Fournisseur IA non configuré</p>
            <p className="mt-0.5 text-amber-900/90">Les conversations et brouillons restent disponibles. L’envoi IA sera activé avec un fournisseur configuré.</p>
          </div>}
          {props.providerStatus === 'checking' && <p role="status" className="mb-2 text-xs text-slate-600">
            Vérification du fournisseur IA…</p>}
          {props.providerStatus === 'unavailable' && <p role="status" className="mb-2 text-xs text-amber-900">
            Le fournisseur IA est momentanément indisponible. Les conversations et brouillons restent accessibles.</p>}
          {props.selectedArchived && <p role="status" className="mb-2 text-xs text-slate-600">
            Cette conversation est archivée. Restaurez-la pour modifier son brouillon ou joindre un fichier.</p>}
          {props.error && <p role="alert" className="mb-2 text-xs text-red-700">{props.error}</p>}
          {props.attachmentState && <p role={props.attachmentState.phase === 'error' || props.attachmentState.phase === 'unknown' ? 'alert' : 'status'}
            className="mb-2 text-xs text-slate-600">{props.attachmentState.message}</p>}
          {props.onRetryUpload && <Button type="button" size="sm" variant="outline" className="mb-2"
            onClick={props.onRetryUpload}>Reprendre le téléversement</Button>}
          {props.onReconcileUnknown && <Button type="button" size="sm" variant="outline"
            className="mb-2" onClick={props.onReconcileUnknown}>Vérifier l’opération en attente</Button>}
          {props.turnState && <p role="status" className="mb-2 text-xs text-slate-600">
            {props.turnState === 'queued' ? 'Tour en attente.' : props.turnState === 'running' ? 'Réponse en cours…'
              : props.turnState === 'cancel_requested' ? 'Arrêt demandé ; confirmation en attente.'
              : props.cancelOutcomeUnknown ? 'Arrêt demandé ; résultat fournisseur inconnu, impossible de confirmer l’arrêt.'
              : 'État du tour incertain ; vérifiez ou reprenez explicitement.'}
          </p>}
          {props.onResume && <Button type="button" size="sm" variant="outline" className="mb-2"
            onClick={props.onResume}>Reprendre le tour</Button>}
          <form className="flex items-center gap-1.5" onSubmit={event => {event.preventDefault();props.onSend?.();}}>
            {props.onAttach && <><input ref={fileInput} type="file" className="sr-only" tabIndex={-1}
              accept="text/plain,application/pdf,image/png,image/jpeg"
              aria-label="Choisir une pièce jointe" onChange={event => {
                const file = event.target.files?.[0]; event.target.value = '';
                if (file) props.onAttach?.(file);
              }} />
              <Button type="button" size="icon" variant="ghost" aria-label="Ajouter une pièce jointe"
                title="Ajouter une pièce jointe" disabled={!props.selectedId || !!props.busy ||
                  !!props.selectedArchived || !!props.onRetryUpload ||
                  props.attachmentState?.phase === 'uploading' || props.attachmentState?.phase === 'linking'}
                onClick={() => fileInput.current?.click()}><Paperclip className="h-4 w-4" /></Button></>}
            <input value={props.draft} maxLength={16000} disabled={!props.selectedId || !!props.selectedArchived}
              onChange={event => props.onDraftChange(event.target.value)}
              aria-label="Brouillon de message" placeholder="Écrivez un message…"
              className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400" />
            {props.turnState && props.onStop ? <Button type="button" size="icon" variant="outline"
              disabled={props.turnState === 'cancel_requested' || props.busy}
              onClick={props.onStop} aria-label="Arrêter la réponse" title="Demander l’arrêt de la réponse">
              <X className="h-4 w-4" />
            </Button> : <Button type="submit" size="icon"
              disabled={!props.onSend || props.providerStatus !== 'ready' || !props.selectedModelId ||
                !props.modelOptions?.some(model => model.id === props.selectedModelId) ||
                !props.selectedId || !!props.selectedArchived || !!props.busy || !!props.turnState || !props.draft.trim()}
              aria-label={props.providerStatus === 'ready' ? 'Envoyer le message' : 'Envoyer — fournisseur indisponible'}
              title={props.providerStatus === 'ready' ? 'Envoyer le message'
                :props.providerStatus === 'no_provider'?'Fournisseur IA non configuré':'Fournisseur IA indisponible'}>
              <Send className="h-4 w-4" />
            </Button>}
          </form>
        </div>
      </div>
    </aside>
  </>;
}
