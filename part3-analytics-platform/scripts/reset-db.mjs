import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(projectRoot);

const dbFile = path.resolve(projectRoot, config.dbPath);
const allowedRoot = path.resolve(projectRoot, 'data');
const resolvedDbDir = path.dirname(dbFile);

function assertSafeDbPath() {
  const relative = path.relative(projectRoot, dbFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refuse to reset database outside project root: ${dbFile}`);
  }

  const relativeToData = path.relative(allowedRoot, dbFile);
  if (relativeToData.startsWith('..') || path.isAbsolute(relativeToData)) {
    throw new Error(`Refuse to reset database outside ./data: ${dbFile}`);
  }

  if (!dbFile.endsWith('.sqlite') && !dbFile.endsWith('.db')) {
    throw new Error(`Refuse to reset non-SQLite-looking file: ${dbFile}`);
  }
}

function removeIfExists(file) {
  if (fs.existsSync(file)) {
    fs.rmSync(file, { force: true });
    console.log(`removed ${path.relative(projectRoot, file)}`);
  }
}

assertSafeDbPath();
fs.mkdirSync(resolvedDbDir, { recursive: true });

removeIfExists(dbFile);
removeIfExists(`${dbFile}-wal`);
removeIfExists(`${dbFile}-shm`);
removeIfExists(`${dbFile}-journal`);

const { initDb, closeDb, getDbPath } = await import('../src/db.js');
initDb();
closeDb();

console.log(`database reset complete: ${path.relative(projectRoot, getDbPath())}`);
console.log('all previous SQLite data has been deleted; table structure has been recreated.');
