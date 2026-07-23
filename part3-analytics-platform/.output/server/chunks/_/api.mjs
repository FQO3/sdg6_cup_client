import { d as defineEventHandler, c as createError, s as setResponseStatus, g as getQuery } from '../nitro/nitro.mjs';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();
function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === void 0 || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}
function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === void 0 || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}
const config = {
  port: intEnv("PORT", 4e3),
  nodeEnv: "production",
  dbPath: process.env.DB_PATH || "./data/analytics.sqlite",
  defaultCity: process.env.DEFAULT_CITY || "beijing",
  allowShortSamples: boolEnv("ALLOW_SHORT_SAMPLES", false),
  amap: {
    key: process.env.AMAP_KEY || "",
    reverseUrl: process.env.AMAP_REVERSE_URL || "https://restapi.amap.com/v3/geocode/regeo",
    timeoutMs: intEnv("AMAP_TIMEOUT_MS", 8e3)
  },
  llm: {
    baseUrl: process.env.LLM_SERVICE_URL || "http://localhost:8090",
    timeoutMs: intEnv("LLM_TIMEOUT_MS", 6e4),
    cacheTtlHours: intEnv("LLM_CACHE_TTL_HOURS", 6)
  },
  lstm: {
    baseUrl: process.env.LSTM_SERVICE_URL || "http://localhost:8091",
    timeoutMs: intEnv("LSTM_TIMEOUT_MS", 3e4)
  }
};

const dbFile = path.resolve(process.cwd(), config.dbPath);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new Database(dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id TEXT NOT NULL UNIQUE,
      device_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      city TEXT,
      district TEXT,
      address TEXT,
      water_type TEXT NOT NULL,
      tds REAL,
      ph REAL NOT NULL,
      temperature REAL NOT NULL,
      turbidity REAL NOT NULL,
      ec REAL NOT NULL,
      grade TEXT NOT NULL,
      grade_index INTEGER NOT NULL,
      authenticity_confirmed INTEGER NOT NULL DEFAULT 0,
      user_note TEXT,
      raw_samples_json TEXT NOT NULL,
      capture_json TEXT,
      is_seed INTEGER NOT NULL DEFAULT 0,
      measured_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reports_report_id ON reports(report_id);
    CREATE INDEX IF NOT EXISTS idx_reports_geo ON reports(city, district);
    CREATE INDEX IF NOT EXISTS idx_reports_measured_at ON reports(measured_at);
    CREATE INDEX IF NOT EXISTS idx_reports_grade ON reports(grade_index);
    CREATE INDEX IF NOT EXISTS idx_reports_real ON reports(authenticity_confirmed, is_seed);

    CREATE TABLE IF NOT EXISTS analysis_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      region TEXT,
      ref_report_id TEXT,
      model TEXT,
      input_snapshot TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_analysis_results_scope ON analysis_results(scope, region, ref_report_id, created_at);

    CREATE TABLE IF NOT EXISTS analysis_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL UNIQUE,
      job_type TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      request_json TEXT NOT NULL,
      result_json TEXT,
      error_message TEXT,
      external_task_id TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_analysis_jobs_job_id ON analysis_jobs(job_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_jobs_scope ON analysis_jobs(job_type, scope_type, scope_id, status);
  `);
}
function getDbPath() {
  return dbFile;
}

function ok(data = null, message = "ok") {
  return { code: 0, message, data };
}
class ApiError extends Error {
  constructor(code, message, status = 400, data = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.data = data;
  }
}
function requireFields(object, fields, parent = "body") {
  for (const field of fields) {
    if ((object == null ? void 0 : object[field]) === void 0 || (object == null ? void 0 : object[field]) === null || (object == null ? void 0 : object[field]) === "") {
      throw new ApiError(1001, `missing required field: ${parent}.${field}`, 400);
    }
  }
}
function assertEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new ApiError(1001, `invalid ${field}, expected one of: ${allowed.join(", ")}`, 400);
  }
}

let dbReady = false;
function ensureDb() {
  if (!dbReady) {
    initDb();
    dbReady = true;
  }
}
function sendOk(event, data = null, message = "ok", status = 200) {
  setResponseStatus(event, status);
  return ok(data, message);
}
function throwApiError(error) {
  if (error instanceof ApiError) {
    throw createError({
      statusCode: error.status || 400,
      statusMessage: error.message,
      data: { code: error.code, message: error.message, data: error.data || null }
    });
  }
  throw createError({
    statusCode: 500,
    statusMessage: (error == null ? void 0 : error.message) || "internal error",
    data: { code: 2001, message: (error == null ? void 0 : error.message) || "internal error", data: null }
  });
}
function defineApiHandler(handler) {
  return defineEventHandler(async (event) => {
    ensureDb();
    try {
      return await handler(event);
    } catch (error) {
      throwApiError(error);
    }
  });
}
function getApiQuery(event) {
  return getQuery(event) || {};
}

export { ApiError as A, db as a, getDbPath as b, config as c, defineApiHandler as d, assertEnum as e, getApiQuery as g, requireFields as r, sendOk as s };
//# sourceMappingURL=api.mjs.map
