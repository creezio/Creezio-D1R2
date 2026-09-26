import { readFileSync } from 'node:fs';
export const readFile = () => readFileSync('not-an-application-file', 'utf8');
