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

    CREATE TABLE IF NOT EXISTS water_quality_cluster_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_uuid TEXT NOT NULL UNIQUE,
      algorithm TEXT NOT NULL,
      scope_city TEXT,
      scope_district TEXT,
      real_only INTEGER NOT NULL DEFAULT 0,
      input_count INTEGER NOT NULL,
      geo_k INTEGER NOT NULL,
      water_k INTEGER NOT NULL,
      request_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cluster_runs_scope ON water_quality_cluster_runs(scope_city, scope_district, created_at);

    CREATE TABLE IF NOT EXISTS water_quality_clusters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_uuid TEXT NOT NULL UNIQUE,
      run_uuid TEXT NOT NULL,
      cluster_type TEXT NOT NULL,
      cluster_index INTEGER NOT NULL,
      label TEXT NOT NULL,
      center_lat REAL,
      center_lng REAL,
      radius_m REAL,
      min_lat REAL,
      max_lat REAL,
      min_lng REAL,
      max_lng REAL,
      center_tds REAL,
      center_ph REAL,
      center_turbidity REAL,
      center_ec REAL,
      count INTEGER NOT NULL,
      location_json TEXT,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_uuid) REFERENCES water_quality_cluster_runs(run_uuid) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_clusters_run ON water_quality_clusters(run_uuid, cluster_type, cluster_index);

    CREATE TABLE IF NOT EXISTS water_quality_cluster_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_uuid TEXT NOT NULL UNIQUE,
      run_uuid TEXT NOT NULL,
      cluster_uuid TEXT NOT NULL,
      report_id TEXT NOT NULL,
      cluster_type TEXT NOT NULL,
      distance REAL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_uuid) REFERENCES water_quality_cluster_runs(run_uuid) ON DELETE CASCADE,
      FOREIGN KEY (cluster_uuid) REFERENCES water_quality_clusters(cluster_uuid) ON DELETE CASCADE,
      FOREIGN KEY (report_id) REFERENCES reports(report_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cluster_members_run ON water_quality_cluster_members(run_uuid, cluster_type, cluster_uuid);
    CREATE INDEX IF NOT EXISTS idx_cluster_members_report ON water_quality_cluster_members(report_id);
  `);
}

export function getDbPath() {
  return dbFile;
}

export function closeDb() {
  db.close();
}
