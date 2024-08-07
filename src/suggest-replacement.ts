import * as modReplacements from 'module-replacements';
import pc from 'picocolors';
import dedent from 'dedent';
import * as cl from '@clack/prompts';
import {getDocsUrl, getMdnUrl} from './replacement-urls.js';
import {type Source} from './shared-types.js';

function renderSource(source: Source): string {
  switch (source.type) {
    case 'package':
      return dedent`
        ${pc.bold('package.json')}
      `;
    case 'file':
      return dedent`
        ${pc.bold(`${source.path} (${source.line}:${source.column})`)}

        ${source.snippet}
      `;
  }
}

function suggestDocumentedReplacement(
  replacement: modReplacements.DocumentedModuleReplacement,
  source: Source
): void {
  cl.log.warn(dedent`
    ${pc.bold(replacement.moduleName)} - ${renderSource(source)}

    Module ${pc.cyan(replacement.moduleName)} could be replaced with a more performant alternative.

    You can find an alternative in the following documentation:
    ${pc.underline(getDocsUrl(replacement.docPath))}
  `);
}

function suggestNativeReplacement(
  replacement: modReplacements.NativeModuleReplacement,
  source: Source
): void {
  cl.log.warn(dedent`
    ${pc.bold(replacement.moduleName)} - ${renderSource(source)}

    Module ${pc.cyan(replacement.moduleName)} could be replaced with the following native functionality:

    ${pc.underline(getMdnUrl(replacement.mdnPath))}
  `);
}

function suggestNoneReplacement(
  replacement: modReplacements.NoModuleReplacement,
  source: Source
): void {
  cl.log.warn(dedent`
    ${pc.bold(replacement.moduleName)} - ${renderSource(source)}

    Module ${pc.cyan(replacement.moduleName)} could be removed or replaced with a more performant alternative.
  `);
}

function suggestSimpleReplacement(
  replacement: modReplacements.SimpleModuleReplacement,
  source: Source
): void {
  cl.log.warn(dedent`
    ${pc.bold(replacement.moduleName)} - ${renderSource(source)}

    Module ${pc.cyan(replacement.moduleName)} could be replaced inline/native equivalent logic.

    ${replacement.replacement}
  `);
}

export function suggestReplacement(
  replacement: modReplacements.ModuleReplacement,
  source: Source
): void {
  switch (replacement.type) {
    case 'documented':
      return suggestDocumentedReplacement(replacement, source);
    case 'native':
      return suggestNativeReplacement(replacement, source);
    case 'none':
      return suggestNoneReplacement(replacement, source);
    case 'simple':
      return suggestSimpleReplacement(replacement, source);
  }
}
