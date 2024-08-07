import {fdir} from 'fdir';
import {extname} from 'node:path';

const knownFileExtensions = new Set<string>(['.tsx', '.ts', '.js', '.jsx']);

export async function traverseFiles(dirPath: string): Promise<string[]> {
  const fileScanner = new fdir();

  fileScanner
    .withFullPaths()
    .exclude((dirName) => dirName === 'node_modules')
    .filter((filePath, isDir) => {
      return !isDir && knownFileExtensions.has(extname(filePath));
    });

  return await fileScanner.crawl(dirPath).withPromise();
}
