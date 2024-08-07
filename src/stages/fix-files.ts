import pc from 'picocolors';
import {writeFile} from 'node:fs/promises';
import {codemods, type Codemod} from 'module-replacements-codemods';
import dedent from 'dedent';
import * as cl from '@clack/prompts';
import {type FileReplacement} from '../shared-types.js';

async function fixFile(
  scanResult: FileReplacement,
  cache: Record<string, Codemod>
): Promise<void> {
  let newContent = scanResult.contents;

  for (const replacement of scanResult.replacements) {
    const factory = codemods[replacement.moduleName];

    if (!factory) {
      continue;
    }

    const cachedInstance = cache[replacement.moduleName];
    let codemod;
    if (!cachedInstance) {
      codemod = factory({});
      cache[replacement.moduleName] = codemod;
    } else {
      codemod = cachedInstance;
    }

    try {
      const transformResult = await codemod.transform({
        file: {
          filename: scanResult.path,
          source: newContent
        }
      });

      cl.log.success(dedent`
        Applying codemod ${pc.cyan(replacement.moduleName)} to ${scanResult.path}
      `);

      newContent = transformResult;
    } catch (err) {
      cl.log.error(dedent`
        ${pc.bold('Error:')} the ${pc.cyan(replacement.moduleName)} codemod unexpectedly threw an exception:

        ${err}
      `);
    }
  }

  if (scanResult.contents !== newContent) {
    await writeFile(scanResult.path, newContent, 'utf8');
  }
}

export async function fixFiles(scanResults: FileReplacement[]): Promise<void> {
  const codemodCache: Record<string, Codemod> = {};

  for (const result of scanResults) {
    await fixFile(result, codemodCache);
  }
}
