import { d as defineApiHandler, s as sendOk, c as config, b as getDbPath } from '../../../_/api.mjs';
import '../../../nitro/nitro.mjs';
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

const health_get = defineApiHandler((event) => sendOk(event, {
  service: "sdg6-analytics-platform",
  mode: "nuxt3-nitro",
  status: "healthy",
  db_path: getDbPath(),
  integrations: {
    amap: Boolean(config.amap.key),
    llm_service_url: config.llm.baseUrl,
    lstm_service_url: config.lstm.baseUrl
  },
  time: (/* @__PURE__ */ new Date()).toISOString()
}));

export { health_get as default };
//# sourceMappingURL=health.get.mjs.map
