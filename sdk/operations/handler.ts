/** Public module authoring surface. The host retains credentials, SQL and commit authority. */
export { OperationError } from '../../core/operations/types.ts';
export type { OperationContext, OperationHandler, OperationHandlerResult, OperationDataPort }
  from '../../core/operations/types.ts';
export type { JsonValue, DataPlan } from '../../core/data/types.ts';
