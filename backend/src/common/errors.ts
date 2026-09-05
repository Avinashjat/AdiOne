/**
 * Application error type.
 *
 * Everything thrown deliberately by a service is an `AppError` carrying a
 * stable `ErrorCode`. The error handler turns it into the standard wire shape.
 *
 * Contract:
 *   - `message` is ALWAYS safe to show an end user.
 *   - `internalMessage` and `cause` are for logs only and are never serialised.
 */

import {
  ERROR_DEFAULT_MESSAGE,
  ERROR_HTTP_STATUS,
  ErrorCode,
  type ApiErrorDetail,
} from '@shared';

export interface AppErrorOptions {
  /** Overrides the default user-facing message for this code. */
  message?: string;
  /** Overrides the default HTTP status for this code. */
  status?: number;
  details?: ApiErrorDetail[];
  /** Logged, never sent to the client. */
  internalMessage?: string;
  cause?: unknown;
  retryAfterSeconds?: number;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: ApiErrorDetail[];
  public readonly internalMessage?: string;
  public readonly retryAfterSeconds?: number;
  /** True for errors we raised deliberately; false for unexpected crashes. */
  public readonly isOperational = true;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? ERROR_DEFAULT_MESSAGE[code]);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? ERROR_HTTP_STATUS[code] ?? 500;
    if (options.details) this.details = options.details;
    if (options.internalMessage) this.internalMessage = options.internalMessage;
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
    if (options.cause !== undefined) this.cause = options.cause;
    Error.captureStackTrace?.(this, AppError);
  }

  static is(error: unknown): error is AppError {
    return error instanceof AppError;
  }
}

/* -------------------------------------------------------------------------- */
/* Shorthand constructors for the codes used most often                       */
/* -------------------------------------------------------------------------- */

export const badRequest = (message?: string, details?: ApiErrorDetail[]): AppError =>
  new AppError(ErrorCode.VALIDATION_ERROR, {
    ...(message !== undefined ? { message } : {}),
    ...(details !== undefined ? { details } : {}),
  });

export const notFound = (what = 'Resource', internalMessage?: string): AppError =>
  new AppError(ErrorCode.NOT_FOUND, {
    message: `${what} not found.`,
    ...(internalMessage !== undefined ? { internalMessage } : {}),
  });

export const unauthenticated = (internalMessage?: string): AppError =>
  new AppError(ErrorCode.UNAUTHENTICATED, {
    ...(internalMessage !== undefined ? { internalMessage } : {}),
  });

export const forbidden = (internalMessage?: string): AppError =>
  new AppError(ErrorCode.FORBIDDEN, {
    ...(internalMessage !== undefined ? { internalMessage } : {}),
  });

export const internal = (internalMessage: string, cause?: unknown): AppError =>
  new AppError(ErrorCode.INTERNAL_ERROR, { internalMessage, cause });

export const rateLimited = (retryAfterSeconds: number, message?: string): AppError =>
  new AppError(ErrorCode.RATE_LIMITED, {
    retryAfterSeconds,
    ...(message !== undefined ? { message } : {}),
  });
