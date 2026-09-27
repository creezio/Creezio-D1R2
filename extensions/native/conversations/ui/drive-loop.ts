import type {ConversationActionResult,ConversationTurn} from '../../../../sdk/conversations/types.ts';

type DriveResult=ConversationActionResult<ConversationTurn>;
type ActiveTurn=Pick<ConversationTurn,'id'|'state'>;
const terminal=new Set<ConversationTurn['state']>(['succeeded','failed','cancelled','no_provider']);

/** One active panel drives a turn serially, including provider continuations. */
export function startTurnDriveLoop(options:{
  turnId:string;
  getTurn:()=>ActiveTurn|null;
  drive:()=>Promise<DriveResult>;
  refresh:()=>Promise<unknown>;
  onIssue:(result:DriveResult)=>void;
  delayMs?:number;
  maxFailures?:number;
}) {
  let active=true,timer:ReturnType<typeof setTimeout>|null=null;
  let tickPromise:Promise<DriveResult|null>|null=null,drivePromise:Promise<DriveResult>|null=null;
  let failures=0;
  const delay=Math.max(0,options.delayMs??2000),maxFailures=Math.max(1,options.maxFailures??3);
  const current=()=>{const turn=options.getTurn();return turn?.id===options.turnId&&!terminal.has(turn.state)?turn:null;};
  const clearTimer=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
  const drive=()=>{
    if(drivePromise)return drivePromise;
    const request=options.drive();
    drivePromise=request;
    void request.finally(()=>{if(drivePromise===request)drivePromise=null;}).catch(()=>{});
    return request;
  };
  const schedule=()=>{
    clearTimer();
    const turn=active?current():null;
    if(turn&&turn.state!=='unknown'&&failures<maxFailures)
      timer=setTimeout(()=>{timer=null;void tick();},delay);
  };
  const tick=(force=false):Promise<DriveResult|null>=>{
    if(tickPromise)return tickPromise;
    const request=(async():Promise<DriveResult|null>=>{
      const turn=active?current():null;if(!turn)return null;
      let result:DriveResult|null=null;
      if(force||turn.state!=='unknown'){
        try{result=await drive();}
        catch{result={kind:'unknown',code:'drive_unavailable',requestKey:''};}
        if(!active)return result;
        if(result.kind==='ok')failures=0;
        else{failures++;options.onIssue(result);}
      }
      if(!active)return result;
      try{await options.refresh();}
      catch{failures++;options.onIssue({kind:'unknown',code:'refresh_unavailable',requestKey:''});}
      return result;
    })();
    tickPromise=request;
    void request.finally(()=>{if(tickPromise===request){tickPromise=null;schedule();}}).catch(()=>{});
    return request;
  };
  void tick();
  return Object.freeze({
    async resume():Promise<DriveResult|null>{
      failures=0;clearTimer();
      if(tickPromise)await tickPromise;
      if(!active||!current())return null;
      clearTimer();return tick(true);
    },
    stop(){active=false;clearTimer();},
  });
}
