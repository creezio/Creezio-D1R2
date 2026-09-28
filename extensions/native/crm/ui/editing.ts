export type CrmEntity='company'|'contact'|'prospect';
export type CrmItem={id:string;name:string;city:string|null;notes:string|null;revision:number;archivedAt:string|null;
  website?:string|null;email?:string|null;phone?:string|null;companyId?:string|null;
  contactId?:string|null;contactName?:string|null;stage?:string;position?:number};
/** Revision belongs to the form snapshot, never to a later list refresh. */
export type CrmEditForm={id:string;revision:number;name:string;city:string;notes:string;website:string;email:string;
  phone:string;contactName:string;companyId:string;contactId:string;stage:string;position:string};
export type CrmEditField=keyof Omit<CrmEditForm,'id'|'revision'>;
export type CrmSubviewDraft={name:string;city:string;query:string;appliedQuery:string;archived:boolean;
  selected:string|null;selectedSnapshot:CrmItem|null;form:CrmEditForm|null};
export type CrmSubviewDrafts=Partial<Record<CrmEntity,CrmSubviewDraft>>;
export const emptySubviewDraft=():CrmSubviewDraft=>({name:'',city:'',query:'',appliedQuery:'',archived:false,
  selected:null,selectedSnapshot:null,form:null});
export function saveSubviewDraft(drafts:CrmSubviewDrafts,entity:CrmEntity,draft:CrmSubviewDraft):CrmSubviewDrafts{
  return {...drafts,[entity]:{...draft,selectedSnapshot:draft.selectedSnapshot?{...draft.selectedSnapshot}:null,
    form:draft.form?{...draft.form}:null}};
}
export const formFrom=(item:CrmItem):CrmEditForm=>({id:item.id,revision:item.revision,name:item.name,
  city:item.city??'',notes:item.notes??'',website:item.website??'',email:item.email??'',phone:item.phone??'',
  contactName:item.contactName??'',companyId:item.companyId??'',contactId:item.contactId??'',
  stage:item.stage??'a_contacter',position:String(item.position??0)});
export function updateFromForm(entity:CrmEntity,form:CrmEditForm):Record<string,unknown>{
  const patch:Record<string,unknown>={id:form.id,revision:form.revision,name:form.name.trim(),
    city:form.city||null,notes:form.notes||null};
  if(entity==='company')patch.website=form.website||null;
  if(entity==='contact')Object.assign(patch,{email:form.email||null,phone:form.phone||null,companyId:form.companyId||null});
  if(entity==='prospect')Object.assign(patch,{contactName:form.contactName||null,email:form.email||null,
    phone:form.phone||null,website:form.website||null,companyId:form.companyId||null,
    contactId:form.contactId||null,stage:form.stage,position:Number(form.position)});
  return patch;
}
