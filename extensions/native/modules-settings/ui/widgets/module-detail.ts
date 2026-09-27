import {App, PostMessageTransport} from '@modelcontextprotocol/ext-apps';

type ModuleDetail = {module: {moduleId: string; title: string; version: string; enabled: boolean}};
const detail = (value: unknown): value is ModuleDetail => !!value && typeof value === 'object'
  && !!(value as ModuleDetail).module && typeof (value as ModuleDetail).module.moduleId === 'string'
  && typeof (value as ModuleDetail).module.title === 'string';
export function moduleDetailFromTool(value: unknown): ModuleDetail | null {
  const envelope = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const payload = envelope?.kind === 'creezio.widget.render.v1' ? envelope.input
    : envelope?.kind === 'creezio.widget.action.v1' && envelope.state === 'succeeded'
      ? envelope.output : value;
  return detail(payload) ? payload : null;
}

/** Read-only MCP Apps view; the existing management UI and operations remain authoritative. */
export function startWidget(): void {
  void (async () => {
    const app = new App({name: 'Creezio module detail', version: '1.0.0'}, {});
    const field = (id: string) => document.getElementById(id);
    const refresh = field('refresh') as HTMLButtonElement | null;
    const status = field('status');
    let moduleId: string | undefined;
    const show = (value: unknown) => {
      const result = moduleDetailFromTool(value);
      if (!result) { if (status) status.textContent = 'Fiche indisponible.'; return false; }
      moduleId = result.module.moduleId;
      if (field('title')) field('title')!.textContent = result.module.title;
      if (field('module-id')) field('module-id')!.textContent = result.module.moduleId;
      if (field('version')) field('version')!.textContent = result.module.version;
      if (field('state')) field('state')!.textContent = result.module.enabled ? 'Actif' : 'Inactif';
      return true;
    };
    app.addEventListener('toolresult', result => show(result.structuredContent));
    try { await app.connect(new PostMessageTransport(window.parent, window.parent)); }
    catch { if (status) status.textContent = 'Pont MCP Apps indisponible.'; return; }
    if (refresh) refresh.disabled = !app.getHostCapabilities()?.serverTools;
    refresh?.addEventListener('click', async () => {
      if (!moduleId) return;
      try {
        const result = await app.callServerTool({name: 'modules_catalog_detail', arguments: {moduleId}});
        if (result.isError) { if (status) status.textContent = 'Lecture refusée.'; return; }
        if (show(result.structuredContent) && status) status.textContent = 'Fiche relue sans tour IA.';
      } catch { if (status) status.textContent = 'Résultat inconnu ; vérifier avant de réessayer.'; }
    });
  })();
}
