export type HermesWidgetKind='capabilities'|'models'|'run';
type Audience='admin'|'app';
const record=(value:unknown):value is Record<string,unknown>=>
  !!value&&typeof value==='object'&&!Array.isArray(value);
const token=(value:unknown):value is string=>typeof value==='string'
  &&value.length>0&&value.length<=128;
const digest=/^sha256-[a-f0-9]{64}$/;
export type HermesRender={instanceId:string;audience:Audience;input:unknown;
  host:'creezio'|'external-mcp';resourceUri:string|null;resourceDigest:string|null};
export type HermesHostInput={instanceId:string;audience:Audience};
export const localRunId=(value:unknown):value is string=>typeof value==='string'
  &&value.length>0&&value.length<=128&&/^[-A-Za-z0-9_.:]+$/.test(value);

/** Only the host's exact render instance can activate direct controls. */
export function hermesRender(kind:HermesWidgetKind,value:unknown,hostInput?:HermesHostInput|null):HermesRender|null{
  if(!record(value)||value.kind!=='creezio.widget.render.v1'||!record(value.instance))return null;
  const instance=value.instance;
  if(instance.moduleId!=='creezio.hermes'||instance.widgetId!==kind
    ||instance.widgetVersion!=='1.0.0'||!Number.isSafeInteger(instance.instanceRevision)
    ||Number(instance.instanceRevision)<1
    ||instance.audience!=='admin'&&instance.audience!=='app'
    ||kind!=='run'&&instance.audience!=='admin'
    ||!token(instance.instanceId))return null;
  if(instance.host==='creezio'){
    if(!hostInput||instance.instanceId!==hostInput.instanceId
      ||instance.audience!==hostInput.audience
      ||!token(instance.conversationId)||!token(instance.messageId))return null;
    return {instanceId:instance.instanceId,audience:instance.audience,input:value.input,
      host:'creezio',resourceUri:null,resourceDigest:null};
  }
  if(instance.host!=='external-mcp'||instance.instanceRevision!==1
    ||!token(value.invocationRequestId)
    ||typeof instance.resourceDigest!=='string'||!digest.test(instance.resourceDigest)
    ||instance.resourceUri!==`ui://creezio/creezio.hermes/${kind}/1.0.0/${instance.resourceDigest}.html`)
    return null;
  return {instanceId:instance.instanceId,audience:instance.audience,input:value.input,
    host:'external-mcp',resourceUri:instance.resourceUri,resourceDigest:instance.resourceDigest};
}

/** A widget can only call the three already authorized queries, never submit or stop. */
export function hermesRead(kind:HermesWidgetKind,runId:string):
  {name:string;arguments:Record<string,unknown>}|null{
  if(kind==='capabilities')return {name:'hermes_capabilities_read',arguments:{}};
  if(kind==='models')return {name:'hermes_models_list',arguments:{}};
  return localRunId(runId)?{name:'hermes_run_read',arguments:{id:runId}}:null;
}

/** The internal bridge returns an action outcome; external MCP returns another bound render envelope. */
export function hermesDirectOutput(kind:HermesWidgetKind,response:unknown,
  expected:HermesRender,runId:string):unknown|null{
  if(!record(response)||response.isError===true||!record(response.structuredContent))return null;
  const body=response.structuredContent;
  let output:unknown;
  if(expected.host==='creezio'&&body.kind==='creezio.widget.action.v1'
    &&body.state==='succeeded')output=body.output;
  else if(expected.host==='external-mcp'&&body.kind==='creezio.widget.render.v1'){
    const rendered=hermesRender(kind,body);
    if(!rendered||rendered.host!=='external-mcp'||rendered.audience!==expected.audience
      ||rendered.resourceUri!==expected.resourceUri||rendered.resourceDigest!==expected.resourceDigest)
      return null;
    output=rendered.input;
  }else return null;
  if(kind==='run'&&(!record(output)||!record(output.run)||output.run.id!==runId))return null;
  return output??null;
}
