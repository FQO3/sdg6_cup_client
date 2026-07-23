import { Router } from 'express';
import { db } from '../db.js';
import { ok, ApiError, asyncHandler, requireFields, assertEnum } from '../utils/response.js';
import { nowIso, makeId, safeJsonParse, toInt, toBool } from '../utils/common.js';
import { WATER_TYPES, GB_GRADES, gradeColor } from '../utils/constants.js';
import { config } from '../config.js';

export const reportsRouter = Router();

function rowToReport(row) {
  if (!row) return null;
  return {
    report_id: row.report_id,
    device_id: row.device_id,
    location: {
      lat: row.lat,
      lng: row.lng,
      city: row.city,
      district: row.district,
      address: row.address
    },
    water_type: row.water_type,
    metrics: {
      tds: row.tds,
      ph: row.ph,
      temperature: row.temperature,
      turbidity: row.turbidity,
      ec: row.ec
    },
    grade: row.grade,
    grade_index: row.grade_index,
    grade_color: gradeColor(row.grade_index),
    authenticity_confirmed: Boolean(row.authenticity_confirmed),
    user_note: row.user_note,
    raw_samples: safeJsonParse(row.raw_samples_json, []),
    capture: safeJsonParse(row.capture_json, null),
    is_seed: Boolean(row.is_seed),
    measured_at: row.measured_at,
    created_at: row.created_at
  };
}

export function getReportById(reportId) {
  const row = db.prepare('SELECT * FROM reports WHERE report_id = ?').get(reportId);
  return rowToReport(row);
}

reportsRouter.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  requireFields(body, ['device_id', 'location', 'water_type', 'metrics', 'grade', 'grade_index', 'authenticity_confirmed', 'raw_samples']);
  requireFields(body.location, ['lat', 'lng'], 'body.location');
  requireFields(body.metrics, ['temperature', 'ph', 'ec', 'turbidity'], 'body.metrics');

  assertEnum(body.water_type, WATER_TYPES, 'water_type');
  assertEnum(body.grade, GB_GRADES, 'grade');

  const gradeIndex = Number.parseInt(body.grade_index, 10);
  if (!Number.isInteger(gradeIndex) || gradeIndex < 0 || gradeIndex > 5) {
    throw new ApiError(1001, 'grade_index must be an integer between 0 and 5', 400);
  }

  if (body.authenticity_confirmed !== true) {
    throw new ApiError(1004, 'authenticity_confirmed must be true before uploading real water data', 400);
  }

  if (!Array.isArray(body.raw_samples)) {
    throw new ApiError(1001, 'raw_samples must be an array', 400);
  }

  if (!config.allowShortSamples && body.raw_samples.length !== 20) {
    throw new ApiError(1004, 'raw_samples must contain exactly 20 stable samples', 400, {
      received: body.raw_samples.length,
      hint: 'set ALLOW_SHORT_SAMPLES=true only for local demo debugging'
    });
  }

  const lat = Number(body.location.lat);
  const lng = Number(body.location.lng);
  const temperature = Number(body.metrics.temperature);
  const ph = Number(body.metrics.ph);
  const ec = Number(body.metrics.ec);
  const turbidity = Number(body.metrics.turbidity);
  const tds = body.metrics.tds === undefined || body.metrics.tds === null ? null : Number(body.metrics.tds);

  for (const [key, value] of Object.entries({ lat, lng, temperature, ph, ec, turbidity })) {
    if (!Number.isFinite(value)) throw new ApiError(1001, `${key} must be a valid number`, 400);
  }
  if (tds !== null && !Number.isFinite(tds)) throw new ApiError(1001, 'tds must be a valid number', 400);

  const timestamp = nowIso();
  const reportId = body.report_id || makeId('rpt');
  const measuredAt = body.measured_at || timestamp;

  db.prepare(`
    INSERT INTO reports (
      report_id, device_id, lat, lng, city, district, address, water_type,
      tds, ph, temperature, turbidity, ec, grade, grade_index,
      authenticity_confirmed, user_note, raw_samples_json, capture_json,
      is_seed, measured_at, created_at
    ) VALUES (
      @report_id, @device_id, @lat, @lng, @city, @district, @address, @water_type,
      @tds, @ph, @temperature, @turbidity, @ec, @grade, @grade_index,
      @authenticity_confirmed, @user_note, @raw_samples_json, @capture_json,
      @is_seed, @measured_at, @created_at
    )
  `).run({
    report_id: reportId,
    device_id: body.device_id,
    lat,
    lng,
    city: body.location.city || config.defaultCity,
    district: body.location.district || null,
    address: body.location.address || null,
    water_type: body.water_type,
    tds,
    ph,
    temperature,
    turbidity,
    ec,
    grade: body.grade,
    grade_index: gradeIndex,
    authenticity_confirmed: 1,
    user_note: body.user_note || null,
    raw_samples_json: JSON.stringify(body.raw_samples),
    capture_json: body.capture ? JSON.stringify(body.capture) : null,
    is_seed: body.is_seed ? 1 : 0,
    measured_at: measuredAt,
    created_at: timestamp
  });

  res.status(201).json(ok(getReportById(reportId), 'created'));
}));

reportsRouter.get('/', asyncHandler(async (req, res) => {
  const city = req.query.city || undefined;
  const district = req.query.district || undefined;
  const waterType = req.query.water_type || undefined;
  const realOnly = toBool(req.query.real_only, false);
  const limit = toInt(req.query.limit, 20, { min: 1, max: 200 });
  const offset = toInt(req.query.offset, 0, { min: 0 });

  const conditions = [];
  const params = { limit, offset };
  if (city) { conditions.push('city = @city'); params.city = city; }
  if (district) { conditions.push('district = @district'); params.district = district; }
  if (waterType) { conditions.push('water_type = @waterType'); params.waterType = waterType; }
  if (realOnly) { conditions.push('authenticity_confirmed = 1 AND is_seed = 0'); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM reports ${where}`).get(params).n;
  const rows = db.prepare(`
    SELECT * FROM reports
    ${where}
    ORDER BY datetime(measured_at) DESC, id DESC
    LIMIT @limit OFFSET @offset
  `).all(params);

  res.json(ok({
    items: rows.map(rowToReport),
    total,
    limit,
    offset,
    filters: {
      city: city || null,
      district: district || null,
      water_type: waterType || null,
      real_only: realOnly
    }
  }));
}));

reportsRouter.get('/:report_id', asyncHandler(async (req, res) => {
  const report = getReportById(req.params.report_id);
  if (!report) throw new ApiError(1003, 'report not found', 404);
  res.json(ok(report));
}));
