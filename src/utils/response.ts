import type { AppContext } from "../types.js";
import { ErrorCode } from "../types.js";

export function success<T>(c: AppContext, data: T, status: 200 | 201 = 200) {
  return c.json(data, status);
}

export function error(
  c: AppContext,
  code: (typeof ErrorCode)[keyof typeof ErrorCode],
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 500,
) {
  return c.json({ error: { code, message, status } }, status);
}
