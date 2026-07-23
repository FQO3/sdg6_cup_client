import { c as config, A as ApiError, a as db } from './api.mjs';
import { n as nowIso, s as safeJsonParse } from './common.mjs';
import { g as getReportById } from './mappers.mjs';

async function requestJson(method, path, body, timeoutMs, serviceName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.lstm.baseUrl}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : void 0,
      body: body ? JSON.stringify(body) : void 0,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || (payload == null ? void 0 : payload.code)) {
      throw new ApiError(3001, `${serviceName} service error`, 502, payload);
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new ApiError(3002, `${serviceName} service timeout`, 504);
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(3001, `${serviceName} service unavailable: ${error.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}
async function generateLstmAnalysis({ region, limit = 300, noCache = false }) {
  return requestJson(
    "POST",
    "/api/v1/lstm/analysis/generate",
    { region, limit, no_cache: Boolean(noCache) },
    config.lstm.timeoutMs,
    "LSTM"
  );
}

function analysisRow(row) {
  return row ? {
    id: row.id,
    scope: row.scope,
    region: row.region,
    ref_report_id: row.ref_report_id,
    model: row.model,
    input_snapshot: safeJsonParse(row.input_snapshot, null),
    content: row.content,
    created_at: row.created_at
  } : null;
}
function cacheFresh(row) {
  if (!row) return false;
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  return ageMs >= 0 && ageMs <= config.llm.cacheTtlHours * 3600 * 1e3;
}
function buildRegionSnapshot(region, realOnly = false) {
  const conditions = ["(district = @region OR city = @region)"];
  const params = { region };
  if (realOnly) conditions.push("authenticity_confirmed = 1 AND is_seed = 0");
  const where = `WHERE ${conditions.join(" AND ")}`;
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
  if (!summary.n) throw new ApiError(1003, "no reports found for region", 404);
  const worstType = db.prepare(`
    SELECT water_type, COUNT(*) AS n, AVG(grade_index) AS avg_grade
    FROM reports
    ${where}
    GROUP BY water_type
    ORDER BY avg_grade DESC, n DESC
    LIMIT 1
  `).get(params);
  const exceedList = [];
  if (summary.ph !== null && (summary.ph < 6.5 || summary.ph > 8.5)) exceedList.push({ metric: "ph", avg: Number(summary.ph.toFixed(2)), note: "\u5E73\u5747 pH \u504F\u79BB\u5E38\u89C1\u996E\u7528\u6C34\u8212\u9002\u533A\u95F4 6.5-8.5" });
  if (summary.tds !== null && summary.tds > 1e3) exceedList.push({ metric: "tds", avg: Number(summary.tds.toFixed(2)), note: "\u5E73\u5747 TDS \u504F\u9AD8" });
  if (summary.turbidity !== null && summary.turbidity > 1) exceedList.push({ metric: "turbidity", avg: Number(summary.turbidity.toFixed(2)), note: "\u5E73\u5747\u6D4A\u5EA6\u504F\u9AD8" });
  if (summary.ec !== null && summary.ec > 2e3) exceedList.push({ metric: "ec", avg: Number(summary.ec.toFixed(2)), note: "\u5E73\u5747\u7535\u5BFC\u7387\u504F\u9AD8" });
  return {
    region,
    n: summary.n,
    real_n: summary.real_n || 0,
    seed_n: summary.seed_n || 0,
    pass_rate: `${((summary.pass_n || 0) / summary.n * 100).toFixed(1)}%`,
    avg_grade: summary.avg_grade === null ? null : Number(summary.avg_grade.toFixed(2)),
    ph: summary.ph === null ? null : Number(summary.ph.toFixed(2)),
    tds: summary.tds === null ? null : Number(summary.tds.toFixed(2)),
    turbidity: summary.turbidity === null ? null : Number(summary.turbidity.toFixed(2)),
    ec: summary.ec === null ? null : Number(summary.ec.toFixed(2)),
    exceed_list: exceedList,
    worst_water_type: (worstType == null ? void 0 : worstType.water_type) || null,
    polluted_count: summary.polluted_count || 0
  };
}
function buildPointSnapshot(reportId) {
  var _a;
  const report = getReportById(reportId);
  if (!report) throw new ApiError(1003, "report not found", 404);
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
    stability_note: ((_a = report.capture) == null ? void 0 : _a.stability_note) || `uploaded with ${report.raw_samples.length} stable samples`
  };
}
function jobRow(row) {
  return row ? {
    job_id: row.job_id,
    job_type: row.job_type,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    status: row.status,
    progress: row.progress,
    request: safeJsonParse(row.request_json, null),
    result: safeJsonParse(row.result_json, null),
    error_message: row.error_message,
    external_task_id: row.external_task_id,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at
  } : null;
}
async function runLstmJob(jobId) {
  var _a;
  db.prepare(`
    UPDATE analysis_jobs
    SET status = 'running', progress = 10, started_at = ?
    WHERE job_id = ? AND status = 'pending'
  `).run(nowIso(), jobId);
  const row = db.prepare("SELECT * FROM analysis_jobs WHERE job_id = ?").get(jobId);
  if (!row) return;
  const request = safeJsonParse(row.request_json, {});
  try {
    const result = await generateLstmAnalysis({
      region: request.region,
      limit: request.limit,
      noCache: request.no_cache
    });
    db.prepare(`
      UPDATE analysis_jobs
      SET status = 'succeeded', progress = 100, result_json = ?, finished_at = ?
      WHERE job_id = ?
    `).run(JSON.stringify((_a = result.data) != null ? _a : result), nowIso(), jobId);
  } catch (error) {
    db.prepare(`
      UPDATE analysis_jobs
      SET status = 'failed', progress = 100, error_message = ?, result_json = ?, finished_at = ?
      WHERE job_id = ?
    `).run(error.message, JSON.stringify(error.data || null), nowIso(), jobId);
  }
}

export { analysisRow as a, buildRegionSnapshot as b, cacheFresh as c, buildPointSnapshot as d, jobRow as j, runLstmJob as r };
//# sourceMappingURL=snapshots.mjs.map
