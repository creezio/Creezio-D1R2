// Stripe charge/invoice amounts use zero decimals for these currencies.
// ISK and UGX remain encoded with two zero decimals for backwards compatibility.
const zeroDecimal=new Set(['BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF',
  'VND','VUV','XAF','XOF','XPF']);
export function formatStripeAmount(minor:number|null|undefined,currency:string|null|undefined):string{
  if(minor===null||minor===undefined||!Number.isSafeInteger(minor)||!currency)return '—';
  const code=currency.toUpperCase();
  if(!/^[A-Z]{3}$/.test(code))return '—';
  const scale=zeroDecimal.has(code)?1n:100n,raw=BigInt(minor),negative=raw<0n;
  const magnitude=negative?-raw:raw,whole=magnitude/scale,remainder=magnitude%scale;
  try{
    const formatter=new Intl.NumberFormat('fr-FR',{style:'currency',currency:code,
      minimumFractionDigits:0,maximumFractionDigits:0});
    const signed=negative?(whole===0n?-0:-Number(whole)):Number(whole);
    const parts=formatter.formatToParts(signed);
    if(scale===1n||(code==='ISK'||code==='UGX')&&remainder===0n)return parts.map(part=>part.value).join('');
    const end=parts.findLastIndex(part=>part.type==='integer');
    if(end<0)return '—';
    const decimal=new Intl.NumberFormat('fr-FR').formatToParts(1.1).find(part=>part.type==='decimal')?.value??',';
    parts.splice(end+1,0,{type:'decimal',value:decimal},{type:'fraction',value:String(remainder).padStart(2,'0')});
    return parts.map(part=>part.value).join('');
  }
  catch{return '—';}
}
