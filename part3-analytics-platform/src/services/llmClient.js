import { config } from '../config.js';
import { ApiError } from '../utils/response.js';

async function postJson(url, body, timeoutMs, serviceName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
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

async function deleteJson(url, timeoutMs, serviceName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'DELETE',
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
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

export async function generateInsight({ scope, region, regionSnapshot, refReportId, pointSnapshot, noCache = false }) {
  const body = scope === 'region'
    ? {
        scope: 'region',
        region,
        region_snapshot: regionSnapshot,
        no_cache: Boolean(noCache)
      }
    : {
        scope: 'point',
        ref_report_id: refReportId,
        point_snapshot: pointSnapshot,
        no_cache: Boolean(noCache)
      };

  return postJson(
    `${config.llm.baseUrl}/api/v1/insights/generate`,
    body,
    config.llm.timeoutMs,
    'LLM'
  );
}

export async function checkLlmHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${config.llm.baseUrl}/health`, { signal: controller.signal });
    return await response.json();
  } catch (error) {
    return { status: 'down', error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

export async function clearLlmRecords() {
  return deleteJson(
    `${config.llm.baseUrl}/api/v1/insights/records`,
    config.llm.timeoutMs,
    'LLM'
  );
}
