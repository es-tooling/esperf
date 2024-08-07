import * as modReplacements from 'module-replacements';
import {type DependencyReplacement} from '../shared-types.js';
import {suggestReplacement} from '../suggest-replacement.js';

export function scanDependencies(
  dependencies: Record<string, string>,
  replacements: modReplacements.ModuleReplacement[],
  source: 'dependencies' | 'devDependencies'
): DependencyReplacement[] {
  const results: DependencyReplacement[] = [];

  for (const key in dependencies) {
    for (const replacement of replacements) {
      if (key === replacement.moduleName) {
        results.push({
          replacement,
          name: replacement.moduleName,
          source
        });
        suggestReplacement(replacement, {type: 'package', source});
      }
    }
  }

  return results;
}
