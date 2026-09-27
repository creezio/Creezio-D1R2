import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runSuite} from './run-suite.mjs';
export const run = () => runSuite('api-mcp');
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(run()));
