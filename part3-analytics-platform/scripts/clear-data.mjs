/**
 * 清空数据库所有记录点 & 聚类数据，保留表结构。
 * 用法: node scripts/clear-data.mjs [--seed]
 *   --seed  清空后自动重新写入种子数据
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(projectRoot);

const { db, initDb, closeDb } = await import('../src/db.js');
initDb();

const runSeed = process.argv.includes('--seed');

// 按外键依赖顺序删除
const tables = [
  'water_quality_cluster_members',
  'water_quality_clusters',
  'water_quality_cluster_runs',
  'analysis_jobs',
  'analysis_results',
  'reports'
];

const transaction = db.transaction(() => {
  for (const table of tables) {
    const info = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
    db.prepare(`DELETE FROM ${table}`).run();
    console.log(`  ${table}: ${info.n} rows deleted`);
  }
});

console.log('Clearing all data...');
transaction();
console.log('All tables cleared. Database structure preserved.');

if (runSeed) {
  console.log('\nRe-seeding...');
  await import('../src/seed.js');
}

// 打印剩余记录数确认
console.log('\nPost-clear counts:');
for (const table of tables) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  console.log(`  ${table}: ${n}`);
}

closeDb();
console.log('\nDone.');
