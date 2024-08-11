import * as modReplacements from 'module-replacements';
import * as cl from '@clack/prompts';
import {type FileReplacement} from '../shared-types.js';
import {availableParallelism} from 'node:os';
import {Worker} from 'node:worker_threads';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const available = availableParallelism();

export function scanFiles(
  files: string[],
  replacements: modReplacements.ModuleReplacement[],
  threads: number,
  spinner: ReturnType<typeof cl.spinner>
): Promise<FileReplacement[]> {
  return new Promise((resolve, reject) => {
    let i = 0;
    let tasks = 0;
    const filesLength = files.length;
    const results: FileReplacement[] = [];

    for (const file of files.splice(0, threads)) {
      const worker = new Worker(`${__dirname}/workers/scan-file.js`);
      // todo, what todo with the errors?
      worker.on('error', (error) => reject(error.message));
      worker.on('message', (message) => {
        if (message?.type === 'result') {
          results.push(message.value);
          i += 1;
          if (i === filesLength) {
            resolve(results);
          }
        } else {
          reject(message.value);
        }
        if (files.length > 0) {
          if (available >= tasks) {
            const file = files.shift();
            spinner.message(`Scanning file: ${file}`);
            worker.postMessage({file, replacements});
          } else {
            tasks -= 1;
          }
        } else {
          worker.terminate();
        }
      });
      spinner.message(`Scanning file: ${file}`);
      worker.postMessage({file, replacements});
    }
  });
}
