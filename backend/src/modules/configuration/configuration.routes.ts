import { Router } from 'express';
import { asyncHandler } from '../../common/response';
import * as controller from './configuration.controller';

export const configurationRouter: Router = Router();

configurationRouter.get('/public', asyncHandler(controller.getPublicConfig));

// Admin read/write endpoints (GET/PATCH /admin/config) are mounted by the
// admin module in Phase 13, once auth and RBAC middleware exist.
