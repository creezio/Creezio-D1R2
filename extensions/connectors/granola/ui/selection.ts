/** A note detail or transcript page may update the panel only for its active selection. */
export function createSelectionFence(){
  let serial=0,selectedId='';
  return {
    open(id:string){selectedId=id;return ++serial;},
    reset(){selectedId='';serial++;},
    matches(ticket:number,id:string){return ticket===serial&&id===selectedId;}
  };
}
