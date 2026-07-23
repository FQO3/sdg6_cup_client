import { Router } from 'express';
import { db } from '../db.js';
import { ok, ApiError, asyncHandler } from '../utils/response.js';
import { toInt, toBool, nowIso, safeJsonParse } from '../utils/common.js';
import { config } from '../config.js';
import { generateInsight } from '../services/llmClient.js';
import { getReportById } from './reports.js';

export const insightsRouter = Router();

function cacheFresh(row) {
  if (!row) return false;
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  return ageMs >= 0 && ageMs <= config.llm.cacheTtlHours * 3600 * 1000;
}

function analysisRow(row) {
  return {
    id: row.id,
    scope: row.scope,
    region: row.region,
    ref_report_id: row.ref_report_id,
    model: row.model,
    input_snapshot: safeJsonParse(row.input_snapshot, null),
    content: row.content,
    created_at: row.created_at
  };
}

function buildRegionSnapshot(region, realOnly = false) {
  const conditions = ['(district = @region OR city = @region)'];
  const params = { region };
  if (realOnly) conditions.push('authenticity_confirmed = 1 AND is_seed = 0');
  const where = `WHERE ${conditions.join(' AND ')}`;

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS n,
      SUM(CASE WHEN authenticity_confirmed = 1 AND is_seed = 0 THEN 1 ELSE 0 END) AS real_n,
      SUM(CASE WHEN is_seed = 1 THEN 1 ELSE 0 END) AS seed_n,
      SUM(CASE WHEN grade_index <= 2 THEN 1 ELSE 0 END) AS pass_n,
      AVG(grade_index) AS avg_grade,
      AVG(ph) AS ph,
      AVG(tds) AS tds,
      AVG(turbidity) AS turbidity,
      AVG(ec) AS ec,
      SUM(CASE WHEN grade_index >= 4 THEN 1 ELSE 0 END) AS polluted_count
    FROM reports
    ${where}
  `).get(params);

  if (!summary.n) throw new ApiError(1003, 'no reports found for region', 404);

  const worstType = db.prepare(`
    SELECT water_type, COUNT(*) AS n, AVG(grade_index) AS avg_grade
    FROM reports
    ${where}
    GROUP BY water_type
    ORDER BY avg_grade DESC, n DESC
    LIMIT 1
  `).get(params);

  const exceedList = [];
  if (summary.ph !== null && (summary.ph < 6.5 || summary.ph > 8.5)) exceedList.push({ metric: 'ph', avg: Number(summary.ph.toFixed(2)), note: '平均 pH 偏离常见饮用水舒适区间 6.5-8.5' });
  if (summary.tds !== null && summary.tds > 1000) exceedList.push({ metric: 'tds', avg: Number(summary.tds.toFixed(2)), note: '平均 TDS 偏高' });
  if (summary.turbidity !== null && summary.turbidity > 1) exceedList.push({ metric: 'turbidity', avg: Number(summary.turbidity.toFixed(2)), note: '平均浊度偏高' });
  if (summary.ec !== null && summary.ec > 2000) exceedList.push({ metric: 'ec', avg: Number(summary.ec.toFixed(2)), note: '平均电导率偏高' });

  return {
    region,
    n: summary.n,
    real_n: summary.real_n || 0,
    seed_n: summary.seed_n || 0,
    pass_rate: `${(((summary.pass_n || 0) / summary.n) * 100).toFixed(1)}%`,
    avg_grade: summary.avg_grade === null ? null : Number(summary.avg_grade.toFixed(2)),
    ph: summary.ph === null ? null : Number(summary.ph.toFixed(2)),
    tds: summary.tds === null ? null : Number(summary.tds.toFixed(2)),
    turbidity: summary.turbidity === null ? null : Number(summary.turbidity.toFixed(2)),
    ec: summary.ec === null ? null : Number(summary.ec.toFixed(2)),
    exceed_list: exceedList,
    worst_water_type: worstType?.water_type || null,
    polluted_count: summary.polluted_count || 0
  };
}

function buildPointSnapshot(reportId) {
  const report = getReportById(reportId);
  if (!report) throw new ApiError(1003, 'report not found', 404);
  return {
    ref_report_id: report.report_id,
    region: report.location.district || report.location.city || config.defaultCity,
    water_type: report.water_type,
    ph: report.metrics.ph,
    tds: report.metrics.tds,
    turbidity: report.metrics.turbidity,
    ec: report.metrics.ec,
    temperature: report.metrics.temperature,
    grade: report.grade,
    stability_note: report.capture?.stability_note || `uploaded with ${report.raw_samples.length} stable samples`
  };
}

insightsRouter.post('/generate', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const scope = body.scope || 'region';
  const noCache = toBool(body.no_cache, false);

  if (!['region', 'point'].includes(scope)) throw new ApiError(1001, 'scope must be region or point', 400);

  const region = scope === 'region' ? (body.region || config.defaultCity) : null;
  const refReportId = scope === 'point' ? body.ref_report_id : null;
  if (scope === 'point' && !refReportId) throw new ApiError(1001, 'ref_report_id is required for point insight', 400);

  if (!noCache) {
    const cached = scope === 'region'
      ? db.prepare('SELECT * FROM analysis_results WHERE scope = ? AND region = ? ORDER BY datetime(created_at) DESC LIMIT 1').get(scope, region)
      : db.prepare('SELECT * FROM analysis_results WHERE scope = ? AND ref_report_id = ? ORDER BY datetime(created_at) DESC LIMIT 1').get(scope, refReportId);
    if (cacheFresh(cached)) return res.json(ok({ ...analysisRow(cached), cached: true }));
  }

  const snapshot = scope === 'region'
    ? buildRegionSnapshot(region, toBool(body.real_only, false))
    : buildPointSnapshot(refReportId);

  const llmResult = await generateInsight({
    scope,
    region,
    regionSnapshot: scope === 'region' ? snapshot : undefined,
    refReportId,
    pointSnapshot: scope === 'point' ? snapshot : undefined,
    noCache
  });

  const createdAt = nowIso();
  const info = db.prepare(`
    INSERT INTO analysis_results (scope, region, ref_report_id, model, input_snapshot, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(scope, region, refReportId, llmResult.model || null, JSON.stringify(snapshot), llmResult.content || '', createdAt);

  const row = db.prepare('SELECT * FROM analysis_results WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(ok({ ...analysisRow(row), cached: Boolean(llmResult.cached) }, 'generated'));
}));

insightsRouter.get('/records', asyncHandler(async (req, res) => {
  const limit = toInt(req.query.limit, 50, { min: 1, max: 500 });
  const offset = toInt(req.query.offset, 0, { min: 0 });
  const region = req.query.region || undefined;
  const conditions = [];
  const params = { limit, offset };
  if (region) { conditions.push('region = @region'); params.region = region; }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT * FROM analysis_results
    ${where}
    ORDER BY datetime(created_at) DESC
    LIMIT @limit OFFSET @offset
  `).all(params);
  res.json(ok({ records: rows.map(analysisRow), limit, offset }));
}));

insightsRouter.get('/records/:id', asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM analysis_results WHERE id = ?').get(req.params.id);
  if (!row) throw new ApiError(1003, 'analysis result not found', 404);
  res.json(ok(analysisRow(row)));
}));

export { buildRegionSnapshot, buildPointSnapshot };
