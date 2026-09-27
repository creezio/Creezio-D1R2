import type {OperationHandler} from '../../../../../core/operations/types.ts';

/** Read and write through the bounded native DataPort; no SQL or credential reaches this module. */
export const read_record: OperationHandler = async (input, context) => {
  const {id} = input as {id: string};
  return {output: await context.data.get('record', {key: {id}})};
};

export const rename_record: OperationHandler = (input, context) => {
  const {id, title, revision} = input as {id: string; title: string; revision: number};
  return {output: {id, title, revision: revision + 1}, plans: [context.data.planPatch('record', {
    key: {id}, values: {title}, compare: {field: 'revision', expected: revision},
  })]};
};
