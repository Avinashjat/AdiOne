import { Router } from 'express';
import { asyncHandler } from '../../common/response';
import * as controller from './health.controller';

export const healthRouter: Router = Router();

healthRouter.get('/', controller.live);
healthRouter.get('/live', controller.live);
healthRouter.get('/ready', asyncHandler(controller.ready));
