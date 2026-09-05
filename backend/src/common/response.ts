/**
 * Response helpers — the only place that constructs the wire envelope.
 *
 * Controllers call `ok()` / `created()`; they never build a response object by
 * hand, so the envelope can never drift between endpoints.
 */

import type { Response, Request, NextFunction, RequestHandler } from 'express';
import type { ApiMeta, ApiSuccess, CursorPage, OffsetPage } from '@shared';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from '@shared';
import { getRequestId } from './request-context';

function buildMeta(extra?: Partial<ApiMeta>): ApiMeta {
  return { requestId: getRequestId(), ...extra };
}

export function ok<T>(res: Response, data: T, meta?: Partial<ApiMeta>): Response {
  const body: ApiSuccess<T> = { success: true, data, meta: buildMeta(meta) };
  return res.status(200).json(body);
}

export function created<T>(res: Response, data: T, meta?: Partial<ApiMeta>): Response {
  const body: ApiSuccess<T> = { success: true, data, meta: buildMeta(meta) };
  return res.status(201).json(body);
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}

/** Sends a cursor page, lifting `nextCursor` into `meta` as well as the body. */
export function okCursorPage<T>(res: Response, page: CursorPage<T>): Response {
  return ok(res, page, { nextCursor: page.nextCursor });
}

export function okOffsetPage<T>(res: Response, page: OffsetPage<T>): Response {
  return ok(res, page, { total: page.total });
}

/* -------------------------------------------------------------------------- */
/* Async handler                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Express 5 forwards rejected promises to the error handler on its own, so
 * this is not strictly required. It is kept because it makes the intent
 * explicit at every route and costs nothing.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/* -------------------------------------------------------------------------- */
/* Pagination input                                                           */
/* -------------------------------------------------------------------------- */

export function parseLimit(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return PAGINATION_DEFAULT_LIMIT;
  return Math.min(Math.floor(value), PAGINATION_MAX_LIMIT);
}

export function parseCursor(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * Builds a cursor page from `limit + 1` rows: the extra row tells us whether
 * another page exists without a second COUNT query.
 */
export function buildCursorPage<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => string,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? toCursor(last) : null,
  };
}
