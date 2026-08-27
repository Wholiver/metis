import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRuntimeTree } from '../../scripts/validate-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, '..');
const repositoryDir = path.resolve(desktopDir, '..');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal ?? 'unknown status'}`));
    });
  });
}

export async function prepareIsolatedRuntime(runtimeDir) {
  const executable = process.platform === 'win32' ? 'tsgo.cmd' : 'tsgo';
  const tsgoPath = path.join(repositoryDir, 'node_modules', '.bin', executable);
  await run(tsgoPath, ['-p', path.join(repositoryDir, 'tsconfig.build.json'), '--outDir', runtimeDir], {
    cwd: repositoryDir,
  });
  await writeFile(path.join(runtimeDir, 'package.json'), '{"type":"module"}\n');
  await symlink(
    path.join(repositoryDir, 'node_modules'),
    path.join(runtimeDir, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const issues = validateRuntimeTree(runtimeDir);
  if (issues.length > 0) {
    throw new Error(`Isolated Metis runtime failed integrity check: ${JSON.stringify(issues.slice(0, 10))}`);
  }
  return path.join(runtimeDir, 'cli.js');
}

async function main() {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), 'metis-desktop-runtime-'));
  let server;

  try {
    const cliPath = await prepareIsolatedRuntime(runtimeDir);
    console.log(`[desktop] Isolated CLI runtime active at ${runtimeDir}`);

    // Start Vite dev server
    server = await createServer({
      configFile: path.join(desktopDir, 'vite.config.ts'),
      root: desktopDir,
      server: {
        host: '0.0.0.0',
        port: 5173,
        strictPort: true,
      },
    });

    await server.listen();
    const devUrl = 'http://127.0.0.1:5173';
    console.log(`[desktop] Vite dev server active on ${devUrl}`);

    // Launch Electron
    const electronPkg = await import('electron');
    const electronPath = electronPkg.default || electronPkg;

    const electronProcess = spawn(electronPath, ['.'], {
      cwd: desktopDir,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: devUrl,
        METIS_DESKTOP_CLI_PATH: cliPath,
        METIS_PACKAGE_DIR: repositoryDir,
      },
      stdio: 'inherit',
    });

    electronProcess.on('close', async (code) => {
      await server.close();
      await rm(runtimeDir, { recursive: true, force: true });
      process.exit(code || 0);
    });

    electronProcess.on('error', async (err) => {
      console.error('[desktop] Failed to start Electron:', err);
      await server.close();
      await rm(runtimeDir, { recursive: true, force: true });
      process.exit(1);
    });
  } catch (error) {
    await server?.close();
    await rm(runtimeDir, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

