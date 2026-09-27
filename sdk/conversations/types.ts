import type {AccessAudience, AccessController} from '../access/types.ts';
import type {OperationClient, OperationClientResult} from '../operations/client.ts';
import type {StagedFileReference} from '../files/types.ts';

export type ConversationMode = 'chat' | 'work';
export interface ConversationSummary {
  readonly id:string; readonly title:string; readonly mode:ConversationMode;
  readonly updatedAt:string; readonly archivedAt:string|null; readonly revision:number;
}
export interface ConversationMessage {
  readonly id:string; readonly conversationId:string;
  readonly role:'user'|'assistant'|'tool'|'system'; readonly body:string;
  readonly createdAt:string; readonly revision:number;
}
export interface ConversationTurn {
  readonly id:string; readonly conversationId:string;
  readonly state:'queued'|'running'|'succeeded'|'failed'|'cancel_requested'|'cancelled'|'no_provider'|'unknown';
  readonly providerId:string|null; readonly updatedAt:string; readonly lastSequence:number; readonly errorCode:string|null;
  readonly revision:number;
}
export interface ConversationEvent {
  readonly turnId:string; readonly sequence:number; readonly kind:string;
  readonly payload:unknown; readonly createdAt:string;
}
export interface ConversationAttachment {
  readonly fileId:string; readonly conversationId:string; readonly filename:string;
  readonly contentType:string; readonly byteSize:number; readonly createdAt:string;
  readonly reference:StagedFileReference;
}
export interface ConversationPage<T> {readonly items:readonly T[];readonly nextCursor:string|null}
export interface ConversationDraft {
  readonly conversationId:string; readonly text:string; readonly updatedAt:string|null; readonly revision:number;
}
export interface ConversationsSnapshot {
  readonly phase:'anonymous'|'loading'|'ready'|'unavailable';
  readonly provider:'no_provider'|'configured';
  readonly conversations:readonly ConversationSummary[];
  readonly nextCursor:string|null;
  readonly selected:ConversationSummary|null;
  readonly messages:readonly ConversationMessage[];
  readonly messagesNextCursor:string|null;
  readonly draft:ConversationDraft|null;
  readonly activeTurn:ConversationTurn|null;
  readonly turnEvents:readonly ConversationEvent[];
  readonly searchQuery:string;
  readonly archived:boolean;
  readonly pending:boolean;
  readonly unknown:Readonly<{bindingId:string;requestKey:string;code:string}>|null;
  readonly error:string|null;
}
export type ConversationActionResult<T=unknown> = Readonly<{kind:'ok';value:T}>
  | Readonly<{kind:'rejected';code:string}>
  | Readonly<{kind:'unknown';code:string;requestKey:string}>;
export interface ConversationsControllerOptions {
  readonly access:AccessController;
  readonly client:OperationClient;
  readonly audience:AccessAudience;
  readonly contextId:string;
  readonly active?:boolean;
  /** Same-origin host drive transport; injectable only for controlled client tests. */
  readonly driveFetch?:typeof fetch;
}
export interface ConversationsController {
  getSnapshot():ConversationsSnapshot;
  subscribe(listener:()=>void):()=>void;
  setActive(active:boolean):void;
  refresh():Promise<void>;
  loadMore():Promise<void>;
  search(input:{query:string;cursor?:string|null;limit?:number;archived?:boolean}):Promise<ConversationPage<ConversationSummary>|null>;
  open(conversationId:string):Promise<void>;
  loadMoreMessages():Promise<void>;
  create(input:{mode:ConversationMode;title?:string}):Promise<ConversationActionResult<ConversationSummary>>;
  rename(conversationId:string,title:string):Promise<ConversationActionResult<ConversationSummary>>;
  archive(conversationId:string):Promise<ConversationActionResult<ConversationSummary>>;
  restore(conversationId:string):Promise<ConversationActionResult<ConversationSummary>>;
  addMessage(conversationId:string,body:string):Promise<ConversationActionResult<ConversationMessage>>;
  startTurn(conversationId:string,body:string,modelId:string):Promise<ConversationActionResult<{
    message:ConversationMessage;turn:ConversationTurn}>>;
  driveTurn(conversationId:string,turnId:string):Promise<ConversationActionResult<ConversationTurn>>;
  refreshTurn(conversationId:string,turnId:string):Promise<ConversationTurn|null>;
  setDraft(conversationId:string,text:string):void;
  saveDraft(conversationId:string,text?:string):Promise<ConversationActionResult<ConversationDraft>>;
  readTurn(conversationId:string,turnId:string):Promise<ConversationTurn|null>;
  readEvents(conversationId:string,turnId:string,afterSequence?:number):Promise<{items:readonly ConversationEvent[];nextSequence:number|null}|null>;
  cancelTurn(conversationId:string,turnId:string,revision:number):Promise<ConversationActionResult<ConversationTurn|null>>;
  linkAttachment(conversationId:string,staged:StagedFileReference):Promise<ConversationActionResult<{fileId:string;conversationId:string}>>;
  listAttachments(conversationId:string,cursor?:string|null,limit?:number):Promise<ConversationPage<ConversationAttachment>|null>;
  reconcileUnknown():Promise<OperationClientResult|null>;
  dispose():void;
}
