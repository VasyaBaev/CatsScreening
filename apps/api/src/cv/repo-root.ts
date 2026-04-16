/**
 * Определение корня репозитория в monorepo.
 *
 * Почему это нужно:
 * - `npm run --workspace apps/api ...` запускает процесс с cwd = `apps/api`,
 * - а файлы датасета/калибровки лежат относительно корня (`sources/`, `data/`),
 * - поэтому нам нужен надёжный способ найти repo root.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

let cachedRepoRoot: string | null = null;

async function looksLikeRepoRoot(dirAbs: string): Promise<boolean> {
  try {
    const pkgPath = path.join(dirAbs, 'package.json');
    const text = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(text) as { name?: unknown; workspaces?: unknown };
    return pkg.name === 'cats-screening' && Array.isArray(pkg.workspaces);
  } catch {
    return false;
  }
}

/**
 * Находит корень репозитория, поднимаясь вверх от стартовой директории.
 */
export async function findRepoRootAbs(startDirAbs: string = process.cwd()): Promise<string> {
  if (process.env.CATS_SCREENING_REPO_ROOT) return path.resolve(process.env.CATS_SCREENING_REPO_ROOT);
  if (cachedRepoRoot) return cachedRepoRoot;

  let dir = path.resolve(startDirAbs);
  for (let i = 0; i < 8; i += 1) {
    if (await looksLikeRepoRoot(dir)) {
      cachedRepoRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    [
      `Не удалось найти корень репозитория.`,
      `Подсказка: можно явно задать CATS_SCREENING_REPO_ROOT=<path>.`,
      `Стартовый cwd: ${startDirAbs}`
    ].join('\n')
  );
}

