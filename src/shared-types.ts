import * as modReplacements from 'module-replacements';

export interface FileReplacement {
  path: string;
  contents: string;
  replacements: modReplacements.ModuleReplacement[];
}

export interface DependencyReplacement {
  replacement: modReplacements.ModuleReplacement;
  source: 'dependencies' | 'devDependencies';
  name: string;
}

export interface PackageSource {
  type: 'package';
  source: 'dependencies' | 'devDependencies';
}

export interface FileSource {
  type: 'file';
  path: string;
  line: number;
  column: number;
  snippet: string;
}

export type Source = PackageSource | FileSource;
