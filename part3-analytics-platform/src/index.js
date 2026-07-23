import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { initDb, getDbPath } from './db.js';
import { ok, fail } from './utils/response.js';
import { reportsRouter } from './routes/reports.js';
import { mapRouter } from './routes/map.js';
import { dashboardRouter } from './routes/dashboard.js';
import { insightsRouter } from './routes/insights.js';
import { analysisJobsRouter } from './routes/analysisJobs.js';
import { geoRouter } from './routes/geo.js';
import { checkLlmHealth } from './services/llmClient.js';
import { checkLstmHealth } from './services/lstmClient.js';

initDb();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', async (_req, res) => {
  res.json(ok({
    status: 'up',
    service: 'sdg6-analytics-platform',
    db_path: getDbPath(),
    time: new Date().toISOString()
  }));
});

app.get('/api/v1/health', async (_req, res) => {
  const [llm, lstm] = await Promise.all([checkLlmHealth(), checkLstmHealth()]);
  res.json(ok({
    status: 'up',
    service: 'sdg6-analytics-platform',
    dependencies: { llm, lstm },
    time: new Date().toISOString()
  }));
});

app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/map', mapRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/insights', insightsRouter);
app.use('/api/v1/analysis', analysisJobsRouter);
app.use('/api/v1/geo', geoRouter);

app.use((_req, res) => {
  res.status(404).json({ code: 1003, message: 'route not found', data: null });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  fail(res, error);
});

app.listen(config.port, () => {
  console.log(`SDG6 analytics platform listening on http://localhost:${config.port}`);
});
