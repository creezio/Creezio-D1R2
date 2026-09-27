// Isolated D1 recipe: reuse the established synthetic account/policy fixture.
import fixture from '../workspace/authorization-worker.mjs';
import {dispatchWidgetHttp} from '../../core/widgets/http.ts';

const digest = `sha256-${'a'.repeat(64)}`, origin = 'https://widgets.example.invalid';
const resourceUri = `ui://creezio/example.notes/card/1.0.0/${digest}.html`;
const catalog = {widgets:[{moduleId:'example.notes',widgetId:'card',version:'1.0.0',audiences:['app'],
  permissions:['example.notes:read'],resourceUri}],resources:[{uri:resourceUri,moduleId:'example.notes',widgetId:'card',
  version:'1.0.0',audiences:['app'],digest,text:'<!doctype html><p>Authorized card</p>',cspProfileId:digest,
  uiMeta:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},permissions:{}}}]};
const permissions = [{id:'example.notes:read',actors:['user'],audiences:['app']},
  {id:'example.notes:write',actors:['user'],audiences:['app']}];
export default {async fetch(request,env) {
  if (new URL(request.url).pathname === '/fixture') return fixture.fetch(request,env);
  return await dispatchWidgetHttp(request,{profile:'sites',bindings:{DB:env.DB}},
    {CREEZIO_APP_ORIGIN:origin,CREEZIO_WIDGET_SANDBOX_ORIGIN:'https://sandbox.example.invalid'},'widget-http-test',
    {permissions,catalog}) ?? new Response(null,{status:404});
}};
