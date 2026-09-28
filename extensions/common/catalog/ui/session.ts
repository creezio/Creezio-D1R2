type AccessSnapshot={readonly phase:'loading'|'anonymous'|'authenticated'|'unavailable';
  readonly pending:null|'login'|'logout';readonly session:{readonly id:string}|null};

/** A session read can hide the identity temporarily; only a definitive result replaces it. */
export function retainedSessionId(previous:string,access:AccessSnapshot):string{
  if(access.phase==='anonymous')return '';
  if(access.phase==='authenticated'&&!access.pending)return access.session?.id??'';
  return previous;
}

export function sessionVerified(access:AccessSnapshot,sessionId:string):boolean{
  return !!sessionId&&access.phase==='authenticated'&&!access.pending&&access.session?.id===sessionId;
}

export function sameCatalogScope(previous:{sessionId:string;audience:string;contextId:string},
  current:{sessionId:string;audience:string;contextId:string}):boolean{
  return previous.sessionId===current.sessionId&&previous.audience===current.audience&&
    previous.contextId===current.contextId;
}
