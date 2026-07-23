import { db } from '~~/src/db.js';
import { config } from '~~/src/config.js';
import { ApiError, requireFields, assertEnum } from '~~/src/utils/response.js';
import { nowIso, makeId } from '~~/src/utils/common.js';
import { WATER_TYPES, GB_GRADES } from '~~/src/utils/constants.js';
import { defineApiHandler, sendOk } from '../../utils/api.js';
import { getReportById } from '../../utils/mappers.js';

export default defineApiHandler(async (event) => {
  const body = await readBody(event) || {};
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
  if (!Array.isArray(body.raw_samples)) throw new ApiError(1001, 'raw_samples must be an array', 400);
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

  return sendOk(event, getReportById(reportId), 'created', 201);
});
