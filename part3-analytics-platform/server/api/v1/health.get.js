import { getDbPath } from '~~/src/db.js';
import { config } from '~~/src/config.js';
import { defineApiHandler, sendOk } from '../../utils/api.js';

export default defineApiHandler((event) => sendOk(event, {
  service: 'sdg6-analytics-platform',
  mode: 'nuxt3-nitro',
  status: 'healthy',
  db_path: getDbPath(),
  integrations: {
    amap: Boolean(config.amap.key),
    llm_service_url: config.llm.baseUrl,
    lstm_service_url: config.lstm.baseUrl
  },
  time: new Date().toISOString()
}));
