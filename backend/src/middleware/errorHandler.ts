/**
 * Centralised error handling — the single exit point for every failure.
 *
 * Guarantees:
 *   - the client always receives the standard error envelope,
 *   - the `message` is always user-safe (never a stack trace, SQL string or
 *     provider payload),
 *   - the full detail is logged against the same `requestId` the client sees,
 *     so support can find it from a screenshot.
 */

import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import {
  ERROR_DEFAULT_MESSAGE,
  ErrorCode,
  type ApiError,
  type ApiErrorDetail,
} from '@shared';
import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import { getRequestId } from '../common/request-context';
import { isProduction } from '../config/env';

interface NormalisedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ApiErrorDetail[];
  retryAfterSeconds?: number;
  /** Logged only. */
  internalMessage: string;
}

function fromZodError(error: ZodError): NormalisedError {
  const details: ApiErrorDetail[] = error.issues.map((issue) => ({
    field: issue.path.join('.') || undefined,
    message: issue.message,
    code: issue.code,
  }));

  // Surface the first field-level message: "Enter a valid 10-digit mobile
  // number" is far more useful to a customer than a generic validation error.
  const first = details[0];
  const message =
    first && first.field
      ? first.message
      : ERROR_DEFAULT_MESSAGE[ErrorCode.VALIDATION_ERROR];

  return {
    status: 400,
    code: ErrorCode.VALIDATION_ERROR,
    message,
    details,
    internalMessage: `zod validation failed: ${error.issues.length} issue(s)`,
  };
}

function fromPrismaError(error: Prisma.PrismaClientKnownRequestError): NormalisedError {
  switch (error.code) {
    case 'P2002': {
      // Unique constraint. The target names the column(s) — useful in logs,
      // but never echoed to the client since it leaks schema detail.
      const target = (error.meta?.['target'] as string[] | undefined)?.join(', ') ?? 'field';
      return {
        status: 409,
        code: ErrorCode.VALIDATION_ERROR,
        message: 'This already exists.',
        internalMessage: `prisma P2002 unique constraint on ${target}`,
      };
    }
    case 'P2025':
      return {
        status: 404,
        code: ErrorCode.NOT_FOUND,
        message: ERROR_DEFAULT_MESSAGE[ErrorCode.NOT_FOUND],
        internalMessage: 'prisma P2025 record not found',
      };
    case 'P2003':
      return {
        status: 409,
        code: ErrorCode.VALIDATION_ERROR,
        message: 'This item is still referenced elsewhere and cannot be changed.',
        internalMessage: 'prisma P2003 foreign key constraint failed',
      };
    case 'P2034':
      // Write conflict / deadlock — genuinely transient, so tell the client to retry.
      return {
        status: 409,
        code: ErrorCode.ORDER_IN_PROGRESS,
        message: 'That was busy for a moment. Please try again.',
        internalMessage: 'prisma P2034 transaction write conflict / deadlock',
      };
    default:
      return {
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
        message: ERROR_DEFAULT_MESSAGE[ErrorCode.INTERNAL_ERROR],
        internalMessage: `prisma ${error.code}: ${error.message}`,
      };
  }
}

function normalise(error: unknown): NormalisedError {
  if (AppError.is(error)) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      ...(error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
      internalMessage: error.internalMessage ?? error.message,
    };
  }

  if (error instanceof ZodError) return fromZodError(error);

  if (error instanceof Prisma.PrismaClientKnownRequestError) return fromPrismaError(error);

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: 503,
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: ERROR_DEFAULT_MESSAGE[ErrorCode.SERVICE_UNAVAILABLE],
      internalMessage: `prisma init failed: ${error.message}`,
    };
  }

  // Body parser rejects malformed JSON with a SyntaxError carrying `body`.
  if (error instanceof SyntaxError && 'body' in error) {
    return {
      status: 400,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'The request could not be read.',
      internalMessage: `malformed JSON body: ${error.message}`,
    };
  }

  return {
    status: 500,
    code: ErrorCode.INTERNAL_ERROR,
    message: ERROR_DEFAULT_MESSAGE[ErrorCode.INTERNAL_ERROR],
    internalMessage: error instanceof Error ? error.message : String(error),
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express identifies
// error middleware by arity; `next` must stay in the signature.
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const normalised = normalise(error);
  const requestId = getRequestId();

  const logPayload = {
    err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    code: normalised.code,
    status: normalised.status,
    method: req.method,
    path: req.originalUrl,
    internalMessage: normalised.internalMessage,
  };

  // 5xx means we have a bug or an outage; 4xx is the client being told "no",
  // which is normal traffic and must not page anyone.
  if (normalised.status >= 500) logger.error(logPayload, 'unhandled error');
  else logger.warn(logPayload, 'request error');

  if (normalised.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(normalised.retryAfterSeconds));
  }

  const body: ApiError = {
    success: false,
    error: {
      code: normalised.code,
      message: normalised.message,
      ...(normalised.details ? { details: normalised.details } : {}),
      requestId,
      ...(normalised.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: normalised.retryAfterSeconds }
        : {}),
    },
  };

  // Outside production, attach the internal detail to speed up local debugging.
  // Never in production — it is exactly the information an attacker wants.
  if (!isProduction && normalised.status >= 500) {
    (body.error as unknown as Record<string, unknown>)['debug'] = normalised.internalMessage;
  }

  res.status(normalised.status).json(body);
}

/** 404 handler — must be registered after all routes. */
export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiError = {
    success: false,
    error: {
      code: ErrorCode.NOT_FOUND,
      message: 'This endpoint does not exist.',
      requestId: getRequestId(),
    },
  };
  res.status(404).json(body);
}
