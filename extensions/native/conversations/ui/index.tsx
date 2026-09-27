'use client';

import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import type {WorkspaceViewProps} from '../../../../sdk/workspace/types.ts';
import {createConversationsController} from '../../../../sdk/conversations/controller.ts';
import type {ConversationsController, ConversationsSnapshot, ConversationActionResult,
  ConversationAttachment, ConversationDraft} from '../../../../sdk/conversations/types.ts';
import {createFileClient} from '../../../../sdk/files/client.ts';
import type {StagedFileReference} from '../../../../sdk/files/types.ts';
import {useAssistantUiOptional} from '../../../../sdk/ui/assistant-provider.tsx';
import {ConversationPanel, type ConversationMode, type ConversationPanelProps} from './panel.tsx';

type AttachmentState = NonNullable<ConversationPanelProps['attachmentState']>;
type Binding = {controller: ConversationsController; snapshot: ConversationsSnapshot;
  access: WorkspaceViewProps['access']; client: WorkspaceViewProps['client'];
  contextId: string; audience: WorkspaceViewProps['audience']; sessionId: string};

function feedback(result: ConversationActionResult<unknown>): string | null {
  if (result.kind === 'ok') return null;
  if (result.kind === 'unknown') return 'Le résultat de cette opération reste incertain. Vérifiez son état avant de réessayer.';
  if (result.code === 'stale' || result.code === 'conflict') return 'La conversation a changé. Actualisez-la et réessayez.';
  if (result.code === 'forbidden' || result.code === 'unauthorized') return 'Vous n’avez plus accès à cette conversation.';
  if (result.code === 'rate_limited') return 'Trop de demandes. Réessayez plus tard.';
  return 'L’opération a échoué. Réessayez après actualisation.';
}

function useConversations(props: WorkspaceViewProps) {
  const accessSnapshot = useSyncExternalStore(props.access.subscribe, props.access.getSnapshot, props.access.getSnapshot);
  const sessionId = accessSnapshot.phase === 'authenticated' && !accessSnapshot.pending ? accessSnapshot.session?.id ?? '' : '';
  const [binding, setBinding] = useState<Binding | null>(null);
  const live = useRef<ConversationsController | null>(null);
  useEffect(() => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(props.contextId)) return;
    const controller = createConversationsController({access: props.access, client: props.client,
      audience: props.audience, contextId: props.contextId});
    live.current = controller;
    let current = true;
    const publish = () => {
      if (current) setBinding({controller, snapshot: controller.getSnapshot(), access: props.access,
        client: props.client, contextId: props.contextId, audience: props.audience,
        sessionId: props.access.getSnapshot().session?.id ?? ''});
    };
    const unsubscribe = controller.subscribe(publish);
    publish();
    return () => {current = false; unsubscribe(); controller.dispose();
      if (live.current === controller) live.current = null;};
  }, [props.access, props.client, props.audience, props.contextId]);
  const retained = binding?.controller === live.current && binding.access === props.access &&
    binding.client === props.client && binding.contextId === props.contextId &&
    binding.audience === props.audience ? binding.controller : null;
  useEffect(() => {
    if (!retained) return;
    const active = props.active && props.authorized && !!sessionId;
    retained.setActive(active);
    if (active) void retained.refresh();
  }, [retained, props.active, props.authorized, sessionId]);
  const requested = useRef<{controller: ConversationsController; id: string} | null>(null);
  useEffect(() => {
    const id = props.input.conversationId;
    if (!retained || !props.active || !props.authorized || !sessionId || !id ||
      requested.current?.controller === retained && requested.current.id === id) return;
    requested.current = {controller:retained,id};
    void retained.open(id);
  }, [retained, props.active, props.authorized, sessionId, props.input.conversationId]);
  const current = binding?.controller === live.current && binding.access === props.access &&
    binding.client === props.client && binding.contextId === props.contextId &&
    binding.audience === props.audience && binding.sessionId === sessionId && props.active && props.authorized;
  return {controller: current ? binding.controller : null, snapshot: current ? binding.snapshot : null,
    retained, sessionId, accessPhase:accessSnapshot.phase, live};
}

