import { Router } from 'express';
import { asyncHandler } from '../../common/response';
import { validate } from '../../middleware/validate';
import * as controller from './store.controller';
import { serviceabilityQuerySchema } from './store.validation';

export const storeRouter: Router = Router();

// Public: the app must be able to check serviceability BEFORE asking anyone to
// log in. Requiring auth first would mean a customer outside the delivery area
// has to create an account only to be told no.
storeRouter.get('/', asyncHandler(controller.getStore));

storeRouter.get(
  '/serviceability',
  validate({ query: serviceabilityQuerySchema }),
  asyncHandler(controller.getServiceability),
);
