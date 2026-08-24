import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareIsolatedRuntime } from '../desktop/scripts/dev.mjs';
import { validateRuntimeTree } from '../scripts/validate-runtime.mjs';

const require = createRequire(import.meta.url);
const { getMetisRuntimeIntegrityError } = require('../desktop/runtime-integrity.cjs') as {
  getMetisRuntimeIntegrityError: (cliPath: string) => string | undefined;
};

const tempDirs: string[] = [];

function runtimeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'metis-runtime-integrity-'));
  tempDirs.push(dir);
  return dir;
}

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('compiled runtime integrity', () => {
  it('accepts a complete relative ESM graph', () => {
    const root = runtimeDir();
    mkdirSync(join(root, 'utils'), { recursive: true });
    writeFileSync(join(root, 'cli.js'), 'import "./config.js";\n');
    writeFileSync(join(root, 'config.js'), 'export { value } from "./utils/child-process.js";\n');
    writeFileSync(join(root, 'utils/child-process.js'), 'export const value = 1;\n');

    expect(validateRuntimeTree(root)).toEqual([]);
  });

  it('rejects missing relative imports', () => {
    const root = runtimeDir();
    writeFileSync(join(root, 'cli.js'), 'import "./config.js";\n');

    expect(validateRuntimeTree(root)).toEqual([
      expect.objectContaining({
        kind: 'missing-import',
        source: 'cli.js',
        target: 'config.js',
      }),
    ]);
  });

  it('rejects iCloud-style numbered conflict directories', () => {
    const root = runtimeDir();
    writeFileSync(join(root, 'cli.js'), 'export {};\n');
    mkdirSync(join(root, 'utils 3'));

    expect(validateRuntimeTree(root)).toContainEqual(expect.objectContaining({
      kind: 'conflict-directory',
      target: 'utils 3',
    }));
  });

  it('builds an isolated Desktop dev runtime and wires startup preflight checks', async () => {
    const isolatedRuntime = runtimeDir();
    const isolatedCli = await prepareIsolatedRuntime(isolatedRuntime);
    const rootPackage = JSON.parse(source('package.json'));
    const copyAssetsSource = source('scripts/copy-assets.mjs');
    const devSource = source('desktop/scripts/dev.mjs');
    const mainSource = source('desktop/main.cjs');

    expect(rootPackage.scripts.build).toContain('node scripts/validate-runtime.mjs dist');
    expect(isolatedCli).toBe(join(isolatedRuntime, 'cli.js'));
    expect(existsSync(join(isolatedRuntime, 'cli/index.js'))).toBe(false);
    expect(validateRuntimeTree(isolatedRuntime)).toEqual([]);
    expect(getMetisRuntimeIntegrityError(isolatedCli)).toBeUndefined();
    expect(JSON.parse(source(`${isolatedRuntime}/package.json`))).toEqual({ type: 'module' });
    expect(copyAssetsSource).toContain('filter: shouldCopyRuntimeAsset');
    expect(copyAssetsSource).toContain('numberedConflictDirectoryPattern');
    expect(devSource).toContain('mkdtemp');
    expect(devSource).toContain('validateRuntimeTree');
    expect(devSource).toContain('METIS_DESKTOP_CLI_PATH');
    expect(devSource).toContain('METIS_PACKAGE_DIR');
    expect(mainSource).toContain('process.env.METIS_DESKTOP_CLI_PATH');
    expect(mainSource).toContain('getMetisRuntimeIntegrityError');
    expect(mainSource).toContain('Ignoring incomplete Metis CLI runtime');
  });
});
