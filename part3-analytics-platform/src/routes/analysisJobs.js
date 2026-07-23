import { Router } from 'express';
import { db } from '../db.js';
import { ok, ApiError, asyncHandler } from '../utils/response.js';
import { makeId, nowIso, safeJsonParse, toBool, toInt } from '../utils/common.js';
import { config } from '../config.js';
import { generateLstmAnalysis } from '../services/lstmClient.js';

export const analysisJobsRouter = Router();

function jobRow(row) {
  if (!row) return null;
  return {
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
  };
}

async function runLstmJob(jobId) {
  const startedAt = nowIso();
  db.prepare(`
    UPDATE analysis_jobs
    SET status = 'running', progress = 10, started_at = ?
    WHERE job_id = ? AND status = 'pending'
  `).run(startedAt, jobId);

  const row = db.prepare('SELECT * FROM analysis_jobs WHERE job_id = ?').get(jobId);
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
    `).run(JSON.stringify(result.data ?? result), nowIso(), jobId);
  } catch (error) {
    db.prepare(`
      UPDATE analysis_jobs
      SET status = 'failed', progress = 100, error_message = ?, result_json = ?, finished_at = ?
      WHERE job_id = ?
    `).run(error.message, JSON.stringify(error.data || null), nowIso(), jobId);
  }
}

analysisJobsRouter.post('/lstm/jobs', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const region = body.region || config.defaultCity;
  const limit = toInt(body.limit, 300, { min: 20, max: 5000 });
  const noCache = toBool(body.no_cache, false);
  const jobId = makeId('job_lstm');
  const createdAt = nowIso();
  const request = { region, limit, no_cache: noCache };

  db.prepare(`
    INSERT INTO analysis_jobs (
      job_id, job_type, scope_type, scope_id, status, progress, request_json, created_at
    ) VALUES (?, 'lstm_analysis', 'region', ?, 'pending', 0, ?, ?)
  `).run(jobId, region, JSON.stringify(request), createdAt);

  setImmediate(() => runLstmJob(jobId));

  const row = db.prepare('SELECT * FROM analysis_jobs WHERE job_id = ?').get(jobId);
  res.status(202).json(ok(jobRow(row), 'accepted'));
}));

analysisJobsRouter.get('/lstm/jobs/:job_id', asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM analysis_jobs WHERE job_id = ?').get(req.params.job_id);
  if (!row) throw new ApiError(1003, 'analysis job not found', 404);
  res.json(ok(jobRow(row)));
}));

analysisJobsRouter.get('/lstm/jobs', asyncHandler(async (req, res) => {
  const limit = toInt(req.query.limit, 50, { min: 1, max: 200 });
  const status = req.query.status || undefined;
  const conditions = ["job_type = 'lstm_analysis'"];
  const params = { limit };
  if (status) { conditions.push('status = @status'); params.status = status; }
  const rows = db.prepare(`
    SELECT * FROM analysis_jobs
    WHERE ${conditions.join(' AND ')}
    ORDER BY datetime(created_at) DESC
    LIMIT @limit
  `).all(params);
  res.json(ok({ jobs: rows.map(jobRow), limit }));
}));
