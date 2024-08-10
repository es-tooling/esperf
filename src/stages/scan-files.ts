import * as modReplacements from 'module-replacements';
import * as cl from '@clack/prompts';
import {type FileReplacement} from '../shared-types.js';
import {cpuUsage} from 'node:process';
import {cpus, availableParallelism} from 'node:os';
import {Worker} from 'node:worker_threads';
import {fork} from 'node:child_process';
import Events from 'node:events';
const __dirname = import.meta.dirname;

const events = new Events();

let tasks = 0;

export async function _scanFile(
  file: string,
  replacements: modReplacements.ModuleReplacement[]
): Promise<FileReplacement> {
  // return new Promise((resolve, reject) => {
  const worker = fork(`${__dirname}/workers/scan-file.js`);
  worker.on('error', (error) => reject(error));
  worker.once('message', (message) => {
    if (message?.type === 'result') {
      // resolve(message.value);
      events.emit('file-scan-worker-result', message.value);
    } else {
      console.error(message.value);

      // reject(message.value);
    }
    events.emit('file-scan-worker-done');
    worker.kill();
  });
  worker.send({file, replacements});
  // });
}

export function scanFiles(
  files: string[],
  replacements: modReplacements.ModuleReplacement[],
  spinner: ReturnType<typeof cl.spinner>,
  results: FileReplacement[]
): Promise<FileReplacement[]> {
  return new Promise((resolve, reject) => {
    if (!results) results = [];
    let i = 0;
    const filesLength = files.length;

    const runJob = () => {
      const available = availableParallelism();

      let maxThreads;
      if (!tasks) maxThreads = available;
      else maxThreads = available - tasks;

      tasks = tasks + maxThreads;
      const targets = files.splice(
        0,
        files.length < maxThreads ? files.length : maxThreads
      );

      spinner.message(`Scanning files: ${targets.join(', ')}`);
      targets.forEach((file) => _scanFile(file, replacements));
    };
    events.on('file-scan-worker-done', () => {
      if (files.length > 0) runJob();
      tasks -= 1;
    });

    events.on('file-scan-worker-result', (result) => {
      results.push(result);
      i += 1;
      if (i === filesLength) {
        resolve(results);
      }
    });

    runJob();
  });
}
