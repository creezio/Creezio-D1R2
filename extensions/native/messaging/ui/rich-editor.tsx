'use client';

import {useEffect,useRef,useState} from 'react';

const allowed=new Set(['P','BR','STRONG','EM','B','I','UL','OL','LI','A']);
/** Only text and a narrow formatting vocabulary may enter the editable DOM. */
export function cleanFragment(html:string,doc:Document):DocumentFragment {
  const parsed=new DOMParser().parseFromString(html,'text/html'),out=doc.createDocumentFragment();
  const copy=(node:Node,parent:Node)=>{
    if(node.nodeType===Node.TEXT_NODE){parent.appendChild(doc.createTextNode(node.textContent??''));return;}
    if(!(node instanceof Element))return;
    if(!allowed.has(node.tagName)){for(const child of Array.from(node.childNodes))copy(child,parent);return;}
    const element=doc.createElement(node.tagName.toLowerCase());
    if(node.tagName==='A'){
      const href=node.getAttribute('href');
      if(href&&/^https?:\/\//i.test(href)){element.setAttribute('href',href);element.setAttribute('rel','noopener noreferrer');}
    }
    parent.appendChild(element);
    for(const child of Array.from(node.childNodes))copy(child,element);
  };
  for(const node of Array.from(parsed.body.childNodes))copy(node,out);
  return out;
}

export function RichEditor(props:{initialHtml:string;initialText:string;onChange:(html:string,text:string)=>void;disabled:boolean}) {
  const ref=useRef<HTMLDivElement|null>(null),range=useRef<Range|null>(null),
    [linkOpen,setLinkOpen]=useState(false),[link,setLink]=useState('');
  useEffect(()=>{const element=ref.current;if(!element)return;
    element.replaceChildren(props.initialHtml?cleanFragment(props.initialHtml,element.ownerDocument):
      element.ownerDocument.createTextNode(props.initialText));
  },[]);
  function report(){const element=ref.current;if(element)props.onChange(element.innerHTML,element.innerText);}
  function format(command:string,value?:string){if(props.disabled)return;ref.current?.focus();
    document.execCommand(command,false,value);report();}
  function insert(fragment:DocumentFragment){const element=ref.current;if(!element)return;
    element.focus();const selection=window.getSelection();let selected=selection?.rangeCount?selection.getRangeAt(0):null;
    if(!selected||!element.contains(selected.commonAncestorContainer)){
      selected=element.ownerDocument.createRange();selected.selectNodeContents(element);selected.collapse(false);
    }
    selected.deleteContents();const last=fragment.lastChild;selected.insertNode(fragment);
    if(last){selected.setStartAfter(last);selected.collapse(true);selection?.removeAllRanges();selection?.addRange(selected);}
    report();
  }
  return <div className="rounded-md border border-[#e6e0d4] bg-white">
    <div role="toolbar" aria-label="Mise en forme" className="flex flex-wrap gap-1 border-b border-[#e6e0d4] p-1 text-sm">
      <button type="button" disabled={props.disabled} aria-label="Gras" className="rounded px-2 py-1 font-bold hover:bg-[#f3eee4]" onMouseDown={e=>e.preventDefault()} onClick={()=>format('bold')}>B</button>
      <button type="button" disabled={props.disabled} aria-label="Italique" className="rounded px-2 py-1 italic hover:bg-[#f3eee4]" onMouseDown={e=>e.preventDefault()} onClick={()=>format('italic')}>I</button>
      <button type="button" disabled={props.disabled} aria-label="Liste à puces" className="rounded px-2 py-1 hover:bg-[#f3eee4]" onMouseDown={e=>e.preventDefault()} onClick={()=>format('insertUnorderedList')}>• Liste</button>
      <button type="button" disabled={props.disabled} aria-label="Liste numérotée" className="rounded px-2 py-1 hover:bg-[#f3eee4]" onMouseDown={e=>e.preventDefault()} onClick={()=>format('insertOrderedList')}>1. Liste</button>
      <button type="button" disabled={props.disabled} className="rounded px-2 py-1 hover:bg-[#f3eee4]"
        onMouseDown={e=>{e.preventDefault();range.current=window.getSelection()?.rangeCount?window.getSelection()!.getRangeAt(0).cloneRange():null;}}
        onClick={()=>setLinkOpen(true)}>Lien</button>
    </div>
    {linkOpen&&<div className="flex gap-2 border-b border-[#e6e0d4] p-2"><input aria-label="Adresse du lien" type="url" className="min-w-0 flex-1 rounded border px-2 py-1 text-sm" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://…"/>
      <button type="button" disabled={!/^https?:\/\//i.test(link)} onClick={()=>{
        if(range.current){const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range.current);}
        format('createLink',link);range.current=null;setLinkOpen(false);setLink('');}}>Insérer</button>
      <button type="button" onClick={()=>setLinkOpen(false)}>Annuler</button></div>}
    <div ref={ref} contentEditable={!props.disabled} suppressContentEditableWarning role="textbox" aria-label="Message"
      aria-multiline="true" onInput={report} onBlur={report}
      onPaste={event=>{event.preventDefault();if(props.disabled)return;
        const html=event.clipboardData.getData('text/html'),text=event.clipboardData.getData('text/plain');
        const doc=event.currentTarget.ownerDocument;
        const fragment=html?cleanFragment(html,doc):doc.createDocumentFragment();
        if(!html)fragment.appendChild(doc.createTextNode(text));insert(fragment);
      }}
      onDrop={event=>{event.preventDefault();if(props.disabled)return;
        const text=event.dataTransfer.getData('text/plain'),fragment=event.currentTarget.ownerDocument.createDocumentFragment();
        fragment.appendChild(event.currentTarget.ownerDocument.createTextNode(text));insert(fragment);
      }}
      className="prose prose-sm min-h-[160px] max-h-[340px] max-w-none overflow-y-auto px-3 py-2 text-sm text-[#14182f] focus:outline-none"/>
  </div>;
}
