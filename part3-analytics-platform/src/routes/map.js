import { Router } from 'express';
import { db } from '../db.js';
import { ok, asyncHandler } from '../utils/response.js';
import { toInt, toBool } from '../utils/common.js';
import { gradeColor } from '../utils/constants.js';

export const mapRouter = Router();

function markerFromRow(row) {
  return {
    report_id: row.report_id,
    position: [row.lng, row.lat],
    lng: row.lng,
    lat: row.lat,
    city: row.city,
    district: row.district,
    address: row.address,
    water_type: row.water_type,
    grade: row.grade,
    grade_index: row.grade_index,
    color: gradeColor(row.grade_index),
    metrics: {
      tds: row.tds,
      ph: row.ph,
      temperature: row.temperature,
      turbidity: row.turbidity,
      ec: row.ec
    },
    is_real: Boolean(row.authenticity_confirmed && !row.is_seed),
    measured_at: row.measured_at
  };
}

mapRouter.get('/markers', asyncHandler(async (req, res) => {
  const city = req.query.city || undefined;
  const district = req.query.district || undefined;
  const gradeMax = req.query.grade_max === undefined ? undefined : Number.parseInt(req.query.grade_max, 10);
  const realOnly = toBool(req.query.real_only, false);
  const limit = toInt(req.query.limit, 500, { min: 1, max: 2000 });

  const conditions = [];
  const params = {};
  if (city) { conditions.push('city = @city'); params.city = city; }
  if (district) { conditions.push('district = @district'); params.district = district; }
  if (Number.isInteger(gradeMax)) { conditions.push('grade_index <= @gradeMax'); params.gradeMax = gradeMax; }
  if (realOnly) { conditions.push('authenticity_confirmed = 1 AND is_seed = 0'); }
  params.limit = limit;

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT * FROM reports
    ${where}
    ORDER BY datetime(measured_at) DESC
    LIMIT @limit
  `).all(params);

  res.json(ok({ markers: rows.map(markerFromRow), count: rows.length }));
}));

mapRouter.get('/summary', asyncHandler(async (req, res) => {
  const city = req.query.city || undefined;
  const district = req.query.district || undefined;
  const realOnly = toBool(req.query.real_only, false);
  const conditions = [];
  const params = {};
  if (city) { conditions.push('city = @city'); params.city = city; }
  if (district) { conditions.push('district = @district'); params.district = district; }
  if (realOnly) { conditions.push('authenticity_confirmed = 1 AND is_seed = 0'); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS n,
      SUM(CASE WHEN authenticity_confirmed = 1 AND is_seed = 0 THEN 1 ELSE 0 END) AS real_n,
      AVG(grade_index) AS avg_grade_index,
      AVG(ph) AS avg_ph,
      AVG(tds) AS avg_tds,
      AVG(turbidity) AS avg_turbidity,
      AVG(ec) AS avg_ec,
      AVG(temperature) AS avg_temperature,
      SUM(CASE WHEN grade_index <= 2 THEN 1 ELSE 0 END) AS pass_n,
      SUM(CASE WHEN grade_index >= 4 THEN 1 ELSE 0 END) AS polluted_n
    FROM reports
    ${where}
  `).get(params);

  const gradeRows = db.prepare(`
    SELECT grade, grade_index, COUNT(*) AS count
    FROM reports
    ${where}
    GROUP BY grade, grade_index
    ORDER BY grade_index ASC
  `).all(params);

  const districtRows = db.prepare(`
    SELECT district, COUNT(*) AS count, AVG(grade_index) AS avg_grade_index
    FROM reports
    ${where}
    GROUP BY district
    ORDER BY count DESC
    LIMIT 20
  `).all(params);

  const n = summary.n || 0;
  res.json(ok({
    scope: { city: city || null, district: district || null, real_only: realOnly },
    n,
    real_n: summary.real_n || 0,
    pass_rate: n ? Number(((summary.pass_n || 0) / n).toFixed(4)) : 0,
    polluted_count: summary.polluted_n || 0,
    avg_grade_index: summary.avg_grade_index === null ? null : Number(summary.avg_grade_index.toFixed(2)),
    averages: {
      ph: summary.avg_ph === null ? null : Number(summary.avg_ph.toFixed(2)),
      tds: summary.avg_tds === null ? null : Number(summary.avg_tds.toFixed(2)),
      turbidity: summary.avg_turbidity === null ? null : Number(summary.avg_turbidity.toFixed(2)),
      ec: summary.avg_ec === null ? null : Number(summary.avg_ec.toFixed(2)),
      temperature: summary.avg_temperature === null ? null : Number(summary.avg_temperature.toFixed(2))
    },
    grade_distribution: gradeRows.map((row) => ({ ...row, color: gradeColor(row.grade_index) })),
    districts: districtRows.map((row) => ({
      district: row.district || 'unknown',
      count: row.count,
      avg_grade_index: row.avg_grade_index === null ? null : Number(row.avg_grade_index.toFixed(2))
    }))
  }));
}));
