/** A small per-view budget for visible product images. The file host allows 30 reads/minute. */
export function createImageGate(options:{now?:()=>number;delay?:(run:()=>void,ms:number)=>ReturnType<typeof setTimeout>;
  clear?:(timer:ReturnType<typeof setTimeout>)=>void;maxConcurrent?:number;maxPerMinute?:number}={}){
  const now=options.now??Date.now,delay=options.delay??setTimeout,clear=options.clear??clearTimeout;
  const maxConcurrent=options.maxConcurrent??3,maxPerMinute=options.maxPerMinute??20;
  const issued:number[]=[],pending:{current:()=>boolean;run:()=>Promise<unknown>;
    resolve:(value:unknown)=>void;reject:(error:unknown)=>void}[]=[];
  let active=0,timer:ReturnType<typeof setTimeout>|null=null;
  const pump=()=>{
    if(timer!==null){clear(timer);timer=null;}
    while(active<maxConcurrent&&pending.length){
      const at=now();while(issued.length&&issued[0]!<=at-60000)issued.shift();
      const next=pending[0]!;
      if(!next.current()){pending.shift();next.resolve(undefined);continue;}
      if(issued.length>=maxPerMinute){
        timer=delay(pump,Math.max(1,issued[0]!+60000-at));return;
      }
      pending.shift();issued.push(at);active++;
      void Promise.resolve().then(next.run).then(next.resolve,next.reject).finally(()=>{active--;pump();});
    }
  };
  return Object.freeze({
    run<T>(current:()=>boolean,task:()=>Promise<T>):Promise<T|undefined>{
      return new Promise<T|undefined>((resolve,reject)=>{
        pending.push({current,run:task,resolve:value=>resolve(value as T|undefined),reject});pump();
      });
    },
    cancel(){if(timer!==null){clear(timer);timer=null;}for(const item of pending.splice(0))item.resolve(undefined);},
  });
}
export type ImageGate=ReturnType<typeof createImageGate>;
