import * as modReplacements from 'module-replacements';
import {ts as sg} from '@ast-grep/napi';
import {readFile} from 'node:fs/promises';
import dedent from 'dedent';
import pc from 'picocolors';
import {type FileReplacement} from './../../shared-types.js';
import {suggestReplacement} from './../../suggest-replacement.js';

async function scanFile(
  filePath: string,
  contents: string,
  lines: string[],
  replacements: modReplacements.ModuleReplacement[]
): Promise<FileReplacement | null> {
  const ast = sg.parse(contents);
  const root = ast.root();
  const matches: modReplacements.ModuleReplacement[] = [];

  for (const replacement of replacements) {
    const imports = root.findAll({
      rule: {
        any: [
          {
            pattern: {
              context: `import $NAME from '${replacement.moduleName}'`,
              strictness: 'relaxed'
            }
          },
          {
            pattern: {
              context: `require('${replacement.moduleName}')`,
              strictness: 'relaxed'
            }
          }
        ]
      }
    });

    if (imports.length > 0) {
      matches.push(replacement);
    }

    for (const node of imports) {
      const range = node.range();
      let snippet: string = '';

      const prevLine = lines[range.start.line - 1];
      const line = lines[range.start.line];
      const nextLine = lines[range.start.line + 1];

      if (prevLine) {
        snippet += `${range.start.line} | ${prevLine}\n`;
      }

      snippet += `${range.start.line + 1} | ${pc.red(line)}\n`;

      if (nextLine) {
        snippet += `${range.start.line + 2} | ${nextLine}\n`;
      }

      suggestReplacement(replacement, {
        type: 'file',
        path: filePath,
        line: range.start.line,
        column: range.start.column,
        snippet
      });
    }
  }

  if (matches.length === 0) {
    return null;
  }

  return {
    path: filePath,
    contents,
    replacements: matches
  };
}

async function scanTask(
  file: string,
  replacements: modReplacements.ModuleReplacement[]
) {
  try {
    const contents = await readFile(file, 'utf8');
    const lines = contents.split('\n');

    const scanResult = await scanFile(file, contents, lines, replacements);

    // if (scanResult) {
    // @ts-ignore
    process.send({type: 'result', value: scanResult});
    // } else {
    // process.exit(0);
    // }
  } catch (err) {
    process.send({
      type: 'error',
      value: dedent`
      Could not read file ${file}:

      ${String(err)}
    `
    });
    // cl.log.error(dedent`
    //   Could not read file ${file}:

    //   ${String(err)}
    // `);
  }
}

process.on(
  'message',
  (message: {
    file: string;
    replacements: modReplacements.ModuleReplacement[];
  }) => {
    scanTask(message.file, message.replacements);
  }
);
