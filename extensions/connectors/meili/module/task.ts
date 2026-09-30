import {OperationError,type JsonValue} from '@creezio/sdk/operations/handler';

export type MeiliTaskState='enqueued'|'processing'|'succeeded'|'failed'|'canceled';
export interface MeiliTaskProof {
  readonly taskUid:number;
  readonly indexUid:string;
  readonly status:MeiliTaskState;
  readonly type:string;
}
const text=(value:unknown,max:number)=>typeof value==='string'&&value.length>0
  &&value.length<=max&&value.isWellFormed()&&!/[\u0000-\u001f\u007f]/u.test(value);

/** Provider errors and details never escape this fixed task projection. */
export function parseMeiliTask(value:JsonValue,expected:Readonly<{taskUid:number;indexUid:string}>):MeiliTaskProof{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new OperationError('unavailable');
  const row=value as Record<string,JsonValue>;
  if(!Number.isSafeInteger(expected.taskUid)||expected.taskUid<0||!text(expected.indexUid,400)
    ||row.uid!==expected.taskUid||row.indexUid!==expected.indexUid
    ||!['enqueued','processing','succeeded','failed','canceled'].includes(String(row.status))
    ||!text(row.type,80))throw new OperationError('unavailable');
  return {taskUid:expected.taskUid,indexUid:expected.indexUid,
    status:row.status as MeiliTaskState,type:row.type as string};
}

export function parseEnqueuedTask(value:JsonValue,indexUid:string,expectedType:string):MeiliTaskProof{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new OperationError('unavailable');
  const row=value as Record<string,JsonValue>;
  if(!Number.isSafeInteger(row.taskUid)||Number(row.taskUid)<0
    ||row.indexUid!==indexUid||row.status!=='enqueued'||row.type!==expectedType)
    throw new OperationError('unavailable');
  return {taskUid:Number(row.taskUid),indexUid,status:'enqueued',type:row.type as string};
}
