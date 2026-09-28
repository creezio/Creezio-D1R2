import {readFileSync} from 'node:fs';
export const moduleRoot=new URL('../',import.meta.url);
export const read=name=>readFileSync(new URL(name,moduleRoot),'utf8');
export const manifest=JSON.parse(read('module/manifest.json'));
