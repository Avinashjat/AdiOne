/**
 * Request logging + request-id correlation.
 *
 * Runs before everything else so that even a validation failure or a 404 is
 * logged with an id the client can quote back.
 */

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { HEADER_REQUEST_ID } from '@shared';
import { logger } from '../common/logger';
import { runWithRequestContext } from '../common/request-context';

/** Paths that are healthy-noise and would otherwise flood the log. */
const QUIET_PATHS = new Set(['/health', '/health/ready', '/health/live', '/favicon.ico']);

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Honour an upstream id (proxy / load balancer) so traces join up.
  const incoming = req.header(HEADER_REQUEST_ID);
  const requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();
  res.setHeader(HEADER_REQUEST_ID, requestId);

  const startedAt = process.hrtime.bigint();

  runWithRequestContext(
    {
      requestId,
      ip: req.ip ?? '',
      route: `${req.method} ${req.path}`,
    },
    () => {
      res.on('finish', () => {
        if (QUIET_PATHS.has(req.path) && res.statusCode < 400) return;

        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const payload = {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 10) / 10,
          // User agent is useful for debugging old app builds in the field.
          userAgent: req.header('user-agent'),
          clientVersion: req.header('x-client-version'),
        };

        if (res.statusCode >= 500) logger.error(payload, 'request failed');
        else if (res.statusCode >= 400) logger.warn(payload, 'request rejected');
        else logger.info(payload, 'request completed');
      });

      next();
    },
  );
}
