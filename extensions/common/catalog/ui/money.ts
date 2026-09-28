/** Price is already in ISO currency minor units; determine the display exponent only. */
export function money(priceMinor:number,currency:string,locale='fr-FR'){
  if(!Number.isSafeInteger(priceMinor)||priceMinor<0||!/^[A-Z]{3}$/u.test(currency))return '—';
  try{
    const formatter=new Intl.NumberFormat(locale,{style:'currency',currency});
    const decimals=formatter.resolvedOptions().maximumFractionDigits??2;
    return formatter.format(priceMinor/10**decimals);
  }catch{return `${priceMinor} ${currency} (unités mineures)`;}
}
