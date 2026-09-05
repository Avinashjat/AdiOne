import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, noContent, ok } from '../../common/response';
import { validate } from '../../middleware/validate';
import { authenticate, requireUser } from '../../middleware/auth';
import * as service from './notification.service';

export const notificationRouter: Router = Router();
export const deviceRouter: Router = Router();

notificationRouter.use(authenticate);
deviceRouter.use(authenticate);

notificationRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listForUser(requireUser(req).id));
  }),
);

notificationRouter.post(
  '/:id/read',
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.markRead(requireUser(req).id, req.params['id'] as string);
    noContent(res);
  }),
);

/** Registers an FCM token. Upserted on the token so a reinstall moves it. */
deviceRouter.post(
  '/',
  validate({
    body: z.object({
      token: z.string().trim().min(10).max(400),
      platform: z.enum(['ANDROID', 'IOS', 'WEB']),
      appVersion: z.string().trim().max(20).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as {
      token: string;
      platform: 'ANDROID' | 'IOS' | 'WEB';
      appVersion?: string;
    };
    await service.registerDevice({ userId: requireUser(req).id, ...body });
    noContent(res);
  }),
);
