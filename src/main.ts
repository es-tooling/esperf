import * as cl from '@clack/prompts';
import * as modReplacements from 'module-replacements';
import {exit, cwd as getCwd} from 'node:process';
import {findPackage} from 'fd-package-json';
import dedent from 'dedent';
import {x} from 'tinyexec';
import {scanFiles} from './stages/scan-files.js';
import {fixFiles} from './stages/fix-files.js';
import {traverseFiles} from './stages/traverse-files.js';
import {scanDependencies} from './stages/scan-dependencies.js';

const availableManifests: Record<string, modReplacements.ManifestModule> = {
  native: modReplacements.nativeReplacements,
  'micro-utilities': modReplacements.microUtilsReplacements,
  preferred: modReplacements.preferredReplacements
};

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

export async function run(): Promise<void> {
  cl.intro('esperf');

  const tasks = await cl.multiselect({
    message: 'What would you like to do?',
    initialValues: ['module-replacements'],
    options: [
      {
        label: 'Scan for module replacements',
        value: 'module-replacements'
      }
    ]
  });

  if (cl.isCancel(tasks)) {
    cl.cancel('Operation cancelled');
    exit(0);
  }

  for (const task of tasks) {
    switch (task) {
      case 'module-replacements':
        await runModuleReplacements();
        break;
    }
  }

  cl.outro('All tasks complete!');
}
async function runModuleReplacements(): Promise<void> {
  const cwd = getCwd();
  const packageManifest = await findPackage(cwd);

  if (packageManifest === null) {
    cl.log.error(dedent`
      Could not find package.json. Please ensure that you run this command in a project which has one setup.
    `);
    cl.cancel();
    exit(0);
  }

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
          message: `Which directory would you like to scan for files? (default: ${cwd})`,
          defaultValue: cwd
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

  const scanSpinner = cl.spinner();

  scanSpinner.start('Scanning dependencies');

  const dependenciesToRemove: string[] = [];
  const devDependenciesToRemove: string[] = [];
  let dependenciesFound = false;

  if (isDependenciesLike(packageDependencies)) {
    scanSpinner.message('Scanning `package.json` dependencies');

    const traverseResults = scanDependencies(
      packageDependencies,
      manifestReplacements,
      'dependencies'
    );

    if (options.autoUninstall) {
      for (const result of traverseResults) {
        dependenciesToRemove.push(result.replacement.moduleName);
      }
    }

    if (traverseResults.length > 0) {
      dependenciesFound = true;
    }
  }

  if (
    options.includeDevDependencies &&
    isDependenciesLike(packageDevDependencies)
  ) {
    scanSpinner.message('Scanning `package.json` devDependencies');

    const traverseResults = scanDependencies(
      packageDevDependencies,
      manifestReplacements,
      'devDependencies'
    );

    if (options.autoUninstall) {
      for (const result of traverseResults) {
        devDependenciesToRemove.push(result.replacement.moduleName);
      }
    }

    if (traverseResults.length > 0) {
      dependenciesFound = true;
    }
  }

  scanSpinner.message('Scanning files');

  const files = await traverseFiles(options.filesDir);

  const scanFilesResult = await scanFiles(
    files,
    manifestReplacements,
    scanSpinner
  );

  if (scanFilesResult.length > 0) {
    dependenciesFound = true;
  }

  if (dependenciesFound) {
    scanSpinner.stop('Replaceable modules found.', 2);
  } else {
    scanSpinner.stop('No replaceable modules found.');
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

  if (options.fix) {
    await fixFiles(scanFilesResult);
  }
}
