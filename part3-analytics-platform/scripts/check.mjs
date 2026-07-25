import { initDb, db } from '../src/db.js';
import { config } from '../src/config.js';

initDb();
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables:', tables.map(r => r.name));
  const count = db.prepare('SELECT COUNT(*) AS c FROM reports').get();
  console.log('Reports count:', count.c);
} catch (e) {
  console.error('DB error:', e.message);
}
console.log('Config:', JSON.stringify(config, null, 2));