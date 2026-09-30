export type N8nWidgetKind='workflows'|'run';
type Audience='admin'|'app';
const object=(value:unknown):value is Record<string,unknown>=>
  !!value&&typeof value==='object'&&!Array.isArray(value);
const token=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=128;
const digest=/^sha256-[a-f0-9]{64}$/;
export type N8nHostInput={instanceId:string;audience:Audience};
export type N8nRender={instanceId:string;audience:Audience;input:unknown;
  host:'creezio'|'external-mcp';resourceUri:string|null;resourceDigest:string|null};
export const localRunId=(value:unknown):value is string=>typeof value==='string'&&
  value.length>0&&value.length<=128&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);

/** The internal chat supplies an exact toolinput instance; external MCP supplies a bound resource. */
export function n8nRender(kind:N8nWidgetKind,value:unknown,hostInput?:N8nHostInput|null):N8nRender|null{
  if(!object(value)||value.kind!=='creezio.widget.render.v1'||!object(value.instance))return null;
  const instance=value.instance;
  if(instance.moduleId!=='creezio.n8n'||instance.widgetId!==kind||instance.widgetVersion!=='1.0.0'
    ||!Number.isSafeInteger(instance.instanceRevision)||Number(instance.instanceRevision)<1
    ||instance.audience!=='admin'&&instance.audience!=='app'||!token(instance.instanceId))return null;
  if(instance.host==='creezio'){
    if(!hostInput||instance.instanceId!==hostInput.instanceId
      ||instance.audience!==hostInput.audience
      ||!token(instance.conversationId)||!token(instance.messageId))return null;
    return {instanceId:instance.instanceId,audience:instance.audience,input:value.input,
      host:'creezio',resourceUri:null,resourceDigest:null};
  }
  if(instance.host!=='external-mcp'||instance.instanceRevision!==1
    ||!token(value.invocationRequestId)||typeof instance.resourceDigest!=='string'
    ||!digest.test(instance.resourceDigest)
    ||instance.resourceUri!==`ui://creezio/creezio.n8n/${kind}/1.0.0/${instance.resourceDigest}.html`)
    return null;
  return {instanceId:instance.instanceId,audience:instance.audience,input:value.input,
    host:'external-mcp',resourceUri:instance.resourceUri,resourceDigest:instance.resourceDigest};
}

export function n8nRead(kind:N8nWidgetKind,runId:string){
  return kind==='workflows'?{name:'n8n_workflow_list',arguments:{limit:25}}:
    localRunId(runId)?{name:'n8n_run_read',arguments:{id:runId}}:null;
}

/** Internal action result and external render result have distinct, checked envelopes. */
export function n8nDirectOutput(kind:N8nWidgetKind,response:unknown,expected:N8nRender,
  runId:string):unknown|null{
  if(!object(response)||response.isError===true||!object(response.structuredContent))return null;
  const body=response.structuredContent;
  let output:unknown;
  if(expected.host==='creezio'&&body.kind==='creezio.widget.action.v1'
    &&body.state==='succeeded')output=body.output;
  else if(expected.host==='external-mcp'&&body.kind==='creezio.widget.render.v1'){
    const rendered=n8nRender(kind,body);
    if(!rendered||rendered.host!=='external-mcp'||rendered.audience!==expected.audience
      ||rendered.resourceUri!==expected.resourceUri||rendered.resourceDigest!==expected.resourceDigest)
      return null;
    output=rendered.input;
  }else return null;
  if(kind==='run'&&(!object(output)||!object(output.run)||output.run.id!==runId))return null;
  return output??null;
}
