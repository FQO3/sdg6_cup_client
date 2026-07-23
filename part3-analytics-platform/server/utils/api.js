import { ok, ApiError } from '~~/src/utils/response.js';
import { initDb } from '~~/src/db.js';

let dbReady = false;

export function ensureDb() {
  if (!dbReady) {
    initDb();
    dbReady = true;
  }
}

export function sendOk(event, data = null, message = 'ok', status = 200) {
  setResponseStatus(event, status);
  return ok(data, message);
}

export function throwApiError(error) {
  if (error instanceof ApiError) {
    throw createError({
      statusCode: error.status || 400,
      statusMessage: error.message,
      data: { code: error.code, message: error.message, data: error.data || null }
    });
  }
  throw createError({
    statusCode: 500,
    statusMessage: error?.message || 'internal error',
    data: { code: 2001, message: error?.message || 'internal error', data: null }
  });
}

export function defineApiHandler(handler) {
  return defineEventHandler(async (event) => {
    ensureDb();
    try {
      return await handler(event);
    } catch (error) {
      throwApiError(error);
    }
  });
}

export function getApiQuery(event) {
  return getQuery(event) || {};
}
