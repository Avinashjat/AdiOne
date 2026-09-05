import type { Request, Response } from 'express';
import { ok } from '../../common/response';
import { validatedQuery } from '../../middleware/validate';
import * as storeService from './store.service';
import type { ServiceabilityQuery } from './store.validation';

/**
 * GET /store
 * Store details plus whether it is open right now — drives the Store Closed
 * screen and the About page.
 */
export async function getStore(_req: Request, res: Response): Promise<void> {
  ok(res, await storeService.getStoreDto());
}

/**
 * GET /store/serviceability?lat=&lng=
 *
 * Called on app open and whenever the customer changes location. Answers
 * "3.2 km away from store" and drives the "Sorry, we don't deliver here"
 * screen from the mockups.
 */
export async function getServiceability(req: Request, res: Response): Promise<void> {
  const { lat, lng } = validatedQuery<ServiceabilityQuery>(req);
  ok(res, await storeService.getServiceability(lat, lng));
}
