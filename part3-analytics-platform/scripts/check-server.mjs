import { initDb, db } from '../src/db.js';
import { config } from '../src/config.js';
import { ok } from '../src/utils/response.js';

initDb();

// Test the database
try {
  const summary = db.prepare(`
    SELECT COUNT(*) AS n,
      SUM(CASE WHEN authenticity_confirmed = 1 AND is_seed = 0 THEN 1 ELSE 0 END) AS real_n,
      SUM(CASE WHEN is_seed = 1 THEN 1 ELSE 0 END) AS seed_n,
      AVG(grade_index) AS avg_grade_index,
      SUM(CASE WHEN grade_index <= 2 THEN 1 ELSE 0 END) AS pass_n,
      SUM(CASE WHEN grade_index >= 4 THEN 1 ELSE 0 END) AS polluted_n
    FROM reports WHERE city = @city
  `).get({ city: 'beijing' });
  console.log('DB summary ok:', JSON.stringify(summary));
} catch(e) {
  console.error('DB summary error:', e.message);
}

// Test the markers query
try {
  const rows = db.prepare(`
    SELECT * FROM reports WHERE city = @city ORDER BY datetime(measured_at) DESC LIMIT @limit
  `).all({ city: 'beijing', limit: 500 });
  console.log('Markers query ok, count:', rows.length);
} catch(e) {
  console.error('Markers query error:', e.message);
}

console.log('All checks passed');