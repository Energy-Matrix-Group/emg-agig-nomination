import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Build output, dependencies and planning documents are not page source.
const NOT_SOURCE = new Set(['node_modules', 'dist', 'docs', 'screenshots']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?)$/i;

// Every file under a folder that counts as source, without build output, dependencies or binaries.
export async function sourceFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!NOT_SOURCE.has(entry.name)) files.push(...await sourceFiles(fullPath));
    } else if (!BINARY.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}
