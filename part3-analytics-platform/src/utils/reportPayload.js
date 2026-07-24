import { ApiError, requireFields, assertEnum } from './response.js';
import { WATER_TYPES, GB_GRADES } from './constants.js';
import { config } from '../config.js';

const BEIJING_DISTRICTS = [
  '东城区', '西城区', '朝阳区', '海淀区', '丰台区', '石景山区',
  '门头沟区', '房山区', '通州区', '顺义区', '昌平区', '大兴区',
  '怀柔区', '平谷区', '密云区', '延庆区'
];

function finiteNumber(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(1001, `${fieldName} must be a valid number`, 400);
  }
  return parsed;
}

function optionalFiniteNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  return finiteNumber(value, fieldName);
}

function round2(value) {
  return Number(Number(value).toFixed(2));
}

function estimateTdsFromEc(ec) {
  // Demo-friendly approximation: many low-cost TDS meters estimate ppm from EC using a 0.5 factor.
  return round2(Number(ec) * 0.5);
}

function extractDistrict(location = {}) {
  if (location.district) return String(location.district);
  const text = [location.region, location.address, location.formatted_address]
    .filter(Boolean)
    .map(String)
    .join(' ');
  return BEIJING_DISTRICTS.find((district) => text.includes(district)) || null;
}

function normalizeSample(sample, index) {
  if (!sample || typeof sample !== 'object') {
    throw new ApiError(1001, `raw_samples[${index}] must be an object`, 400);
  }

  const ec = finiteNumber(sample.ec, `raw_samples[${index}].ec`);
  const tds = optionalFiniteNumber(sample.tds, `raw_samples[${index}].tds`) ?? estimateTdsFromEc(ec);

  return {
    seq: Number.isInteger(Number(sample.seq)) ? Number(sample.seq) : index + 1,
    temperature: finiteNumber(sample.temperature, `raw_samples[${index}].temperature`),
    ph: finiteNumber(sample.ph, `raw_samples[${index}].ph`),
    tds,
    turbidity: finiteNumber(sample.turbidity, `raw_samples[${index}].turbidity`),
    ec
  };
}

function captureSummary(body, stableSamples) {
  const capture = body.capture || {};
  const stability = capture.stability || {};
  const discarded = Number.isFinite(Number(stability.discarded))
    ? Number(stability.discarded)
    : (Number.isFinite(Number(capture.discarded_samples)) ? Number(capture.discarded_samples) : 0);

  return {
    stable_samples: stableSamples,
    discarded_samples: discarded,
    stability_note: capture.stability_note || `client uploaded ${stableSamples} stable samples${discarded ? ` after discarding ${discarded} outlier(s)` : ''}`
  };
}

export function normalizeReportPayload(body = {}) {
  const rawSamplesInput = body.raw_samples ?? body.capture?.raw_samples;
  const metricsInput = body.metrics ?? body.capture?.metrics;
  const deviceId = body.device_id ?? body.deviceId ?? body.device?.device_id ?? body.device?.id;
  const gradeInput = body.grade ?? body.capture?.grade;
  const gradeIndexInput = body.grade_index ?? body.capture?.grade_index;

  requireFields({
    ...body,
    device_id: deviceId,
    metrics: metricsInput,
    raw_samples: rawSamplesInput,
    grade: gradeInput,
    grade_index: gradeIndexInput
  }, [
    'device_id', 'location', 'water_type', 'metrics', 'grade', 'grade_index', 'authenticity_confirmed', 'raw_samples'
  ]);
  requireFields(body.location, ['lat', 'lng'], 'body.location');
  requireFields(metricsInput, ['temperature', 'ph', 'ec', 'turbidity'], 'body.metrics');

  assertEnum(body.water_type, WATER_TYPES, 'water_type');
  assertEnum(gradeInput, GB_GRADES, 'grade');

  const gradeIndex = Number.parseInt(gradeIndexInput, 10);
  if (!Number.isInteger(gradeIndex) || gradeIndex < 0 || gradeIndex > 5) {
    throw new ApiError(1001, 'grade_index must be an integer between 0 and 5', 400);
  }
  if (body.authenticity_confirmed !== true) {
    throw new ApiError(1004, 'authenticity_confirmed must be true before uploading real water data', 400);
  }
  if (!Array.isArray(rawSamplesInput)) throw new ApiError(1001, 'raw_samples must be an array', 400);
  if (!config.allowShortSamples && rawSamplesInput.length !== 20) {
    throw new ApiError(1004, 'raw_samples must contain exactly 20 stable samples', 400, {
      received: rawSamplesInput.length,
      hint: 'set ALLOW_SHORT_SAMPLES=true only for local demo debugging'
    });
  }

  const lat = finiteNumber(body.location.lat, 'lat');
  const lng = finiteNumber(body.location.lng, 'lng');
  const ec = finiteNumber(metricsInput.ec, 'ec');
  const tds = optionalFiniteNumber(metricsInput.tds, 'tds') ?? estimateTdsFromEc(ec);
  const rawSamples = rawSamplesInput.map(normalizeSample);

  return {
    device_id: String(deviceId),
    lat,
    lng,
    city: body.location.city || config.defaultCity,
    district: extractDistrict(body.location),
    address: body.location.address || body.location.region || body.location.formatted_address || null,
    water_type: body.water_type,
    tds,
    ph: finiteNumber(metricsInput.ph, 'ph'),
    temperature: finiteNumber(metricsInput.temperature, 'temperature'),
    turbidity: finiteNumber(metricsInput.turbidity, 'turbidity'),
    ec,
    grade: gradeInput,
    grade_index: gradeIndex,
    authenticity_confirmed: 1,
    user_note: body.user_note || null,
    raw_samples_json: JSON.stringify(rawSamples),
    capture_json: JSON.stringify(captureSummary(body, rawSamples.length)),
    is_seed: body.is_seed ? 1 : 0,
    measured_at: body.measured_at || null
  };
}
