/**
 * Wire contract shared by the API and every client.
 *
 * Every response is one of exactly two shapes. Clients branch on `success`.
 */

import type { ErrorCode } from './errors';

export interface ApiMeta {
  requestId: string;
  /** Opaque cursor for the next page; absent when there are no more results. */
  nextCursor?: string | null;
  /** Total count — only supplied by admin endpoints where it is cheap. */
  total?: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
  [key: string]: unknown;
}

export interface ApiErrorBody {
  code: ErrorCode;
  /** Always safe to display to an end user. */
  message: string;
  details?: ApiErrorDetail[];
  requestId: string;
  /** Present on 429 responses. */
  retryAfterSeconds?: number;
}

export interface ApiError {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function isApiError<T>(res: ApiResponse<T>): res is ApiError {
  return res.success === false;
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Cursor pagination is the default: catalogue and order lists are read while
 * rows are being inserted, and offset pagination silently duplicates or skips
 * rows when that happens.
 */
export interface CursorPageQuery {
  cursor?: string | null;
  limit?: number;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Offset pagination — admin tables only, where a total count is wanted. */
export interface OffsetPageQuery {
  page?: number;
  limit?: number;
}

export interface OffsetPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

/* -------------------------------------------------------------------------- */
/* Headers                                                                    */
/* -------------------------------------------------------------------------- */

export const HEADER_IDEMPOTENCY_KEY = 'idempotency-key';
export const HEADER_REQUEST_ID = 'x-request-id';
export const HEADER_CLIENT_VERSION = 'x-client-version';
export const HEADER_CLIENT_PLATFORM = 'x-client-platform';
