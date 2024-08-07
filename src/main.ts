import * as cl from '@clack/prompts';
import * as modReplacements from 'module-replacements';
import {exit, cwd} from 'node:process';
import {findPackage} from 'fd-package-json';
import dedent from 'dedent';
import pc from 'picocolors';
import {fdir} from 'fdir';
import {getDocsUrl, getMdnUrl} from './replacement-urls.js';
import {ts as sg} from '@ast-grep/napi';
import {readFile, writeFile} from 'node:fs/promises';
import {extname} from 'node:path';
import {codemods, type Codemod} from 'module-replacements-codemods';
import {x} from 'tinyexec';

const availableManifests: Record<string, modReplacements.ManifestModule> = {
  native: modReplacements.nativeReplacements,
  'micro-utilities': modReplacements.microUtilsReplacements,
  preferred: modReplacements.preferredReplacements
};

const packageManifest = await findPackage(cwd());

interface PackageSource {
  type: 'package';
  source: 'dependencies' | 'devDependencies';
}
interface FileSource {
  type: 'file';
  path: string;
  line: number;
  column: number;
  snippet: string;
}
type Source = PackageSource | FileSource;

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

function suggestReplacement(
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

interface DependencyResult {
  match: modReplacements.ModuleReplacement;
  source: PackageSource['source'];
}

function traverseDependencies(
  dependencies: Record<string, string>,
  replacements: modReplacements.ModuleReplacement[],
  source: PackageSource['source']
): DependencyResult[] {
  const results: DependencyResult[] = [];

  for (const key in dependencies) {
    for (const replacement of replacements) {
      if (key === replacement.moduleName) {
        results.push({
          match: replacement,
          source
        });
        suggestReplacement(replacement, {type: 'package', source});
      }
    }
  }

  return results;
}

interface ScanFileResult {
  path: string;
  contents: string;
  matches: modReplacements.ModuleReplacement[];
}

async function fixFile(
  scanResult: ScanFileResult,
  cache: Record<string, Codemod>
): Promise<void> {
  let newContent = scanResult.contents;

  for (const replacement of scanResult.matches) {
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

async function fixFiles(scanResults: ScanFileResult[]): Promise<void> {
  const codemodCache: Record<string, Codemod> = {};

  for (const result of scanResults) {
    await fixFile(result, codemodCache);
  }
}

async function scanFile(
  filePath: string,
  contents: string,
  lines: string[],
  replacements: modReplacements.ModuleReplacement[]
): Promise<ScanFileResult> {
  const ast = sg.parse(contents);
  const root = ast.root();
  const result: ScanFileResult = {
    path: filePath,
    contents,
    matches: []
  };

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
      result.matches.push(replacement);
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

  return result;
}

const knownFileExtensions = new Set<string>(['.tsx', '.ts', '.js', '.jsx']);

async function scanFiles(
  files: string[],
  replacements: modReplacements.ModuleReplacement[],
  spinner: ReturnType<typeof cl.spinner>
): Promise<ScanFileResult[]> {
  const results: ScanFileResult[] = [];

  for (const file of files) {
    try {
      const contents = await readFile(file, 'utf8');
      const lines = contents.split('\n');

      spinner.message(`Scanning ${file}`);

      results.push(await scanFile(file, contents, lines, replacements));
    } catch (err) {
      cl.log.error(dedent`
        Could not read file ${file}:

        ${String(err)}
      `);
    }
  }

  return results;
}

async function traverseFiles(dirPath: string): Promise<string[]> {
  const fileScanner = new fdir();

  fileScanner
    .withFullPaths()
    .exclude((dirName) => dirName === 'node_modules')
    .filter((filePath, isDir) => {
      return !isDir && knownFileExtensions.has(extname(filePath));
    });

  return await fileScanner.crawl(dirPath).withPromise();
}

function isDependenciesLike(obj: unknown): obj is Record<string, string> {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  for (const key in obj) {
    if (typeof (obj as Record<PropertyKey, unknown>)[key] !== 'string') {
      return false;
    }
  }
  return true;
}

cl.intro('mr-cli');

if (packageManifest === null) {
  cl.log.error(dedent`
    Could not find package.json. Please ensure that you run this command in a project which has one setup.
  `);
  cl.cancel();
  exit(0);
}

/**
 * TODO:
 *
 * - Lint `package.json` for module replacements
 * - Allow user to choose which manifests to apply (via strictness?)
 * - Offer to autofix ones with codemods
 */

cl.log.message(dedent`
  We will search your project for modules which can be replaced by faster or lighter alternatives.

  Before we do that, we need to determine what level of strictness you want to apply.
`);

const options = await cl.group(
  {
    manifests: () =>
      cl.multiselect({
        message: 'Choose which module lists to apply',
        initialValues: ['native', 'micro-utilities', 'preferred'],
        required: true,
        options: [
          {
            label: 'native',
            value: 'native',
            hint: 'modules with native replacements'
          },
          {
            label: 'micro utilities',
            hint: 'more opinionated list of modules which can be replaced with native code',
            value: 'micro-utilities'
          },
          {
            label: 'preferred',
            hint: 'opinionated list of faster and leaner packages',
            value: 'preferred'
          }
        ]
      }),
    includeDevDependencies: () =>
      cl.confirm({
        message: 'Include devDependencies?',
        initialValue: false
      }),
    filesDir: () =>
      cl.text({
        message: `Which directory would you like to scan for files? (default: ${cwd()})`,
        defaultValue: cwd()
      }),
    fix: () =>
      cl.confirm({
        message: 'Automatically apply codemods?',
        initialValue: false
      }),
    autoUninstall: () =>
      cl.confirm({
        message: 'Automatically uninstall packages?',
        initialValue: false
      })
  },
  {
    onCancel: () => {
      cl.cancel('Operation was cancelled.');
      exit(0);
    }
  }
);

const packageDependencies = packageManifest.dependencies;
const packageDevDependencies = packageManifest.devDependencies;

const manifestReplacements: modReplacements.ModuleReplacement[] = [];

for (const manifestName of options.manifests) {
  const manifestModule = availableManifests[manifestName];

  if (manifestModule) {
    for (const replacement of manifestModule.moduleReplacements) {
      manifestReplacements.push(replacement);
    }
  }
}

const packageScanSpinner = cl.spinner();

packageScanSpinner.start('Scanning `package.json` dependencies');

const dependenciesToRemove: string[] = [];
const devDependenciesToRemove: string[] = [];
let packageJsonFailed = false;

if (isDependenciesLike(packageDependencies)) {
  const traverseResults = traverseDependencies(
    packageDependencies,
    manifestReplacements,
    'dependencies'
  );

  if (options.autoUninstall) {
    for (const result of traverseResults) {
      dependenciesToRemove.push(result.match.moduleName);
    }
  }

  packageJsonFailed = true;
}

if (
  options.includeDevDependencies &&
  isDependenciesLike(packageDevDependencies)
) {
  const traverseResults = traverseDependencies(
    packageDevDependencies,
    manifestReplacements,
    'devDependencies'
  );

  if (options.autoUninstall) {
    for (const result of traverseResults) {
      devDependenciesToRemove.push(result.match.moduleName);
    }
  }

  packageJsonFailed = true;
}

if (packageJsonFailed) {
  packageScanSpinner.stop('`package.json` dependencies scanned successfully.');
} else {
  packageScanSpinner.stop(
    '`package.json` contained replaceable dependencies.',
    2
  );
}

if (
  options.autoUninstall &&
  (dependenciesToRemove.length > 0 || devDependenciesToRemove.length > 0)
) {
  const npmSpinner = cl.spinner();

  npmSpinner.start('Removing npm dependencies');

  if (dependenciesToRemove.length > 0) {
    await x('npm', ['rm', '-S', ...dependenciesToRemove]);
  }
  if (devDependenciesToRemove.length > 0) {
    await x('npm', ['rm', '-D', ...devDependenciesToRemove]);
  }

  npmSpinner.stop('npm dependencies removed');
}

const fileScanSpinner = cl.spinner();

fileScanSpinner.start('Scanning files');

const files = await traverseFiles(options.filesDir);

const scanFilesResult = await scanFiles(
  files,
  manifestReplacements,
  fileScanSpinner
);

if (scanFilesResult.length > 0) {
  fileScanSpinner.stop('Detected files with replaceable modules!', 2);
} else {
  fileScanSpinner.stop('All files scanned');
}

if (options.fix) {
  await fixFiles(scanFilesResult);
}

cl.outro('All checks complete!');
