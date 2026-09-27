import type {WidgetMessageContentV1, WidgetMessageInstanceV1} from './types.ts';

const bytes = new TextEncoder();
const plain = (value: unknown): value is Record<string, unknown> => !!value &&
  typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const digest = (value: unknown): value is `sha256-${string}` => typeof value === 'string' &&
  /^sha256-[a-f0-9]{64}$/.test(value);
const exact = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) =>
  required.every(key => Object.hasOwn(value, key)) &&
  Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const version = (value: unknown) => typeof value === 'string' && value.length <= 128 &&
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);

function boundedJson(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.isWellFormed();
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 1000 && value.every(item => boundedJson(item, depth + 1));
  if (plain(value)) return Object.keys(value).length <= 1000 &&
    Object.entries(value).every(([key, item]) => key.length <= 128 && boundedJson(item, depth + 1));
  return false;
}

export function validWidgetMessageContent(value: unknown): value is WidgetMessageContentV1 {
  if (!plain(value) || value.kind !== 'creezio.widget-message' || value.schemaVersion !== 1 ||
    !exact(value, ['kind', 'schemaVersion', 'instances']) ||
    !Array.isArray(value.instances) || value.instances.length < 1 || value.instances.length > 4 ||
    !boundedJson(value)) return false;
  try { if (bytes.encode(JSON.stringify(value)).byteLength > 4096) return false; } catch { return false; }
  const seen = new Set<string>();
  for (const candidate of value.instances) {
    if (!plain(candidate) || !exact(candidate, ['instanceId', 'instanceRevision', 'moduleId',
      'widgetId', 'widgetVersion', 'resourceUri', 'resourceDigest', 'state'],
      ['objectRef', 'objectVersion', 'renderExecution']) ||
      !id(candidate.instanceId) || seen.has(candidate.instanceId) ||
      !Number.isSafeInteger(candidate.instanceRevision) || (candidate.instanceRevision as number) < 1 ||
      !id(candidate.moduleId) || !id(candidate.widgetId) || !version(candidate.widgetVersion) ||
      !digest(candidate.resourceDigest) || !Object.hasOwn(candidate, 'state') ||
      candidate.objectRef !== undefined && !id(candidate.objectRef) ||
      candidate.objectVersion !== undefined && !(typeof candidate.objectVersion === 'string' && id(candidate.objectVersion)
        || typeof candidate.objectVersion === 'number' && Number.isSafeInteger(candidate.objectVersion))) return false;
    if (candidate.renderExecution !== undefined && (!plain(candidate.renderExecution) ||
      !exact(candidate.renderExecution, ['moduleId', 'operationId', 'operationDigest', 'executionId']) ||
      !id(candidate.renderExecution.moduleId) || !id(candidate.renderExecution.operationId) ||
      !digest(candidate.renderExecution.operationDigest) || !id(candidate.renderExecution.executionId))) return false;
    const expected = `ui://creezio/${candidate.moduleId}/${candidate.widgetId}/${candidate.widgetVersion}/${candidate.resourceDigest}.html`;
    if (candidate.resourceUri !== expected) return false;
    seen.add(candidate.instanceId);
  }
  return true;
}

export function widgetInstances(content: WidgetMessageContentV1): readonly WidgetMessageInstanceV1[] {
  return content.instances;
}
