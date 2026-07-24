import { db } from '~~/src/db.js';
import { config } from '~~/src/config.js';
import { ApiError } from '~~/src/utils/response.js';
import { toBool, nowIso } from '~~/src/utils/common.js';
import { generateInsight } from '~~/src/services/llmClient.js';
import { defineApiHandler, sendOk } from '../../../utils/api.js';
import { analysisRow, cacheFresh, buildRegionSnapshot, buildPointSnapshot, buildClusterSnapshot } from '../../../utils/snapshots.js';

export default defineApiHandler(async (event) => {
  const body = await readBody(event) || {};
  const scope = body.scope || 'region';
  const noCache = toBool(body.no_cache, false);
  if (!['region', 'point', 'cluster'].includes(scope)) throw new ApiError(1001, 'scope must be region, point or cluster', 400);

  const region = scope === 'region' ? (body.region || config.defaultCity) : null;
  const refReportId = scope === 'point' ? body.ref_report_id : null;
  const clusterUuid = scope === 'cluster' ? body.cluster_uuid : null;
  if (scope === 'point' && !refReportId) throw new ApiError(1001, 'ref_report_id is required for point insight', 400);
  if (scope === 'cluster' && !clusterUuid) throw new ApiError(1001, 'cluster_uuid is required for cluster insight', 400);

  if (!noCache) {
    const cached = scope === 'region'
      ? db.prepare('SELECT * FROM analysis_results WHERE scope = ? AND region = ? ORDER BY datetime(created_at) DESC LIMIT 1').get(scope, region)
      : db.prepare('SELECT * FROM analysis_results WHERE scope = ? AND ref_report_id = ? ORDER BY datetime(created_at) DESC LIMIT 1').get(scope, refReportId || clusterUuid);
    if (cacheFresh(cached)) return sendOk(event, { ...analysisRow(cached), cached: true });
  }

  const snapshot = scope === 'region'
    ? buildRegionSnapshot(region, toBool(body.real_only, false))
    : scope === 'point'
      ? buildPointSnapshot(refReportId)
      : buildClusterSnapshot(clusterUuid);

  const llmResult = await generateInsight({
    scope,
    region,
    regionSnapshot: scope === 'region' ? snapshot : undefined,
    refReportId,
    pointSnapshot: scope === 'point' ? snapshot : undefined,
    clusterUuid,
    clusterSnapshot: scope === 'cluster' ? snapshot : undefined,
    noCache
  });

  const createdAt = nowIso();
  const info = db.prepare(`
    INSERT INTO analysis_results (scope, region, ref_report_id, model, input_snapshot, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(scope, region, refReportId || clusterUuid, llmResult.model || null, JSON.stringify(snapshot), llmResult.content || '', createdAt);

  const row = db.prepare('SELECT * FROM analysis_results WHERE id = ?').get(info.lastInsertRowid);
  return sendOk(event, { ...analysisRow(row), cached: Boolean(llmResult.cached) }, 'generated', 201);
});
