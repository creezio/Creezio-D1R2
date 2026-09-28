import type {CommandScope,PendingCommand} from '@creezio/sdk/operations/command-journal';

export type CatalogPanel=CommandScope&Readonly<{tab:'products'|'categories';query:string;
  categoryId:string;selectedId:string}>;

const id=(value:unknown)=>typeof value==='string'&&value.length<=36&&
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);

/** No panel filter or selection crosses a verified identity boundary. */
export function readCatalogPanelState(value:unknown,scope:CommandScope):CatalogPanel|null{
  if(!scope.sessionId||!value||typeof value!=='object'||Array.isArray(value))return null;
  const saved=value as Record<string,unknown>;
  if(saved.sessionId!==scope.sessionId||saved.audience!==scope.audience||
    saved.contextId!==scope.contextId||!['products','categories'].includes(String(saved.tab))||
    typeof saved.query!=='string'||saved.query.length>120||
    typeof saved.categoryId!=='string'||saved.categoryId!==''&&!id(saved.categoryId)||
    typeof saved.selectedId!=='string'||saved.selectedId!==''&&!id(saved.selectedId))return null;
  return {sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId,
    tab:saved.tab as CatalogPanel['tab'],query:saved.query,
    categoryId:saved.categoryId,selectedId:saved.selectedId};
}

/** Every panel save carries the unresolved command, including tab/filter changes. */
export function catalogPanelState(panel:CatalogPanel,pending:PendingCommand|null){
  return {activeSubview:panel.tab,data:{...panel,
    ...(pending?{pending:{...pending}}:{})}};
}
