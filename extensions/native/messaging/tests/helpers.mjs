import {readFileSync} from 'node:fs';
export const moduleRoot = new URL('../', import.meta.url);
export const repositoryRoot = new URL('../../../../', import.meta.url);
export const read = path => readFileSync(new URL(path, moduleRoot), 'utf8');
export const manifest = JSON.parse(read('module/manifest.json'));
