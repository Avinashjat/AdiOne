/**
 * Health endpoints.
 *
 * Two distinct checks, because they answer different questions:
 *
 *   /health        LIVENESS  — is the process running? Never touches a
 *                              dependency, so a database blip does not cause
 *                              an orchestrator to kill a healthy process.
 *   /health/ready  READINESS — can this instance serve traffic? Checks the
 *                              database and cache; a load balancer should stop
 *                              routing here when it fails.
 */

import type { Request, Response } from 'express';
import { checkDatabaseConnection } from '../../infra/db/prisma';
import { cache } from '../../infra/cache';
import { env } from '../../config/env';
import { ok } from '../../common/response';

const startedAt = Date.now();

export function live(_req: Request, res: Response): void {
  ok(res, {
    status: 'ok',
    service: 'adione-api',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
}

export async function ready(_req: Request, res: Response): Promise<void> {
  const [database, cacheOk] = await Promise.all([
    checkDatabaseConnection(),
    cache.ping(),
  ]);

  const healthy = database && cacheOk;

  const body = {
    status: healthy ? ('ok' as const) : ('degraded' as const),
    checks: {
      database: database ? ('up' as const) : ('down' as const),
      cache: cacheOk ? ('up' as const) : ('down' as const),
      cacheDriver: env.REDIS ? 'redis' : 'node-cache',
    },
    timestamp: new Date().toISOString(),
  };

  // 503 so orchestrators and load balancers act on it rather than having to
  // parse the body.
  res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: body,
    meta: { requestId: res.getHeader('x-request-id') ?? '' },
  });
}

