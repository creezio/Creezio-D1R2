'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import type {CallToolRequest, CallToolResult} from '@modelcontextprotocol/client';
import {createMcpAppsBridge, type McpAppsBridge} from '../../../../sdk/widgets/mcp-apps-bridge.ts';
import {useWidgetHost} from '../../../../sdk/widgets/provider.tsx';
import type {WidgetApprovalPreview} from '../../../../sdk/widgets/approval-client.ts';
import type {WidgetMessageContentV1, WidgetMessageInstanceV1} from '../../../../sdk/widgets/types.ts';
import type {ConversationsController} from '../../../../sdk/conversations/types.ts';
import {widgetActionJournal, widgetApprovalJournal, widgetOperationInput, recordWidgetApprovalId,
  type WidgetApprovalDraft, type WidgetPendingCommand} from '../../../../sdk/widgets/action-journal.ts';

type PendingApproval = WidgetApprovalDraft & {approvalId: string; preview: WidgetApprovalPreview};
type ContextActionResult = Awaited<ReturnType<NonNullable<ConversationsController['changeWidgetContext']>>>;
export function widgetContextActionStatus(result: ContextActionResult): string {
  if (result.kind === 'ok') return result.value?.removed === true
    ? 'Contexte retiré pour les prochains tours.' : 'Contexte prêt pour le prochain tour.';
  return result.kind === 'unknown' ? 'Résultat du contexte incertain.' : 'Contexte refusé.';
}
const toolResult = (kind: string, code: string, requestId?: string, output?: unknown): CallToolResult => ({
  isError: kind !== 'succeeded',
  content: [{type: 'text', text: code}],
  structuredContent: {kind: 'creezio.widget.action.v1', state: kind, code,
    ...(requestId ? {requestId} : {}), ...(output === undefined ? {} : {output})},
});

