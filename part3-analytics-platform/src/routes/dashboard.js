import { Router } from 'express';
import { db } from '../db.js';
import { ok, asyncHandler } from '../utils/response.js';
import { toInt, toBool } from '../utils/common.js';
import { config } from '../config.js';

export const dashboardRouter = Router();

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

dashboardRouter.get('/overview', asyncHandler(async (req, res) => {
  const { where, params, scope } = buildWhere(req.query, false);

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS n,
      SUM(CASE WHEN authenticity_confirmed = 1 AND is_seed = 0 THEN 1 ELSE 0 END) AS real_n,
      SUM(CASE WHEN is_seed = 1 THEN 1 ELSE 0 END) AS seed_n,
      AVG(grade_index) AS avg_grade_index,
      SUM(CASE WHEN grade_index <= 2 THEN 1 ELSE 0 END) AS pass_n,
      SUM(CASE WHEN grade_index >= 4 THEN 1 ELSE 0 END) AS polluted_n,
      AVG(ph) AS avg_ph,
      AVG(tds) AS avg_tds,
      AVG(turbidity) AS avg_turbidity,
      AVG(ec) AS avg_ec,
      AVG(temperature) AS avg_temperature
    FROM reports
    ${where}
  `).get(params);

  const worstDistricts = db.prepare(`
    SELECT district, COUNT(*) AS n, AVG(grade_index) AS avg_grade_index, SUM(CASE WHEN grade_index >= 4 THEN 1 ELSE 0 END) AS polluted_n
    FROM reports
    ${where}
    GROUP BY district
    HAVING n > 0
    ORDER BY avg_grade_index DESC, polluted_n DESC
    LIMIT 5
  `).all(params);

  const n = summary.n || 0;
  res.json(ok({
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
      district: row.district || 'unknown',
      n: row.n,
      polluted_n: row.polluted_n,
      avg_grade_index: Number(row.avg_grade_index.toFixed(2))
    }))
  }));
}));

dashboardRouter.get('/trend', asyncHandler(async (req, res) => {
  const bucket = req.query.bucket === 'week' ? 'week' : 'day';
  const { where, params, scope } = buildWhere(req.query, true);
  const bucketExpr = bucket === 'week' ? "strftime('%Y-W%W', measured_at)" : "date(measured_at)";

  const rows = db.prepare(`
    SELECT
      ${bucketExpr} AS bucket,
      COUNT(*) AS n,
      AVG(grade_index) AS avg_grade_index,
      AVG(ph) AS ph,
      AVG(tds) AS tds,
      AVG(turbidity) AS turbidity,
      AVG(ec) AS ec,
      AVG(temperature) AS temperature,
      SUM(CASE WHEN grade_index >= 4 THEN 1 ELSE 0 END) AS polluted_n
    FROM reports
    ${where}
    GROUP BY bucket
    ORDER BY bucket ASC
  `).all(params);

  res.json(ok({
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
  }));
}));
