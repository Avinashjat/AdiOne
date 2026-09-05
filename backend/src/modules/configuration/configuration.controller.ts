import type { Request, Response } from 'express';
import { ok } from '../../common/response';
import * as configService from './configuration.service';

/**
 * GET /api/v1/config/public
 *
 * Unauthenticated. Returns only the keys in PUBLIC_CONFIG_KEYS — the app needs
 * the service radius, minimum order, fee thresholds, support contacts and
 * feature flags to render correctly before login. Everything else (COD caps,
 * ETA parameters, payment hold windows) stays server-side.
 *
 * The app reads this on cold start and caches it; it is never a source of
 * truth for a decision, only for what to display.
 */
export async function getPublicConfig(_req: Request, res: Response): Promise<void> {
  const config = await configService.getPublic();
  ok(res, config);
}
