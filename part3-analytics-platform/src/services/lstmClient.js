import { config } from '../config.js';
import { ApiError } from '../utils/response.js';

async function requestJson(method, path, body, timeoutMs, serviceName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.lstm.baseUrl}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.code) {
      throw new ApiError(3001, `${serviceName} service error`, 502, payload);
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ApiError(3002, `${serviceName} service timeout`, 504);
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(3001, `${serviceName} service unavailable: ${error.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function generateLstmAnalysis({ region, limit = 300, noCache = false }) {
  return requestJson(
    'POST',
    '/api/v1/lstm/analysis/generate',
    { region, limit, no_cache: Boolean(noCache) },
    config.lstm.timeoutMs,
    'LSTM'
  );
}

export async function submitLstmReading(reading) {
  return requestJson(
    'POST',
    '/api/v1/lstm/readings',
    reading,
    config.lstm.timeoutMs,
    'LSTM'
  );
}

export async function checkLstmHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${config.lstm.baseUrl}/health`, { signal: controller.signal });
    return await response.json();
  } catch (error) {
    return { status: 'down', error: error.message };
  } finally {
    clearTimeout(timer);
  }
}
