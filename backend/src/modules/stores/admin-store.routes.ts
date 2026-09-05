/**
 * Admin store endpoints.
 *
 * Mounted under /api/v1/admin, which is already gated by `authenticate` +
 * `requireAdmin`; the route declares the specific permission it needs.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../shared';
import { asyncHandler, ok } from '../../common/response';
import { validate } from '../../middleware/validate';
import { requirePermission, requireUser } from '../../middleware/auth';
import * as service from './admin-store.service';

const bodySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().trim().min(2).max(160).optional(),
  addressLine: z.string().trim().min(2).max(300).optional(),
  city: z.string().trim().min(2).max(120).optional(),
  state: z.string().trim().min(2).max(120).optional(),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits.').optional(),
  phone: z.string().trim().min(10).max(15).optional(),
});

const statusSchema = z.object({
  isActive: z.boolean(),
});

/** 24-hour "HH:mm". The panel sends `<input type="time">` values verbatim. */
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Times must be in 24-hour HH:mm form.');

const hoursSchema = z.object({
  hours: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        opensAt: timeSchema,
        closesAt: timeSchema,
        isClosed: z.boolean(),
      }),
    )
    .min(1)
    .max(7),
});

export const adminStoreRouter: Router = Router();

adminStoreRouter.patch(
  '/store',
  requirePermission(Permission.CONFIG_WRITE),
  validate({ body: bodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.updateStoreLocation(req.body, requireUser(req).id));
  }),
);

// Read before write: the panel needs the current switch and all seven days,
// including while the store is paused.
adminStoreRouter.get(
  '/store/availability',
  requirePermission(Permission.CONFIG_WRITE),
  asyncHandler(async (_req: Request, res: Response) => {
    ok(res, await service.getAvailability());
  }),
);

adminStoreRouter.patch(
  '/store/status',
  requirePermission(Permission.CONFIG_WRITE),
  validate({ body: statusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.setTradingStatus(req.body.isActive, requireUser(req).id));
  }),
);

adminStoreRouter.patch(
  '/store/hours',
  requirePermission(Permission.CONFIG_WRITE),
  validate({ body: hoursSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.updateHours(req.body, requireUser(req).id));
  }),
);
