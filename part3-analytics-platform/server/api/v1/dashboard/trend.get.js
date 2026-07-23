import { db } from '~~/src/db.js';
import { config } from '~~/src/config.js';
import { toBool, toInt } from '~~/src/utils/common.js';
import { defineApiHandler, getApiQuery, sendOk } from '../../../utils/api.js';

function buildWhere(query, includeTime = true) {
  const city = query.city || config.defaultCity;
  const district = query.district || undefined;
  const realOnly = toBool(query.real_only, false);
  const days = toInt(query.days, 30, { min: 1, max: 365 });
  const conditions = ['city = @city'];
  const params = { city, days };
  if (district) { conditions.push('district = @district'); params.district = district; }
  if (realOnly) conditions.push('authenticity_confirmed = 1 AND is_seed = 0');
  if (includeTime) conditions.push("datetime(measured_at) >= datetime('now', '-' || @days || ' days')");
  return { where: `WHERE ${conditions.join(' AND ')}`, params, scope: { city, district: district || null, real_only: realOnly, days } };
}

export default defineApiHandler((event) => {
  const query = getApiQuery(event);
  const bucket = query.bucket === 'week' ? 'week' : 'day';
  const { where, params, scope } = buildWhere(query, true);
  const bucketExpr = bucket === 'week' ? "strftime('%Y-W%W', measured_at)" : 'date(measured_at)';

  const rows = db.prepare(`
    SELECT ${bucketExpr} AS bucket,
      COUNT(*) AS n, AVG(grade_index) AS avg_grade_index,
      AVG(ph) AS ph, AVG(tds) AS tds, AVG(turbidity) AS turbidity,
      AVG(ec) AS ec, AVG(temperature) AS temperature,
      SUM(CASE WHEN grade_index >= 4 THEN 1 ELSE 0 END) AS polluted_n
    FROM reports ${where}
    GROUP BY bucket
    ORDER BY bucket ASC
  `).all(params);

  return sendOk(event, {
    scope: { ...scope, bucket },
    series: rows.map((row) => ({
      bucket: row.bucket,
      n: row.n,
      avg_grade_index: row.avg_grade_index === null ? null : Number(row.avg_grade_index.toFixed(2)),
      ph: row.ph === null ? null : Number(row.ph.toFixed(2)),
      tds: row.tds === null ? null : Number(row.tds.toFixed(2)),
      turbidity: row.turbidity === null ? null : Number(row.turbidity.toFixed(2)),
      ec: row.ec === null ? null : Number(row.ec.toFixed(2)),
      temperature: row.temperature === null ? null : Number(row.temperature.toFixed(2)),
      polluted_n: row.polluted_n || 0
    }))
  });
});
