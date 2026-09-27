import {App, PostMessageTransport} from '@modelcontextprotocol/ext-apps';
import {widgetModelContextPayload} from '../../../../sdk/widgets/model-context.ts';

type RecordData = {id: string; title: string; revision: number};
const record = (value: unknown): value is RecordData => !!value && typeof value === 'object'
  && typeof (value as RecordData).id === 'string' && typeof (value as RecordData).title === 'string'
  && Number.isInteger((value as RecordData).revision);

/** MCP tools use render.v1; the native Creezio host returns action.v1. */
export function witnessRecordFromTool(value: unknown): RecordData | null {
  const envelope = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const payload = envelope?.kind === 'creezio.widget.render.v1' ? envelope.input
    : envelope?.kind === 'creezio.widget.action.v1' && envelope.state === 'succeeded'
      ? envelope.output : value;
  return record(payload) ? payload : null;
}

/** A native action can report an uncertain or still running command with isError=true. */
export function witnessRenameOutcome(result: {isError?: boolean; structuredContent?: unknown}):
  'succeeded' | 'uncertain' | 'rejected' {
  const value = result.structuredContent;
  const action = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  if (action?.kind === 'creezio.widget.action.v1') {
    if (action.state === 'succeeded' && result.isError !== true) return 'succeeded';
    if (['rejected', 'refused', 'failed'].includes(String(action.state))) return 'rejected';
    return 'uncertain';
  }
  return result.isError === true ? 'rejected' : 'succeeded';
}

export const witnessReadToolName = (kind: 'card' | 'picker') =>
  kind === 'card' ? 'witness_card_read' : 'witness_picker_read';

export async function callWitnessRead(client: Pick<App, 'callServerTool'>,
  kind: 'card' | 'picker', id: string): Promise<{isError: boolean; output: RecordData | null}> {
  const result = await client.callServerTool({name: witnessReadToolName(kind), arguments: {id}});
  return {isError: result.isError === true, output: witnessRecordFromTool(result.structuredContent)};
}

/** Portable witness: every effect is gated by the negotiated MCP Apps capability. */
export async function mountWitness(kind: 'card' | 'picker'): Promise<void> {
  const app = new App({name: `Creezio ${kind} witness`, version: '1.0.0'}, {});
  const root = document.getElementById('witness');
  const title = document.getElementById('title');
  const status = document.getElementById('status');
  const preview = document.getElementById('preview');
  const message = document.getElementById('message') as HTMLButtonElement | null;
  const context = document.getElementById('context') as HTMLButtonElement | null;
  const removeContext = document.getElementById('remove-context') as HTMLButtonElement | null;
  const direct = document.getElementById('direct') as HTMLButtonElement | null;
  const rename = document.getElementById('rename') as HTMLButtonElement | null;
  const renameInput = document.getElementById('rename-input') as HTMLInputElement | null;
  if (!root || !title || !status || !preview || !message || !context || !removeContext || !direct) return;
  let current: RecordData | undefined;
  let proposed = false;
  const say = (text: string) => { status.textContent = text; };
  const show = (value: unknown) => {
    if (!record(value)) { say('Fiche indisponible.'); return; }
    current = value;
    title.textContent = `${value.title} · révision ${value.revision}`;
    if (renameInput) renameInput.value = value.title;
    proposed = false;
    preview.textContent = '';
    message.textContent = 'Prévisualiser le message';
  };
  app.addEventListener('toolresult', result => {
    const output = witnessRecordFromTool(result.structuredContent);
    if (output) show(output);
  });
  try { await app.connect(new PostMessageTransport(window.parent, window.parent)); }
  catch { say('Pont MCP Apps indisponible.'); return; }
  const capabilities = app.getHostCapabilities();
  const hostName = app.getHostVersion()?.name;
  message.disabled = !capabilities?.message;
  context.disabled = !capabilities?.updateModelContext;
  removeContext.disabled = !capabilities?.updateModelContext;
  direct.disabled = !capabilities?.serverTools;
  if (rename) rename.disabled = !capabilities?.serverTools;
  if (!capabilities?.message || !capabilities?.updateModelContext || !capabilities?.serverTools)
    say('Certaines actions ne sont pas disponibles dans cet hôte.');
  message.addEventListener('click', async () => {
    if (!current) return;
    const text = `Partager la fiche ${current.id} : ${current.title} (révision ${current.revision}).`;
    if (!proposed) {
      preview.textContent = text;
      message.textContent = 'Envoyer ce message';
      proposed = true;
      say('Message proposé : envoi volontaire requis.');
      return;
    }
    try {
      const result = await app.sendMessage({role: 'user', content: [{type: 'text', text}]});
      say(result.isError ? 'Envoi refusé.' : 'Message transmis à l’hôte ; réponse IA non garantie.');
    } catch { say('État de transmission inconnu.'); }
  });
  context.addEventListener('click', async () => {
    if (!current) return;
    try {
      await app.updateModelContext(widgetModelContextPayload(hostName,
        kind === 'card' ? 'card.context' : 'picker.context', current));
      say('Contexte transmis à l’hôte pour le prochain tour.');
    } catch { say('État du contexte inconnu.'); }
  });
  removeContext.addEventListener('click', async () => {
    if (!current) return;
    try {
      await app.updateModelContext(widgetModelContextPayload(hostName,
        kind === 'card' ? 'card.context' : 'picker.context', current, true));
      say('Contexte retiré pour le prochain tour.');
    } catch { say('Retrait du contexte incertain.'); }
  });
  direct.addEventListener('click', async () => {
    if (!current) return;
    try {
      const result = await callWitnessRead(app, kind, current.id);
      if (result.isError) { say('Lecture refusée.'); return; }
      if (result.output) show(result.output);
      say('Lecture directe terminée sans tour IA.');
    } catch { say('Résultat de lecture inconnu ; vérifier avant de réessayer.'); }
  });
  rename?.addEventListener('click', async () => {
    if (!current || !renameInput?.value.trim()) return;
    try {
      const result = await app.callServerTool({name: 'witness_card_rename', arguments: {
        id: current.id, title: renameInput.value.trim(), revision: current.revision,
        request_key: crypto.randomUUID(),
      }});
      const outcome = witnessRenameOutcome(result);
      if (outcome === 'uncertain') { say('Résultat de modification incertain ; vérifier avant de réessayer.'); return; }
      if (outcome === 'rejected') { say('Modification refusée.'); return; }
      const output = witnessRecordFromTool(result.structuredContent);
      if (output) show(output);
      say('Modification directe terminée sans tour IA.');
    } catch { say('Résultat de modification inconnu ; vérifier avant de réessayer.'); }
  });
}
