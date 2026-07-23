import { r as readBody } from '../../../../nitro/nitro.mjs';
import { A as ApiError, c as config, d as defineApiHandler, a as db, s as sendOk } from '../../../../_/api.mjs';
import { a as toBool, n as nowIso } from '../../../../_/common.mjs';
import { c as cacheFresh, a as analysisRow, b as buildRegionSnapshot, d as buildPointSnapshot } from '../../../../_/snapshots.mjs';
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
import '../../../../_/mappers.mjs';
import '../../../../_/constants.mjs';

async function postJson(url, body, timeoutMs, serviceName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
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
async function generateInsight({ scope, region, regionSnapshot, refReportId, pointSnapshot, noCache = false }) {
  const body = scope === "region" ? {
    scope: "region",
    region,
    region_snapshot: regionSnapshot,
    no_cache: Boolean(noCache)
  } : {
    scope: "point",
    ref_report_id: refReportId,
    point_snapshot: pointSnapshot,
    no_cache: Boolean(noCache)
  };
  return postJson(
    `${config.llm.baseUrl}/api/v1/insights/generate`,
    body,
    config.llm.timeoutMs,
    "LLM"
  );
}

const generate_post = defineApiHandler(async (event) => {
  const body = await readBody(event) || {};
  const scope = body.scope || "region";
  const noCache = toBool(body.no_cache, false);
  if (!["region", "point"].includes(scope)) throw new ApiError(1001, "scope must be region or point", 400);
  const region = scope === "region" ? body.region || config.defaultCity : null;
  const refReportId = scope === "point" ? body.ref_report_id : null;
  if (scope === "point" && !refReportId) throw new ApiError(1001, "ref_report_id is required for point insight", 400);
  if (!noCache) {
    const cached = scope === "region" ? db.prepare("SELECT * FROM analysis_results WHERE scope = ? AND region = ? ORDER BY datetime(created_at) DESC LIMIT 1").get(scope, region) : db.prepare("SELECT * FROM analysis_results WHERE scope = ? AND ref_report_id = ? ORDER BY datetime(created_at) DESC LIMIT 1").get(scope, refReportId);
    if (cacheFresh(cached)) return sendOk(event, { ...analysisRow(cached), cached: true });
  }
  const snapshot = scope === "region" ? buildRegionSnapshot(region, toBool(body.real_only, false)) : buildPointSnapshot(refReportId);
  const llmResult = await generateInsight({
    scope,
    region,
    regionSnapshot: scope === "region" ? snapshot : void 0,
    refReportId,
    pointSnapshot: scope === "point" ? snapshot : void 0,
    noCache
  });
  const createdAt = nowIso();
  const info = db.prepare(`
    INSERT INTO analysis_results (scope, region, ref_report_id, model, input_snapshot, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(scope, region, refReportId, llmResult.model || null, JSON.stringify(snapshot), llmResult.content || "", createdAt);
  const row = db.prepare("SELECT * FROM analysis_results WHERE id = ?").get(info.lastInsertRowid);
  return sendOk(event, { ...analysisRow(row), cached: Boolean(llmResult.cached) }, "generated", 201);
});

export { generate_post as default };
//# sourceMappingURL=generate.post.mjs.map
