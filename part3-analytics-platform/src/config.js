import dotenv from 'dotenv';

// Load .env from current working directory. In development, run commands from part3-analytics-platform/.
dotenv.config();

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

export const config = {
  port: intEnv('PORT', 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  dbPath: process.env.DB_PATH || './data/analytics.sqlite',
  defaultCity: process.env.DEFAULT_CITY || 'beijing',
  allowShortSamples: boolEnv('ALLOW_SHORT_SAMPLES', false),
  amap: {
    key: process.env.AMAP_KEY || '',
    reverseUrl: process.env.AMAP_REVERSE_URL || 'https://restapi.amap.com/v3/geocode/regeo',
    timeoutMs: intEnv('AMAP_TIMEOUT_MS', 8000)
  },
  llm: {
    baseUrl: process.env.LLM_SERVICE_URL || 'http://localhost:8090',
    timeoutMs: intEnv('LLM_TIMEOUT_MS', 60000),
    cacheTtlHours: intEnv('LLM_CACHE_TTL_HOURS', 6)
  },
  lstm: {
    baseUrl: process.env.LSTM_SERVICE_URL || 'http://localhost:8091',
    timeoutMs: intEnv('LSTM_TIMEOUT_MS', 30000)
  }
};
