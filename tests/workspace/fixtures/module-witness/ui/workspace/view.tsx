'use client';

import {useEffect, useRef, useState} from 'react';
import {RetainedSubViews, WorkspacePortal, useWorkspaceActivity} from '@creezio/sdk/workspace/components';
import {useRegisterWorkspaceMetadata} from '@creezio/sdk/workspace/metadata';
import {useRegisterPageToolbar} from '@creezio/sdk/workspace/toolbar';
import type {WorkspaceViewProps} from '../../../../../../sdk/workspace/types.ts';

const recordView = 'example.workspace-witness:record';
const readBinding = (audience: string) => `example.workspace-witness:record-read-${audience}`;
const renameBinding = (audience: string) => `example.workspace-witness:record-rename-${audience}`;
type RecordOutput = {id: string; title: string; revision: number};
const recordOutput = (value: unknown): value is RecordOutput => !!value && typeof value === 'object'
  && typeof (value as RecordOutput).id === 'string' && typeof (value as RecordOutput).title === 'string'
  && Number.isSafeInteger((value as RecordOutput).revision);
type Editor = {draftTitle: string; baseTitle: string; baseRevision: number | null;
  section: 'details' | 'notes'; pendingRequestKey: string | null; pendingExecutionId: string | null};
export function reconcileEditor(editor: Editor, record: RecordOutput): {editor: Editor; conflict: boolean} {
  if (editor.baseRevision === null
    || (editor.baseRevision !== record.revision && editor.draftTitle === editor.baseTitle)) {
    return {editor: {...editor, draftTitle: record.title, baseTitle: record.title,
      baseRevision: record.revision}, conflict: false};
  }
  return {editor, conflict: editor.baseRevision !== record.revision};
}
export function pendingStatusTarget(editor: Editor) {
  if (!editor.pendingRequestKey) return null;
  return editor.pendingExecutionId ? {executionId:editor.pendingExecutionId}
    : {requestKey:editor.pendingRequestKey};
}
export function statusStillCurrent(editor: Editor, requestKey: string): boolean {
  return !!requestKey && editor.pendingRequestKey === requestKey;
}
export function acceptsRecordRevision(latest: number | null, incoming: number): boolean {
  return latest === null || incoming >= latest;
}
export function sectionUrl(url: string, section: 'details' | 'notes'): string {
  const next = new URL(url, 'https://workspace.invalid');
  next.searchParams.set('section', section);
  return `${next.pathname}${next.search}`;
}

export function witness_home({panelId,navigation}: WorkspaceViewProps) {
  useRegisterWorkspaceMetadata(panelId,{title:'Workspace témoin',kind:'section'});
  return <section aria-label="Fiches témoins">
    <h1>Workspace témoin</h1>
    <p>Deux fiches synthétiques pour vérifier les brouillons indépendants.</p>
    <ul>{[{id:'alpha',label:'Fiche Alpha'},{id:'beta',label:'Fiche Bêta'}].map(item =>
      <li key={item.id}><button type="button" onClick={() => navigation.open(recordView,{id:item.id})}>{item.label}</button></li>)}</ul>
  </section>;
}

