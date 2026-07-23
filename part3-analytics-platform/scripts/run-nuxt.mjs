import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(here);
const cliArgs = process.argv.slice(2);

function findPackageBin(packagePrefix, relativeBin) {
  try {
    return require.resolve(relativeBin);
  } catch {
    // In this DeerFlow/Windows copied workspace, pnpm symlinks can point back
    // to the host's original absolute path. Fall back to the actual package
    // directories already present under this project's node_modules/.pnpm.
  }

  const pnpmDir = join(projectRoot, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) {
    throw new Error(`Cannot find pnpm store at ${pnpmDir}`);
  }

  const candidates = readdirSync(pnpmDir)
    .filter((name) => name.startsWith(packagePrefix))
    .map((name) => join(pnpmDir, name, 'node_modules', packagePrefix.slice(0, -1), ...relativeBin.split('/').slice(1)))
    .filter((candidate) => existsSync(candidate))
    .sort();

  if (!candidates.length) {
    throw new Error(`Cannot locate ${relativeBin} in node_modules/.pnpm. Please run pnpm install first.`);
  }

  return candidates[candidates.length - 1];
}

const nuxiBin = findPackageBin('nuxi@', 'nuxi/bin/nuxi.mjs');
const disableRequireEsm = '--no-experimental-require-module';
const existingNodeOptions = process.env.NODE_OPTIONS || '';
const nodeOptions = existingNodeOptions.includes(disableRequireEsm)
  ? existingNodeOptions
  : `${existingNodeOptions} ${disableRequireEsm}`.trim();

const child = spawn(process.execPath, [disableRequireEsm, nuxiBin, ...cliArgs], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions
  }
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