function ConversationsView(props: WorkspaceViewProps & {readonly surface: 'admin' | 'front'}) {
  const {controller, snapshot, retained, sessionId, live, accessPhase} = useConversations(props);
  const activity = useRef(false);
  const activityEpoch = useRef(0);
  const activeNow = props.active && props.authorized && !!sessionId;
  if (activity.current !== activeNow) activityEpoch.current++;
  activity.current = activeNow;
  const assistantUi = useAssistantUiOptional();
  const floating = props.surface === 'admin' && props.input.presentation === 'assistant' && !!assistantUi;
  const [mode, setMode] = useState<ConversationMode>('chat');
  const [query, setQuery] = useState('');
  const [busyList, setBusyList] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [attachmentState, setAttachmentState] = useState<AttachmentState | null>(null);
  const [attachments, setAttachments] = useState<readonly ConversationAttachment[]>([]);
  const [attachmentsNextCursor, setAttachmentsNextCursor] = useState<string | null>(null);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const pendingUpload = useRef<{file: File; intentId: string; conversationId: string; sessionId: string} | null>(null);
  const pendingLink = useRef<{reference: StagedFileReference; conversationId: string; sessionId: string} | null>(null);
  const objectUrls = useRef(new Set<string>());
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRequested = useRef<{id: string; text: string} | null>(null);
  const draftSaving = useRef<{controller: ConversationsController; id: string;
    promise: Promise<ConversationActionResult<ConversationDraft>>} | null>(null);
  const transitionBusy = useRef(false);
  const resumeDraft = useRef<((id: string) => void) | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setQuery(''); setNotice(null); setAttachmentState(null);
    return () => {
      pendingUpload.current = null;
      pendingLink.current = null;
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current.clear();
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftRequested.current = null;
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [retained]);
  useEffect(() => {
    if (accessPhase === 'anonymous') {
      pendingUpload.current = null;
      pendingLink.current = null;
      setAttachments([]);
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current.clear();
      setAttachmentState(null);
    }
  }, [accessPhase]);
  useEffect(() => {
    if (!controller || !snapshot || query === snapshot.searchQuery) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setBusyList(true);
      void controller.search({query, archived: controller.getSnapshot().archived}).finally(() => setBusyList(false));
    }, 250);
    return () => {if (searchTimer.current) clearTimeout(searchTimer.current);};
  }, [controller, query, snapshot?.searchQuery]);
  const selectedIdForEffect = snapshot?.selected?.id ?? null;
  useEffect(() => {
    const wanted = draftRequested.current;
    if (!controller || !activity.current || !selectedIdForEffect || wanted?.id !== selectedIdForEffect) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => resumeDraft.current?.(wanted.id), 200);
  }, [controller, selectedIdForEffect]);
  useEffect(() => {
    setAttachments([]); setAttachmentsNextCursor(null);
    if (!controller || !selectedIdForEffect) return;
    let current = true;
    setLoadingAttachments(true);
    void controller.listAttachments(selectedIdForEffect).then(page => {
      if (current && page) {setAttachments(page.items);setAttachmentsNextCursor(page.nextCursor);}
    }).finally(() => {if (current) setLoadingAttachments(false);});
    return () => {current = false;};
  }, [controller, selectedIdForEffect]);

  if (!controller || !snapshot || snapshot.phase !== 'ready') return floating ? null :
    <p role="status" className="p-4 text-sm text-slate-600">Chargement des conversations…</p>;

  const selectedId = snapshot.selected?.id ?? null;
  const ready = (result: ConversationActionResult<unknown>, refresh = true) => {
    if (live.current !== controller) return;
    setNotice(feedback(result));
    if (result.kind === 'ok' && refresh) void controller.refresh();
  };
  const flushDraft = async (id: string): Promise<boolean> => {
    const wanted = draftRequested.current;
    if (!wanted) return true;
    if (wanted.id !== id || live.current !== controller ||
      controller.getSnapshot().selected?.id !== id || controller.getSnapshot().unknown || !activity.current) return false;
    const inFlight = draftSaving.current;
    if (inFlight?.controller === controller) {
      await inFlight.promise;
      return draftRequested.current?.id === id ? flushDraft(id) : !draftRequested.current;
    }
    if (controller.getSnapshot().pending) {
      draftTimer.current = setTimeout(() => {void flushDraft(id);}, 600);
      return false;
    }
    const epoch = activityEpoch.current;
    const promise = controller.saveDraft(id, wanted.text);
    draftSaving.current = {controller,id,promise};
    const result = await promise;
    if (draftSaving.current?.promise === promise) draftSaving.current = null;
    if (activity.current && activityEpoch.current === epoch) ready(result, false);
    const latest = draftRequested.current;
    if (result.kind === 'ok' && latest?.id === id) {
      if (latest.text === wanted.text) draftRequested.current = null;
      else if (activity.current && activityEpoch.current === epoch) return flushDraft(id);
    }
    return result.kind === 'ok' && !draftRequested.current;
  };
  resumeDraft.current = id => {void flushDraft(id);};
  const beforeTransition = async (action: () => void | Promise<void>) => {
    if (transitionBusy.current) return;
    transitionBusy.current = true;
    try {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      if (selectedId && !await flushDraft(selectedId)) return;
      if (live.current === controller && activity.current) await action();
    } finally {transitionBusy.current = false;}
  };
  const uploadPending = async (pending: NonNullable<typeof pendingUpload.current>) => {
    const {file, conversationId, intentId} = pending;
    if (pendingUpload.current !== pending || controller.getSnapshot().pending || controller.getSnapshot().unknown) return;
    if (file.size > 10 * 1024 * 1024) {
      pendingUpload.current = null;
      setAttachmentState({phase:'error', message:'La pièce jointe dépasse la limite de 10 Mo.'}); return;
    }
    const sameScope = () => live.current === controller &&
      props.access.getSnapshot().session?.id === pending.sessionId &&
      pendingUpload.current === pending;
    const current = () => sameScope() && activity.current &&
      controller.getSnapshot().selected?.id === conversationId;
    const files = createFileClient({access: props.access, moduleId:'creezio.conversations',
      categoryId:'attachments', contextId: props.contextId});
    setAttachmentState({phase:'uploading', message:`Téléversement de ${file.name}…`});
    const uploaded = await files.upload({file, filename:file.name, intentId, generation:'1', isCurrent:current});
    if (!sameScope()) return;
    if (!activity.current || controller.getSnapshot().selected?.id !== conversationId) {
      setAttachmentState({phase:'unknown',
        message:'Le téléversement a été interrompu. Revenez à cette conversation et reprenez explicitement avec la même intention.'});
      return;
    }
    if (uploaded.kind !== 'ready') {
      if (uploaded.kind === 'rejected') pendingUpload.current = null;
      setAttachmentState({phase:uploaded.kind === 'unknown' ? 'unknown' : 'error',
        message:uploaded.kind === 'unknown'
          ? 'Le résultat du téléversement est incertain. Reprenez explicitement avec le même fichier et la même intention.'
          : 'Le téléversement a été refusé.'});
      return;
    }
    pendingUpload.current = null;
    pendingLink.current = {reference:uploaded.value.reference,conversationId,sessionId:pending.sessionId};
    setAttachmentState({phase:'linking', message:`Association de ${file.name} à la conversation…`});
    const linked = await controller.linkAttachment(conversationId, uploaded.value.reference);
    if (live.current !== controller || props.access.getSnapshot().session?.id !== pending.sessionId) return;
    if (!activity.current) {
      setAttachmentState({phase:'unknown',
        message:'Le résultat de l’association est incertain après l’interruption. Vérifiez l’opération avant de réessayer.'});
      return;
    }
    if (linked.kind === 'ok') {
      pendingLink.current = null;
      setAttachmentState({phase:'ready', message:`${file.name} est joint à la conversation.`});
      const page = await controller.listAttachments(conversationId);
      if (page && live.current === controller && controller.getSnapshot().selected?.id === conversationId) {
        setAttachments(page.items); setAttachmentsNextCursor(page.nextCursor);
      }
    } else if (linked.kind === 'unknown') {
      setAttachmentState({phase:'unknown', message:'Le résultat de l’association est incertain. Vérifiez cette opération avant de réessayer.'});
    } else {
      pendingLink.current = null;
      setAttachmentState({phase:'error', message:feedback(linked) ?? 'Impossible de joindre le fichier.'});
      void files.abandon(uploaded.value.reference, () => live.current === controller &&
        props.access.getSnapshot().session?.id === pending.sessionId);
    }
  };
  const onAttach = (file: File) => {
    if (!selectedId || !activity.current || snapshot.pending || snapshot.unknown || pendingUpload.current) return;
    const pending = {file, intentId:crypto.randomUUID(), conversationId:selectedId, sessionId};
    pendingUpload.current = pending;
    void uploadPending(pending);
  };
  const content = <ConversationPanel variant={floating ? 'floating' : 'embedded'}
    open={floating ? !!assistantUi?.open : true} onOpenChange={open => assistantUi?.setOpen(open)}
    mode={snapshot.selected?.mode ?? mode} onModeChange={next => {void beforeTransition(async () => {
      setMode(next);
      if (snapshot.selected?.mode !== next) {
        const result = await controller.create({mode:next});
        ready(result); if (result.kind === 'ok') await controller.open(result.value.id);
      }
    });}}
    selectedId={selectedId} selectedTitle={snapshot.selected?.title}
    selectedArchived={!!snapshot.selected?.archivedAt} conversations={snapshot.conversations}
    messages={snapshot.messages.map(message => ({id:message.id, role:message.role === 'tool' ? 'system' : message.role,
      content:message.body, createdAt:message.createdAt}))}
    draft={snapshot.draft?.conversationId === selectedId ? snapshot.draft.text : ''}
    onDraftChange={text => {
      if (!selectedId) return;
      controller.setDraft(selectedId,text);
      draftRequested.current = {id:selectedId,text};
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {void flushDraft(selectedId);}, 600);
    }}
    onCreate={next => {void beforeTransition(async () => {
      const result = await controller.create({mode:next});
      ready(result); if (result.kind === 'ok') await controller.open(result.value.id);
    });}}
    onSelect={id => {void beforeTransition(async () => {setAttachmentState(null);await controller.open(id);});}}
    onArchive={id => {void beforeTransition(async () => {const result = await controller.archive(id);ready(result);
      if (result.kind === 'ok' && selectedId === id) {
        setAttachmentState(null);
        await controller.search({query,archived:true});
      }
    });}}
    onRestore={id => {void controller.restore(id).then(ready);}}
    searchQuery={query} onSearchQueryChange={setQuery}
    showArchived={snapshot.archived} onShowArchivedChange={archived => {
      setBusyList(true); void controller.search({query, archived}).finally(() => setBusyList(false));
    }}
    hasMore={!!snapshot.nextCursor} onLoadMore={() => {
      setBusyList(true); void controller.loadMore().finally(() => setBusyList(false));
    }}
    hasMoreMessages={!!snapshot.messagesNextCursor} loadingMessages={loadingMessages}
    onLoadMoreMessages={() => {if (loadingMessages) return;
      setLoadingMessages(true);void controller.loadMoreMessages().finally(() => setLoadingMessages(false));
    }}
    loadingList={busyList} busy={snapshot.pending || !!snapshot.unknown}
    error={notice ?? snapshot.error} providerStatus={snapshot.provider === 'configured' ? 'ready' : 'no_provider'}
    onAttach={onAttach} attachmentState={attachmentState}
    attachments={attachments} attachmentsNextCursor={attachmentsNextCursor} loadingAttachments={loadingAttachments}
    onLoadMoreAttachments={() => {if (!selectedId || !attachmentsNextCursor || loadingAttachments) return;
      const cursor = attachmentsNextCursor;
      setLoadingAttachments(true);
      void controller.listAttachments(selectedId,cursor).then(page => {
        if (page && live.current === controller && controller.getSnapshot().selected?.id === selectedId) {
          setAttachments(previous => [...previous,...page.items]);setAttachmentsNextCursor(page.nextCursor);
        }
      }).finally(() => setLoadingAttachments(false));
    }}
    onDownloadAttachment={fileId => {const attachment = attachments.find(item => item.fileId === fileId);
      if (!attachment || !selectedId) return;
      const files = createFileClient({access:props.access,moduleId:'creezio.conversations',
        categoryId:'attachments',contextId:props.contextId});
      const current = () => live.current === controller && activity.current &&
        props.access.getSnapshot().session?.id === sessionId && controller.getSnapshot().selected?.id === selectedId;
      void files.download(attachment.reference,current).then(result => {
        if (!current()) return;
        if (result.kind !== 'ready') {
          setAttachmentState({phase:result.kind === 'unknown' ? 'unknown' : 'error',
            message:'Impossible de télécharger cette pièce jointe pour le moment.'});return;
        }
        const url = URL.createObjectURL(result.value), link = document.createElement('a');
        objectUrls.current.add(url);
        link.href = url; link.download = attachment.filename; link.rel = 'noopener';
        document.body.appendChild(link);link.click();link.remove();
        setTimeout(() => {URL.revokeObjectURL(url);objectUrls.current.delete(url);},30000);
      });
    }}
    onRetryUpload={pendingUpload.current?.conversationId === selectedId &&
      pendingUpload.current.sessionId === sessionId && attachmentState?.phase === 'unknown'
      ? () => {const pending = pendingUpload.current; if (pending) void uploadPending(pending);} : undefined}
    onReconcileUnknown={snapshot.unknown ? () => {void controller.reconcileUnknown().then(result => {
      if (result?.kind === 'execution' && result.execution.state === 'succeeded') {
        pendingLink.current = null;
        setNotice(null);
        if (selectedId) void controller.listAttachments(selectedId).then(page => {
          if (page && live.current === controller) {setAttachments(page.items);setAttachmentsNextCursor(page.nextCursor);}
        });
      } else if (result?.kind === 'execution' && result.execution.state === 'failed') {
        const pending = pendingLink.current;
        pendingLink.current = null;
        if (pending && pending.sessionId === sessionId) {
          const files = createFileClient({access:props.access,moduleId:'creezio.conversations',
            categoryId:'attachments',contextId:props.contextId});
          void files.abandon(pending.reference, () => live.current === controller &&
            props.access.getSnapshot().session?.id === pending.sessionId);
        }
      }
    });} : undefined}
    onNavigate={href => props.navigation.visit(href)} />;
  return floating ? content : <section className="h-full min-h-0 p-3" data-conversations-view={props.surface}>{content}</section>;
}

export function ConversationsAdminView(props: WorkspaceViewProps) {
  return <ConversationsView {...props} surface="admin" />;
}
export function ConversationsFrontView(props: WorkspaceViewProps) {
  return <ConversationsView {...props} surface="front" />;
}
