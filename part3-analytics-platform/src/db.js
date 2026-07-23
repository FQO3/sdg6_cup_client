import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const dbFile = path.resolve(process.cwd(), config.dbPath);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb() {
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

export function getDbPath() {
  return dbFile;
}

export function closeDb() {
  db.close();
}
