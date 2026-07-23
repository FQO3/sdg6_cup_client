export function ok(data = null, message = 'ok') {
  return { code: 0, message, data };
}

export class ApiError extends Error {
  constructor(code, message, status = 400, data = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

export function fail(res, error) {
  const status = error.status || 500;
  const code = error.code || 2001;
  const message = error.message || 'internal error';
  return res.status(status).json({ code, message, data: error.data || null });
}

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function requireFields(object, fields, parent = 'body') {
  for (const field of fields) {
    if (object?.[field] === undefined || object?.[field] === null || object?.[field] === '') {
      throw new ApiError(1001, `missing required field: ${parent}.${field}`, 400);
    }
  }
}

export function assertEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new ApiError(1001, `invalid ${field}, expected one of: ${allowed.join(', ')}`, 400);
  }
}
