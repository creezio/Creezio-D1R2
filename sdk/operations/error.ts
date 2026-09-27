/** Shared runtime error identity for the host and installed module handlers. */
export type OperationErrorCode = 'invalid_catalog' | 'not_found' | 'invalid_input' | 'invalid_output' | 'unsupported' | 'approval_required'
  | 'unauthorized' | 'forbidden' | 'conflict' | 'rate_limited' | 'unavailable' | 'unknown' | 'cancelled' | 'timeout';

export class OperationError extends Error {
  readonly code: OperationErrorCode;
  constructor(code: OperationErrorCode) { super(`Operation refused (${code}).`); this.name = 'OperationError'; this.code = code; }
}
