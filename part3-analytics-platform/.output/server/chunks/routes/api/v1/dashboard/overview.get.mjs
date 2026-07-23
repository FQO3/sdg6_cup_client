import { d as defineApiHandler, g as getApiQuery, a as db, s as sendOk, c as config } from '../../../../_/api.mjs';
import { a as toBool, t as toInt } from '../../../../_/common.mjs';
import '../../../../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'better-sqlite3';
import 'dotenv';

function buildWhere(query, includeTime = true) {
  const city = query.city || config.defaultCity;
  const district = query.district || void 0;
  const realOnly = toBool(query.real_only, false);
  const days = toInt(query.days, 30, { min: 1, max: 365 });
  const conditions = ["city = @city"];
  const params = { city, days };
  if (district) {
    conditions.push("district = @district");
    params.district = district;
  }
  if (realOnly) conditions.push("authenticity_confirmed = 1 AND is_seed = 0");
  if (includeTime) conditions.push("datetime(measured_at) >= datetime('now', '-' || @days || ' days')");
  return { where: `WHERE ${conditions.join(" AND ")}`, params, scope: { city, district: district || null, real_only: realOnly, days } };
}
const overview_get = defineApiHandler((event) => {
  const query = getApiQuery(event);
  const { where, params, scope } = buildWhere(query, false);
  const summary = db.prepare(`
    SELECT COUNT(*) AS n,
      SUM(CASE WHEN authenticity_confirmed = 1 AND is_seed = 0 THEN 1 ELSE 0 END) AS real_n,
      SUM(CASE WHEN is_seed = 1 THEN 1 ELSE 0 END) AS seed_n,
      AVG(grade_index) AS avg_grade_index,
      SUM(CASE WHEN grade_index <= 2 THEN 1 ELSE 0 END) AS pass_n,
      SUM(CASE WHEN grade_index >= 4 THEN 1 ELSE 0 END) AS polluted_n,
      AVG(ph) AS avg_ph, AVG(tds) AS avg_tds, AVG(turbidity) AS avg_turbidity,
      AVG(ec) AS avg_ec, AVG(temperature) AS avg_temperature
    FROM reports ${where}
  `).get(params);
  const worstDistricts = db.prepare(`
    SELECT district, COUNT(*) AS n, AVG(grade_index) AS avg_grade_index,
      SUM(CASE WHEN grade_index >= 4 THEN 1 ELSE 0 END) AS polluted_n
    FROM reports ${where}
    GROUP BY district
    HAVING n > 0
    ORDER BY avg_grade_index DESC, polluted_n DESC
    LIMIT 5
  `).all(params);
  const n = summary.n || 0;
  return sendOk(event, {
    scope,
    kpis: {
      total_reports: n,
      real_reports: summary.real_n || 0,
      seed_reports: summary.seed_n || 0,
      pass_rate: n ? Number(((summary.pass_n || 0) / n).toFixed(4)) : 0,
      polluted_count: summary.polluted_n || 0,
      avg_grade_index: summary.avg_grade_index === null ? null : Number(summary.avg_grade_index.toFixed(2))
    },
    averages: {
      ph: summary.avg_ph === null ? null : Number(summary.avg_ph.toFixed(2)),
      tds: summary.avg_tds === null ? null : Number(summary.avg_tds.toFixed(2)),
      turbidity: summary.avg_turbidity === null ? null : Number(summary.avg_turbidity.toFixed(2)),
      ec: summary.avg_ec === null ? null : Number(summary.avg_ec.toFixed(2)),
      temperature: summary.avg_temperature === null ? null : Number(summary.avg_temperature.toFixed(2))
    },
    worst_districts: worstDistricts.map((row) => ({
      district: row.district || "unknown",
      n: row.n,
      polluted_n: row.polluted_n,
      avg_grade_index: Number(row.avg_grade_index.toFixed(2))
    }))
  });
});

export { overview_get as default };
//# sourceMappingURL=overview.get.mjs.map
