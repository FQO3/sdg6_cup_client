import { db } from '~~/src/db.js';
import { safeJsonParse } from '~~/src/utils/common.js';
import { gradeColor } from '~~/src/utils/constants.js';

export function rowToReport(row) {
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

export function markerFromRow(row) {
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