export function witness_record({panelId,location,input,contextId,audience,active,navigation,client}: WorkspaceViewProps) {
  const id = input.id;
  const label = id === 'alpha' ? 'Fiche Alpha' : id === 'beta' ? 'Fiche Bêta' : `Fiche témoin ${id}`;
  useRegisterWorkspaceMetadata(panelId,{title:label,kind:'entity',trail:[
    {label:'Workspace témoin',href:'/witness'},{label},
  ]});
  const nextSection = input.section === 'notes' ? 'details' : 'notes';
  useRegisterPageToolbar(panelId,location.url,<button type="button"
    onClick={() => navigation.visit(sectionUrl(location.url,nextSection))}>
    {nextSection === 'notes' ? 'Afficher Notes' : 'Afficher Détails'}
  </button>);
  const [record,setRecord] = useState<RecordOutput | null>(null);
  const [editor,setEditor] = useState<Editor>(() => {
    const state = navigation.readPanelState();
    const data = state?.data;
    return {
      draftTitle: typeof data?.draftTitle === 'string' ? data.draftTitle : '',
      baseTitle: typeof data?.baseTitle === 'string' ? data.baseTitle : '',
      baseRevision: Number.isSafeInteger(data?.baseRevision) ? data!.baseRevision as number : null,
      section: state?.activeSubview === 'notes' ? 'notes' : 'details',
      pendingRequestKey: typeof data?.pendingRequestKey === 'string' ? data.pendingRequestKey : null,
      pendingExecutionId: typeof data?.pendingExecutionId === 'string' ? data.pendingExecutionId : null,
    };
  });
  const editorRef = useRef(editor);
  const [portalOpen,setPortalOpen] = useState(false);
  const [readAttempt,setReadAttempt] = useState(0);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [reloadWarning,setReloadWarning] = useState(false);
  const saving = useRef(false);
  const checking = useRef(false);
  const latestRevision = useRef<number | null>(null);
  const activity = useWorkspaceActivity();
  const uncertain = !!editor.pendingRequestKey;
  function commitEditor(next: Editor) {
    editorRef.current = next;
    setEditor(next);
    const persisted = navigation.savePanelState(next.baseRevision === null
      ? {activeSubview: next.section}
      : {activeSubview: next.section, data: {
        draftTitle: next.draftTitle, baseTitle: next.baseTitle, baseRevision: next.baseRevision,
        ...(next.pendingRequestKey ? {pendingRequestKey: next.pendingRequestKey} : {}),
        ...(next.pendingExecutionId ? {pendingExecutionId: next.pendingExecutionId} : {}),
      }});
    setReloadWarning(!persisted);
    return persisted;
  }
  function acceptRecord(output: RecordOutput): boolean {
    if (!acceptsRecordRevision(latestRevision.current, output.revision)) return false;
    latestRevision.current = output.revision;
    setRecord(output);
    return true;
  }
  useEffect(() => {
    if (!active || !activity || !['details','notes'].includes(input.section)) return;
    if (editorRef.current.section !== input.section)
      commitEditor({...editorRef.current,section:input.section as 'details' | 'notes'});
  },[active,activity,input.section]);
  useEffect(() => {
    if (!active || !activity || !id) return;
    let current = true;
    void client.invoke({bindingId:readBinding(audience),contextId,input:{id},isCurrent:()=>current}).then(result => {
      if (!current) return;
      const output = result.kind === 'execution' && result.execution.state === 'succeeded'
        ? result.execution.output : null;
      if (recordOutput(output) && output.id === id) {
        if (!acceptRecord(output)) return;
        const currentEditor = editorRef.current;
        const reconciled = reconcileEditor(currentEditor, output);
        if (reconciled.editor !== currentEditor) commitEditor(reconciled.editor);
        if (reconciled.conflict) {
          setMessage('Conflit de révision : le brouillon est conservé. Choisissez comment reprendre.');
        } else setMessage('');
      } else setMessage('Lecture indisponible. Relisez la fiche.');
    });
    return () => {current=false;};
  }, [active,activity,client,contextId,audience,id,readAttempt]);
  async function save() {
    const currentEditor = editorRef.current;
    if (!active || !activity || saving.current || !record || !currentEditor.draftTitle.trim()
      || currentEditor.baseRevision === null || currentEditor.pendingRequestKey) return;
    if (record.revision !== currentEditor.baseRevision) {
      setMessage('Conflit de révision : choisissez comment reprendre avant d’enregistrer.');
      return;
    }
    saving.current=true;setBusy(true);setMessage('');
    const requestKey=crypto.randomUUID();
    // Keep the exact idempotency key before dispatch. A lost response never causes a replay.
    commitEditor({...currentEditor,pendingRequestKey:requestKey,pendingExecutionId:null});
    try {
      const result=await client.invoke({bindingId:renameBinding(audience),contextId,
        input:{id,title:currentEditor.draftTitle.trim(),revision:currentEditor.baseRevision,request_key:requestKey}});
      if(result.kind==='execution' && result.execution.state==='succeeded'
        && recordOutput(result.execution.output) && result.execution.output.id === id) {
        if (acceptRecord(result.execution.output)) {
          commitEditor({...editorRef.current, draftTitle: result.execution.output.title,
            baseTitle: result.execution.output.title, baseRevision: result.execution.output.revision,
            pendingRequestKey:null,pendingExecutionId:null});
          setMessage('Fiche enregistrée.');
        } else {
          commitEditor({...editorRef.current,pendingRequestKey:null,pendingExecutionId:null});
          setMessage('Enregistrement confirmé ; une version serveur plus récente est déjà affichée.');
        }
      } else if(result.kind==='execution' && result.execution.state==='failed') {
        commitEditor({...editorRef.current,pendingRequestKey:null,pendingExecutionId:null});
        setMessage('Modification refusée. Relisez la fiche avant de réessayer.');
      } else if(result.kind==='unknown' || result.kind==='execution') {
        const executionId=result.kind==='execution' ? result.execution.id : result.executionId??null;
        commitEditor({...editorRef.current,pendingExecutionId:executionId});
        setMessage('Résultat incertain. Vérifiez l’exécution avant toute nouvelle tentative.');
      } else {
        commitEditor({...editorRef.current,pendingRequestKey:null,pendingExecutionId:null});
        setMessage('Modification refusée ou en conflit. Relisez la fiche avant de réessayer.');
      }
    } finally {saving.current=false;setBusy(false);}
  }
  async function checkExecution() {
    const pending=editorRef.current;
    const target=pendingStatusTarget(pending);
    if(!target || busy || checking.current) return;
    checking.current=true;
    try {
      const result=await client.status({bindingId:renameBinding(audience),contextId,...target});
      // An earlier lookup cannot clear or overwrite a newer pending SAVE.
      if (!statusStillCurrent(editorRef.current,pending.pendingRequestKey!)) return;
      if(result.kind==='execution' && result.execution.state==='succeeded'
        && recordOutput(result.execution.output) && result.execution.output.id === id) {
        if (acceptRecord(result.execution.output)) {
          commitEditor({...editorRef.current, draftTitle: result.execution.output.title,
            baseTitle: result.execution.output.title, baseRevision: result.execution.output.revision,
            pendingRequestKey:null,pendingExecutionId:null});
          setMessage('Exécution confirmée.');
        } else {
          commitEditor({...editorRef.current,pendingRequestKey:null,pendingExecutionId:null});
          setMessage('Exécution confirmée ; une version serveur plus récente est déjà affichée.');
        }
      } else if(result.kind==='execution' && result.execution.state==='failed') {
        commitEditor({...editorRef.current,pendingRequestKey:null,pendingExecutionId:null});
        setMessage('Exécution terminée sans modification. Relisez la fiche.');
      } else {
        const executionId=result.kind==='execution' ? result.execution.id
          : result.kind==='unknown' ? result.executionId??null : null;
        if(executionId && executionId!==pending.pendingExecutionId)
          commitEditor({...editorRef.current,pendingExecutionId:executionId});
        setMessage(result.kind==='unknown' && result.code==='execution_not_observed'
          ? 'Exécution non observée ; ce résultat ne prouve pas l’absence de modification. Aucun nouvel envoi.'
          : 'Résultat encore incertain. Aucune nouvelle modification envoyée.');
      }
    } finally {checking.current=false;}
  }
  const conflict = !!record && editor.baseRevision !== null && record.revision !== editor.baseRevision;
  return <article data-witness-record={id}>
    <p><button type="button" onClick={() => navigation.open('example.workspace-witness:home')}>Accueil</button></p>
    <h1>Fiche témoin {id}</h1>
    <div role="tablist" aria-label="Sous-vues de la fiche">
      <button type="button" role="tab" aria-selected={editor.section==='details'} onClick={()=>{
        if (!commitEditor({...editorRef.current, section:'details'})) setMessage('Sous-vue non conservée pour la prochaine ouverture.');
      }}>Détails</button>
      <button type="button" role="tab" aria-selected={editor.section==='notes'} onClick={()=>{
        if (!commitEditor({...editorRef.current, section:'notes'})) setMessage('Sous-vue non conservée pour la prochaine ouverture.');
      }}>Notes</button>
    </div>
    <RetainedSubViews active={editor.section} views={[
      {id:'details',content:<section aria-label="Détails">
        <label>Titre <input value={editor.draftTitle} maxLength={200} onChange={event=>{
          if (!commitEditor({...editorRef.current, draftTitle:event.target.value}))
            setMessage('Brouillon non conservé pour la prochaine ouverture.');
        }} disabled={!record||busy||uncertain}/></label>
        <p>Révision : {record?.revision??'…'}</p>
        <button type="button" disabled={!record||busy||!active||!activity||uncertain||conflict} onClick={()=>{void save();}}>Enregistrer</button>
        <button type="button" disabled={busy||uncertain} onClick={()=>setReadAttempt(value=>value+1)}>Relire</button>
        {conflict && record && <div role="alert">
          <p>Conflit : brouillon fondé sur la révision {editor.baseRevision}, fiche serveur à la révision {record.revision}.</p>
          <button type="button" onClick={()=>{
            commitEditor({...editorRef.current, baseTitle:record.title, baseRevision:record.revision});
            setMessage('Brouillon conservé sur la nouvelle révision.');
          }}>Rebaser mon brouillon</button>
          <button type="button" onClick={()=>{
            commitEditor({...editorRef.current, draftTitle:record.title,
              baseTitle:record.title, baseRevision:record.revision});
            setMessage('Version serveur adoptée.');
          }}>Adopter la version serveur</button>
        </div>}
        {editor.pendingRequestKey && <button type="button" onClick={()=>{void checkExecution();}}>Vérifier l’exécution</button>}
        <button type="button" onClick={()=>setPortalOpen(true)}>Ouvrir le panneau</button>
        {portalOpen && <WorkspacePortal><div role="dialog" aria-label={`Panneau ${id}`}>
          <p>Panneau lié à {id}</p><button type="button" onClick={()=>setPortalOpen(false)}>Fermer</button>
        </div></WorkspacePortal>}
      </section>},
      {id:'notes',content:<section aria-label="Notes"><label>Note locale <textarea defaultValue="" /></label></section>},
    ]}/>
    {reloadWarning && <p role="alert">Le brouillon{editor.pendingRequestKey ? ' et sa clé de vérification' : ''} reste dans ce panneau, mais sa restauration après rechargement n’est pas garantie.</p>}
    <p role="status" aria-live="polite">{message}</p>
  </article>;
}
