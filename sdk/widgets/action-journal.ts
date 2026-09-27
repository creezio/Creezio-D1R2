/** A command is journaled before dispatch so a lost HTTP response cannot invite a replay. */
export interface WidgetActionJournalScope {
  readonly sessionId: string;
  readonly principalId: string;
  readonly audience: 'admin' | 'app';
  readonly contextId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly instanceId: string;
  readonly instanceRevision: number;
}

export interface WidgetPendingCommand {
  readonly bindingId: string;
  readonly operationDigest: string;
  readonly toolName: string;
  readonly requestKey: string;
  readonly executionId?: string;
}
export interface WidgetApprovalDraft extends WidgetPendingCommand {
  readonly moduleId: string;
  readonly operationId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly approvalId?: string;
}

const prefix = 'creezio.widget-command.v1:';
const approvalPrefix = 'creezio.widget-approval.v1:';
const digest = /^sha256-[a-f0-9]{64}$/;
const ident = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const valid = (value: unknown): value is WidgetPendingCommand => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).every(key => ['bindingId', 'operationDigest', 'toolName',
    'requestKey', 'executionId'].includes(key)) &&
    typeof row.bindingId === 'string' && ident.test(row.bindingId) &&
    typeof row.operationDigest === 'string' && digest.test(row.operationDigest) &&
    typeof row.toolName === 'string' && row.toolName.length > 0 && row.toolName.length <= 128 &&
    typeof row.requestKey === 'string' && ident.test(row.requestKey) &&
    (row.executionId === undefined || typeof row.executionId === 'string' && ident.test(row.executionId));
};
const sensitive = /password|passwd|secret|token|api[_-]?key|authorization|credential|private[_-]?key|cookie/i;
function safeInput(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
    typeof value === 'number' && Number.isFinite(value)) return true;
  if (Array.isArray(value)) return value.length <= 100 && value.every(item => safeInput(item, depth + 1));
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length <= 100 && Object.entries(row).every(([key, item]) =>
    key.length <= 128 && !sensitive.test(key) && safeInput(item, depth + 1));
}
const validApproval = (value: unknown): value is WidgetApprovalDraft => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['bindingId', 'operationDigest', 'toolName',
    'requestKey', 'moduleId', 'operationId', 'input', 'approvalId'].includes(key)) ||
    !valid({bindingId:row.bindingId,operationDigest:row.operationDigest,
      toolName:row.toolName,requestKey:row.requestKey}) ||
    typeof row.moduleId !== 'string' || !ident.test(row.moduleId) ||
    typeof row.operationId !== 'string' || !ident.test(row.operationId) ||
    row.approvalId !== undefined && (typeof row.approvalId !== 'string' || !ident.test(row.approvalId)) ||
    !row.input || typeof row.input !== 'object' || Array.isArray(row.input) || !safeInput(row.input)) return false;
  try { return new TextEncoder().encode(JSON.stringify(row)).byteLength <= 16_384; }
  catch { return false; }
};

/** The key field comes from the compiled operation, never from iframe arguments. */
export function widgetOperationInput(tool: Readonly<{operationKind: 'query' | 'command';
  idempotencyKeyField: string | null}>, args: Readonly<Record<string, unknown>>,
  requestKey: string): Readonly<Record<string, unknown>> | null {
  if (tool.operationKind === 'query') return {...args};
  if (!tool.idempotencyKeyField || !ident.test(tool.idempotencyKeyField) ||
    !ident.test(requestKey)) return null;
  return {...args, [tool.idempotencyKeyField]: requestKey};
}

export function widgetActionJournal(scope: WidgetActionJournalScope, storage: Storage) {
  const key = `${prefix}${JSON.stringify(scope)}`;
  return Object.freeze({
    read(): WidgetPendingCommand | null {
      try {
        const raw = storage.getItem(key);
        if (!raw || raw.length > 1024) return null;
        const parsed: unknown = JSON.parse(raw);
        return valid(parsed) ? parsed : null;
      } catch { return null; }
    },
    write(command: WidgetPendingCommand): boolean {
      if (!valid(command)) return false;
      try { storage.setItem(key, JSON.stringify(command)); return storage.getItem(key) === JSON.stringify(command); }
      catch { return false; }
    },
    clear(): void { try { storage.removeItem(key); } catch { /* storage may be unavailable */ } },
  });
}

/** Approval requests are idempotent by the operation key, so a lost response can be re-read. */
export function widgetApprovalJournal(scope: WidgetActionJournalScope, storage: Storage) {
  const key = `${approvalPrefix}${JSON.stringify(scope)}`;
  return Object.freeze({
    read(): WidgetApprovalDraft | null {
      try {
        const raw = storage.getItem(key);
        if (!raw || raw.length > 16_384) return null;
        const parsed: unknown = JSON.parse(raw);
        return validApproval(parsed) ? parsed : null;
      } catch { return null; }
    },
    write(draft: WidgetApprovalDraft): boolean {
      if (!validApproval(draft)) return false;
      const serialized = JSON.stringify(draft);
      try { storage.setItem(key, serialized); return storage.getItem(key) === serialized; }
      catch { return false; }
    },
    clear(): void { try { storage.removeItem(key); } catch { /* storage may be unavailable */ } },
  });
}

/** Never expose a decision preview until its grant ID survived browser storage. */
export function recordWidgetApprovalId(journal: Readonly<{write(draft: WidgetApprovalDraft): boolean}>,
  draft: WidgetApprovalDraft, approvalId: string): WidgetApprovalDraft | null {
  const recorded = {...draft,approvalId};
  return journal.write(recorded) ? recorded : null;
}