function WidgetInstanceView(props: {instance: WidgetMessageInstanceV1; messageId: string;
  conversationId: string; active: boolean; onProposeText?: (text: string) => void;
  onContextAction?: ConversationsController['changeWidgetContext']}) {
  const host = useWidgetHost();
  const iframe = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<McpAppsBridge | null>(null);
  const proposeRef = useRef(props.onProposeText);
  const contextRef = useRef(props.onContextAction);
  proposeRef.current = props.onProposeText;
  contextRef.current = props.onContextAction;
  const [status, setStatus] = useState('Chargement du widget…');
  const [pending, setPending] = useState<WidgetPendingCommand | null>(null);
  const pendingRef = useRef<WidgetPendingCommand | null>(null);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const approvalDraftRef = useRef<WidgetApprovalDraft | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const instanceSignature = JSON.stringify(props.instance);
  const config = host?.configuration;
  const entry = config?.widgets.find(item => item.moduleId === props.instance.moduleId &&
    item.widgetId === props.instance.widgetId && item.version === props.instance.widgetVersion &&
    item.resourceUri === props.instance.resourceUri && item.resourceDigest === props.instance.resourceDigest &&
    item.audiences.includes(host!.audience));
  const resource = config?.resources.find(item => item.uri === props.instance.resourceUri &&
    item.digest === props.instance.resourceDigest && item.moduleId === props.instance.moduleId &&
    item.widgetId === props.instance.widgetId && item.version === props.instance.widgetVersion &&
    item.audiences.includes(host!.audience));
  const approvalMatchesCurrent = (draft: WidgetApprovalDraft): boolean => {
    const tool=entry?.serverTools.find(item=>item.toolName===draft.toolName
      &&item.operationDigest===draft.operationDigest&&item.operationKind==='command');
    const action=entry?.actions.find(item=>item.id===tool?.actionId);
    return !!host&&!!tool&&action?.mode==='direct'&&action.target.kind==='operation'
      &&action.target.operation.moduleId===draft.moduleId
      &&action.target.operation.id===draft.operationId
      &&host.resolveOperationBinding({moduleId:draft.moduleId,operationId:draft.operationId,
        operationDigest:draft.operationDigest})===draft.bindingId;
  };
  const session = host?.access.getSnapshot().session;
  const sessionId = session?.id;
  const journal = useMemo(() => {
    if (!host || !session || typeof window === 'undefined') return null;
    try { return widgetActionJournal({sessionId: session.id, principalId: session.principalId,
      audience: host.audience, contextId: host.contextId, conversationId: props.conversationId,
      messageId: props.messageId, instanceId: props.instance.instanceId,
      instanceRevision: props.instance.instanceRevision}, window.sessionStorage); }
    catch { return null; }
  }, [host, sessionId, session?.principalId, props.conversationId, props.messageId,
    props.instance.instanceId, props.instance.instanceRevision]);
  const approvalJournal = useMemo(() => {
    if (!host || !session || typeof window === 'undefined') return null;
    try { return widgetApprovalJournal({sessionId: session.id, principalId: session.principalId,
      audience: host.audience, contextId: host.contextId, conversationId: props.conversationId,
      messageId: props.messageId, instanceId: props.instance.instanceId,
      instanceRevision: props.instance.instanceRevision}, window.sessionStorage); }
    catch { return null; }
  }, [host, sessionId, session?.principalId, props.conversationId, props.messageId,
    props.instance.instanceId, props.instance.instanceRevision]);
  useEffect(() => {
    const restored = journal?.read() ?? null;
    pendingRef.current = restored;
    setPending(restored);
  }, [journal]);
  const commitPending = (next: WidgetPendingCommand | null): boolean => {
    if (next && (!journal || !journal.write(next))) return false;
    if (!next) journal?.clear();
    pendingRef.current = next;
    setPending(next);
    return true;
  };
  useEffect(() => {
    const draft = approvalJournal?.read() ?? null;
    approvalDraftRef.current = draft;
    if (draft && pendingRef.current?.requestKey === draft.requestKey) {
      approvalJournal?.clear(); approvalDraftRef.current = null; return;
    }
    if (!draft || !host || !host.approvalClient || !props.active) return;
    if (!approvalMatchesCurrent(draft)) {setStatus('Ancienne confirmation conservée ; exécution indisponible.'); return;}
    let cancelled = false;
    const current = () => !cancelled && host.access.getSnapshot().session?.id === sessionId;
    void (async () => {
      setStatus('Confirmation à vérifier…');
      let recovered = draft;
      if (!recovered.approvalId) {
        const result = await host.approvalClient!.request({moduleId: recovered.moduleId,
          operationId: recovered.operationId, input: recovered.input});
        if (!current()) return;
        if (result.kind !== 'ok') {
          if (result.kind === 'rejected') {approvalJournal?.clear(); approvalDraftRef.current = null;}
          setStatus(result.kind === 'unknown' ? 'Confirmation incertaine. Rechargez pour vérifier.' :
            'Confirmation refusée.');
          return;
        }
        const recorded = approvalJournal && recordWidgetApprovalId(approvalJournal,
          recovered, result.value.approvalId);
        if (!recorded) {setStatus('Stockage indisponible. Confirmation suspendue.'); return;}
        recovered = recorded;
        approvalDraftRef.current = recovered;
      }
      const loaded = await host.approvalClient!.read(recovered.approvalId!);
      if (!current()) return;
      if (loaded.kind !== 'ok') {setStatus('Confirmation incertaine. Rechargez pour vérifier.'); return;}
      if (loaded.value.state === 'pending' || loaded.value.state === 'approved') {
        setApproval({...recovered, approvalId: recovered.approvalId!, preview: loaded.value});
        setStatus(loaded.value.state === 'approved' ? 'Action approuvée. Reprenez l’exécution.' :
          'Confirmation nécessaire. Vérifiez les détails ci-dessous.');
      } else if (loaded.value.state === 'consumed') {
        const command = {bindingId: recovered.bindingId, operationDigest: recovered.operationDigest,
          toolName: recovered.toolName, requestKey: recovered.requestKey};
        if (!journal?.write(command)) {setStatus('Stockage indisponible. Résultat à vérifier.'); return;}
        pendingRef.current = command; setPending(command);
        approvalJournal?.clear(); approvalDraftRef.current = null;
        setStatus('Confirmation consommée. Vérifiez le résultat de l’opération.');
      } else {
        approvalJournal?.clear(); approvalDraftRef.current = null;
        setStatus('Confirmation refusée ou expirée.');
      }
    })();
    return () => {cancelled = true;};
  }, [approvalJournal, journal, host, entry, sessionId, props.active]);
  useEffect(() => {
    const node = iframe.current;
    if (!host || !node || !props.active || host.phase !== 'ready' || !config || !entry || !resource || !sessionId) {
      setStatus('Widget indisponible.');
      setApproval(null);
      return;
    }
    let cancelled = false;
    const instanceRef = {host: 'creezio' as const, instanceId: props.instance.instanceId,
      instanceRevision: props.instance.instanceRevision, moduleId: props.instance.moduleId,
      widgetId: props.instance.widgetId, widgetVersion: props.instance.widgetVersion,
      audience: host.audience, conversationId: props.conversationId, messageId: props.messageId,
      ...(props.instance.objectRef ? {objectRef: props.instance.objectRef} : {}),
      ...(props.instance.objectVersion !== undefined ? {objectVersion: props.instance.objectVersion} : {})};
    const isCurrent = () => !cancelled && props.active &&
      host.access.getSnapshot().phase === 'authenticated' &&
      host.access.getSnapshot().session?.id === sessionId &&
      host.configuration === config;
    const callTool = async (params: CallToolRequest['params']): Promise<CallToolResult> => {
      if (!isCurrent()) return toolResult('rejected', 'widget_inactive');
      const tool = entry.serverTools.find(item => item.toolName === params.name &&
        item.visibility.includes('app'));
      const action = entry.actions.find(item => item.id === tool?.actionId);
      if (!tool || !action || action.mode !== 'direct' || action.target.kind !== 'operation' ||
        action.target.operationDigest !== tool.operationDigest ||
        action.target.operationKind !== tool.operationKind ||
        (action.target.idempotencyKeyField ?? null) !== tool.idempotencyKeyField)
        return toolResult('rejected', 'tool_unavailable');
      const bindingId = host.resolveOperationBinding({moduleId: action.target.operation.moduleId,
        operationId: action.target.operation.id, operationDigest: tool.operationDigest});
      if (!bindingId || !params.arguments || typeof params.arguments !== 'object' ||
        Array.isArray(params.arguments)) return toolResult('rejected', 'tool_unavailable');
      if (tool.operationKind === 'command' &&
        (!tool.idempotencyKeyField || pendingRef.current || approvalDraftRef.current))
        return toolResult('rejected', pendingRef.current || approvalDraftRef.current ?
          'pending_command' : 'tool_unavailable');
      const requestId = crypto.randomUUID();
      const input = widgetOperationInput(tool, params.arguments, requestId);
      if (!input) return toolResult('rejected', 'tool_unavailable');
      const command = tool.operationKind === 'command' ? {bindingId,
        operationDigest: tool.operationDigest, toolName: tool.toolName, requestKey: requestId} : null;
      if (command && !commitPending(command)) return toolResult('rejected', 'journal_unavailable');
      setStatus('Action en cours…');
      const result = await host.operationClient.invoke({bindingId, contextId: host.contextId,
        input, isCurrent});
      if (!isCurrent()) return toolResult('unknown', 'stale', requestId);
      if (result.kind === 'unknown') {
        if (command && result.executionId) commitPending({...command, executionId: result.executionId});
        setStatus(command ? 'Résultat incertain. Vérifiez avant de réessayer.' :
          'Lecture indisponible. Relancez la lecture si nécessaire.');
        return toolResult('unknown', result.code, requestId);
      }
      if (result.kind === 'rejected') {
        if (command) commitPending(null);
        if (result.code === 'approval_required' && host.approvalClient && command) {
          const draft: WidgetApprovalDraft = {...command,
            moduleId: action.target.operation.moduleId, operationId: action.target.operation.id, input};
          if (!approvalJournal?.write(draft)) {
            setStatus('Confirmation indisponible : données non conservables.');
            return toolResult('rejected', 'approval_journal_unavailable', requestId);
          }
          approvalDraftRef.current = draft;
          const requested = await host.approvalClient.request({moduleId: action.target.operation.moduleId,
            operationId: action.target.operation.id, input});
          if (!isCurrent()) return toolResult('unknown', 'stale', requestId);
          if (requested.kind === 'ok') {
            const recorded = recordWidgetApprovalId(approvalJournal,draft,requested.value.approvalId);
            if (!recorded) {
              setStatus('Stockage indisponible. Confirmation suspendue.');
              return toolResult('unknown', 'approval_journal_unavailable', requestId);
            }
            approvalDraftRef.current = recorded;
            const loaded = await host.approvalClient.read(requested.value.approvalId);
            if (!isCurrent()) return toolResult('unknown', 'stale', requestId);
            if (loaded.kind === 'ok' && ['pending', 'approved'].includes(loaded.value.state)) {
              setApproval({...recorded, approvalId: requested.value.approvalId, preview: loaded.value});
              setStatus(loaded.value.state === 'approved' ? 'Action approuvée. Reprenez l’exécution.' :
                'Confirmation nécessaire. Vérifiez les détails ci-dessous.');
              return toolResult('transmitted', 'approval_pending', requestId);
            }
          }
          if (requested.kind === 'rejected') {approvalJournal.clear(); approvalDraftRef.current = null;}
          setStatus('Confirmation indisponible.');
          return toolResult('unknown', 'approval_unavailable', requestId);
        }
        setStatus('Action refusée.');
        return toolResult('rejected', result.code, requestId);
      }
      if (result.execution.state === 'succeeded') {
        setStatus('Action terminée.'); if (command) commitPending(null);
        return toolResult('succeeded', 'succeeded', requestId, result.execution.output);
      }
      if (result.execution.state === 'failed') {
        setStatus('Action refusée.'); if (command) commitPending(null);
        return toolResult('rejected', result.execution.errorCode ?? 'failed', requestId);
      }
      if (command) commitPending({...command, executionId: result.execution.id});
      setStatus(command ? 'Action transmise, résultat en attente.' : 'Lecture en attente.');
      return toolResult('transmitted', 'transmitted', requestId);
    };
    void (async () => {
      const html = await host.loadResource(resource.uri, resource.digest, resource.cspProfileId);
      if (!isCurrent() || !html) {if (!cancelled) setStatus('Widget indisponible.'); return;}
      let initialResult: CallToolResult | undefined;
      const render = props.instance.renderExecution;
      if (render) {
        const linked = entry.renderTools.some(tool => tool.operationModuleId === render.moduleId &&
          tool.operationId === render.operationId &&
          tool.operationDigest === render.operationDigest && tool.audiences.includes(host.audience));
        const historical = !linked && entry.renderTools.some(tool => tool.operationModuleId === render.moduleId &&
          tool.operationId === render.operationId && tool.audiences.includes(host.audience));
        if (!linked && !historical) {setStatus('Résultat du widget indisponible.'); return;}
        let output: unknown;
        if (historical) {
          // The server reads the native message and its exact historical execution. No old digest or output is client supplied.
          const result = await host.operationClient.invoke({
            bindingId: `creezio.conversations:${host.audience}.widget.render.read`,contextId:host.contextId,
            input:{conversationId:props.conversationId,messageId:props.messageId,instanceId:props.instance.instanceId},isCurrent});
          if (!isCurrent()) return;
          const body = result.kind === 'execution' && result.execution.state === 'succeeded'
            && result.execution.output && typeof result.execution.output === 'object'
            && !Array.isArray(result.execution.output) ? result.execution.output as Record<string,unknown> : null;
          if (!body || body.instanceId !== props.instance.instanceId || !Object.hasOwn(body,'output')) {
            setStatus('Résultat du widget indisponible.'); return;
          }
          output=body.output;
        } else {
          const renderBinding = host.resolveOperationBinding({moduleId: render.moduleId,
            operationId: render.operationId, operationDigest: render.operationDigest});
          if (!renderBinding) {setStatus('Résultat du widget indisponible.'); return;}
          const execution = await host.operationClient.status({bindingId: renderBinding,
            contextId: host.contextId, executionId: render.executionId, isCurrent});
          if (!isCurrent()) return;
          if (execution.kind !== 'execution' || execution.execution.id !== render.executionId ||
            execution.execution.state !== 'succeeded') {setStatus('Résultat du widget indisponible.'); return;}
          output=execution.execution.output;
        }
        try {
          const outputBytes = new TextEncoder().encode(JSON.stringify(output)).byteLength;
          if (outputBytes > entry.transport.maxPayloadBytes) throw new Error('render_output_too_large');
        } catch {setStatus('Résultat du widget indisponible.'); return;}
        initialResult = {content: [{type: 'text', text: 'Données du widget prêtes.'}],
          structuredContent: {kind: 'creezio.widget.render.v1', input: output}};
      }
      try {
        const mounted = await createMcpAppsBridge({iframe: node,
          sandboxOrigin: config.sandboxOrigin, cspProfileId: resource.cspProfileId,
          html: html.text, resourceDigest: resource.digest,
          csp: {connectDomains: [...resource.uiMeta.csp.connectDomains],
            resourceDomains: [...resource.uiMeta.csp.resourceDomains],
            frameDomains: [...resource.uiMeta.csp.frameDomains],
            baseUriDomains: [...resource.uiMeta.csp.baseUriDomains]},
          permissions: resource.uiMeta.permissions,
          instance: instanceRef,
          toolNames: entry.serverTools.filter(tool => tool.visibility.includes('app')).map(tool => tool.toolName),
          toolInput: {state: props.instance.state, instanceId: props.instance.instanceId},
          ...(initialResult ? {toolResult: initialResult} : {}),
          isCurrent, callTool,
          ...(proposeRef.current ? {proposeMessage: async text => {
            if (!isCurrent()) return false;
            proposeRef.current?.(text); setStatus('Message proposé. Envoyez-le volontairement.');
            return true;
          }} : {}),
          ...(contextRef.current ? {replaceContext: async payload => {
            if (!isCurrent() || !payload || typeof payload !== 'object') return false;
            const structured = 'structuredContent' in payload ? payload.structuredContent : null;
            if (!structured || typeof structured !== 'object' || !('creezioWidgetAction' in structured)) return false;
            const request = structured.creezioWidgetAction;
            if (!request || typeof request !== 'object' || !('actionId' in request) ||
              typeof request.actionId !== 'string' || !('input' in request) ||
              'remove' in request && typeof request.remove !== 'boolean') return false;
            const action = entry.actions.find(item => item.id === request.actionId && item.mode === 'context');
            if (!action) return false;
            const result = await contextRef.current!({instance: instanceRef, actionId: request.actionId,
              input: request.input, remove: 'remove' in request && request.remove === true});
            if (!isCurrent()) return false;
            setStatus(widgetContextActionStatus(result));
            return result.kind === 'ok';
          }} : {}),
        });
        if (!isCurrent()) {await mounted.dispose(); return;}
        bridge.current = mounted;
        setStatus(pendingRef.current ? 'Résultat incertain. Vérifiez avant de réessayer.' :
          approvalDraftRef.current ? 'Confirmation à vérifier…' : 'Widget prêt.');
      } catch {if (!cancelled) setStatus('Widget indisponible.');}
    })();
    return () => {cancelled = true; const current = bridge.current; bridge.current = null;
      if (current) void current.dispose();};
  }, [host, config, entry, resource, sessionId, instanceSignature, props.messageId,
    props.conversationId, props.active, journal, approvalJournal]);

  const reconcile = async () => {
    if (!host || !pending || !props.active) return;
    const result = await host.operationClient.status({bindingId: pending.bindingId,
      contextId: host.contextId, ...(pending.executionId
        ? {executionId: pending.executionId} : {requestKey: pending.requestKey}),
      isCurrent: () => props.active && host.access.getSnapshot().session?.id === sessionId});
    if (pendingRef.current?.requestKey !== pending.requestKey ||
      host.access.getSnapshot().session?.id !== sessionId) return;
    if (result.kind === 'execution' && result.execution.state === 'succeeded') {
      commitPending(null); setStatus('Action terminée.');
      await bridge.current?.sendToolResult(toolResult('succeeded', 'succeeded', pending.requestKey,
        result.execution.output));
    } else if (result.kind === 'execution' && result.execution.state === 'failed') {
      commitPending(null); setStatus('Action refusée.');
    } else {
      if (result.kind === 'execution') commitPending({...pending, executionId: result.execution.id});
      else if (result.kind === 'unknown' && result.executionId)
        commitPending({...pending, executionId: result.executionId});
      setStatus('Résultat encore incertain.');
    }
  };
  const executeApproved = async (approved: PendingApproval) => {
    if (!host || host.access.getSnapshot().session?.id !== sessionId || !props.active ||
      pendingRef.current) return;
    if (!approvalMatchesCurrent(approved)) {setStatus('Ancienne confirmation conservée ; exécution indisponible.'); return;}
    const approvedCommand = {bindingId: approved.bindingId, operationDigest: approved.operationDigest,
      toolName: approved.toolName, requestKey: approved.requestKey};
    if (!commitPending(approvedCommand)) {
      setStatus('Journal indisponible. Action non exécutée.'); return;
    }
    approvalJournal?.clear(); approvalDraftRef.current = null;
    setApproval(null); setStatus('Action approuvée, exécution en cours…');
    const result = await host.operationClient.invoke({bindingId: approved.bindingId,
      contextId: host.contextId, input: approved.input, approvalId: approved.approvalId,
      isCurrent: () => props.active && host.access.getSnapshot().session?.id === sessionId});
    if (host.access.getSnapshot().session?.id !== sessionId || !props.active) return;
    if (result.kind === 'execution' && result.execution.state === 'succeeded') {
      commitPending(null); setStatus('Action terminée.');
      await bridge.current?.sendToolResult(toolResult('succeeded', 'succeeded', approved.requestKey,
        result.execution.output));
    } else if (result.kind === 'execution' && result.execution.state === 'failed') {
      commitPending(null); setStatus('Action refusée.');
      await bridge.current?.sendToolResult(toolResult('rejected', result.execution.errorCode ?? 'failed',
        approved.requestKey));
    } else if (result.kind === 'rejected') {
      commitPending(null); setStatus('Action refusée.');
      await bridge.current?.sendToolResult(toolResult('rejected', result.code, approved.requestKey));
    } else {
      if (result.kind === 'unknown' && result.executionId)
        commitPending({...approvedCommand, executionId: result.executionId});
      else if (result.kind === 'execution')
        commitPending({...approvedCommand, executionId: result.execution.id});
      setStatus('Résultat incertain. Vérifiez avant de réessayer.');
    }
  };
  const decideApproval = async (decision: 'approve' | 'reject') => {
    if (!host || !host.approvalClient || !approval || approvalBusy || !props.active ||
      host.access.getSnapshot().session?.id !== sessionId) return;
    if (!approvalMatchesCurrent(approval)) {setStatus('Ancienne confirmation conservée ; exécution indisponible.'); return;}
    setApprovalBusy(true); setStatus('Décision en cours…');
    try {
      const decided = await host.approvalClient.decide(approval.preview, decision);
      if (host.access.getSnapshot().session?.id !== sessionId || !props.active) return;
      if (decided.kind !== 'ok') {setStatus('Décision incertaine. Vérifiez la confirmation.'); return;}
      if (decided.value.state === 'rejected') {
        approvalJournal?.clear(); approvalDraftRef.current = null;
        setApproval(null); setStatus('Action refusée par l’utilisateur.');
        await bridge.current?.sendToolResult(toolResult('rejected', 'approval_rejected', approval.requestKey));
        return;
      }
      await executeApproved(approval);
    } finally {setApprovalBusy(false);}
  };
  const recheckApproval = async () => {
    if (!host || !host.approvalClient || !approval || !props.active) return;
    const loaded = await host.approvalClient.read(approval.approvalId);
    if (host.access.getSnapshot().session?.id !== sessionId || !props.active) return;
    if (loaded.kind !== 'ok') {setStatus('Confirmation encore incertaine.'); return;}
    if (loaded.value.state === 'pending') {setApproval({...approval, preview: loaded.value});
      setStatus('Confirmation en attente.');}
    else if (loaded.value.state === 'approved') {
      setApproval({...approval, preview: loaded.value});
      setStatus('Action approuvée. Reprenez l’exécution.');
    }
    else if (loaded.value.state === 'consumed') {
      if (!commitPending({bindingId: approval.bindingId, operationDigest: approval.operationDigest,
        toolName: approval.toolName, requestKey: approval.requestKey})) {
        setStatus('Stockage indisponible. Résultat à vérifier.'); return;
      }
      setApproval(null);
      approvalJournal?.clear(); approvalDraftRef.current = null;
      setStatus('Confirmation consommée. Vérifiez le résultat de l’opération.');
    }
    else {approvalJournal?.clear(); approvalDraftRef.current = null;
      setApproval(null); setStatus('Confirmation refusée ou expirée.');}
  };
  return <section className="mt-2 rounded-lg border border-slate-200 bg-white p-2"
    aria-label={`Widget ${props.instance.widgetId}`} data-widget-instance={props.instance.instanceId}>
    <iframe ref={iframe} title={`Widget ${props.instance.widgetId}`}
      className="h-64 w-full rounded-md border border-slate-100" />
    {approval && <section className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2"
      aria-label="Confirmation de l’opération">
      <p className="font-medium text-amber-950">{approval.preview.operation.title}</p>
      <dl className="mt-1 space-y-1 text-[11px] text-amber-950">
        {Object.entries(approval.preview.fields).map(([name, value]) => <div key={name}>
          <dt className="font-medium">{name}</dt><dd className="break-words">{JSON.stringify(value)}</dd>
        </div>)}
      </dl>
      <p className="mt-1 text-[11px] text-amber-900">Cette action sera exécutée après votre confirmation.</p>
      <div className="mt-2 flex gap-2 text-xs">
        {approval.preview.state === 'pending' ? <>
          <button type="button" className="rounded bg-sky-700 px-2 py-1 text-white"
            disabled={approvalBusy}
            onClick={() => void decideApproval('approve')}>Approuver et exécuter</button>
          <button type="button" className="rounded border border-amber-400 px-2 py-1"
            disabled={approvalBusy}
            onClick={() => void decideApproval('reject')}>Refuser</button>
        </> : approval.preview.state === 'approved' ?
          <button type="button" className="rounded bg-sky-700 px-2 py-1 text-white"
            disabled={approvalBusy}
            onClick={() => void executeApproved(approval)}>Reprendre l’exécution</button> : null}
        <button type="button" className="text-sky-700 underline"
          disabled={approvalBusy}
          onClick={() => void recheckApproval()}>Vérifier</button>
      </div>
    </section>}
    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-600">
      <span role="status">{status}</span>
      {pending && <button type="button" className="text-sky-700 underline" onClick={() => void reconcile()}>
        Vérifier l’action</button>}
    </div>
  </section>;
}

export function WidgetMessage(props: {content: WidgetMessageContentV1; messageId: string;
  conversationId: string; active: boolean; onProposeText?: (text: string) => void;
  onContextAction?: ConversationsController['changeWidgetContext']}) {
  return <div className="space-y-2" data-widget-message={props.messageId}>
    {props.content.instances.map(instance => <WidgetInstanceView key={`${instance.instanceId}:${instance.instanceRevision}`}
      instance={instance} messageId={props.messageId} conversationId={props.conversationId}
      active={props.active} onProposeText={props.onProposeText}
      onContextAction={props.onContextAction} />)}
  </div>;
}
