const encoder=new TextEncoder();
const MAX_NODES=128,MAX_DEPTH=6,MAX_FIELDS=8,MAX_BYTES=768;
const bytes=value=>encoder.encode(value).length;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);

/** Small, declarative output annotations for a provider tool, never the output schema itself. */
export function providerOutputDescription(schema){
  const fields=[];
  let visited=0,length=0;
  const visit=(node,path,depth)=>{
    if(++visited>MAX_NODES||depth>MAX_DEPTH||fields.length>=MAX_FIELDS||!object(node))return;
    if(path&&typeof node.description==='string'){
      const description=node.description.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim();
      const field=`${path}: ${description}`;
      const cost=bytes(field)+(fields.length?2:0);
      if(description&&bytes(path)<=128&&cost<=MAX_BYTES-length){fields.push(field);length+=cost;}
    }
    if(object(node.properties))for(const [name,child] of Object.entries(node.properties)){
      if(fields.length>=MAX_FIELDS||visited>=MAX_NODES)break;
      visit(child,path?`${path}.${name}`:name,depth+1);
    }
    if(node.items)visit(node.items,`${path}[]`,depth+1);
    if(Array.isArray(node.anyOf))for(const child of node.anyOf){
      if(fields.length>=MAX_FIELDS||visited>=MAX_NODES)break;
      visit(child,path,depth+1);
    }
  };
  visit(schema,'',0);
  return fields.join('; ');
}
