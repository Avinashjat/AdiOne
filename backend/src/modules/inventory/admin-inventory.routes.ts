/** Admin inventory endpoints (Task 5.1). */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../shared';
import { asyncHandler, noContent, ok } from '../../common/response';
import { validate } from '../../middleware/validate';
import { requirePermission, requireUser } from '../../middleware/auth';
import * as storeService from '../stores/store.service';
import * as service from './inventory.service';

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });

export const adminInventoryRouter: Router = Router();

adminInventoryRouter.patch(
  '/store-variants/:id/stock',
  requirePermission(Permission.INVENTORY_WRITE),
  validate({
    params: idParams,
    body: z.object({
      stockQty: z.number().int().min(0).max(1_000_000),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { stockQty, note } = req.body as { stockQty: number; note?: string };
    await service.setStock(req.params['id'] as string, stockQty, requireUser(req).id, note);
    noContent(res);
  }),
);

adminInventoryRouter.patch(
  '/store-variants/:id/availability',
  requirePermission(Permission.INVENTORY_WRITE),
  validate({ params: idParams, body: z.object({ isAvailable: z.boolean() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params['id'] as string;
    const actorId = requireUser(req).id;
    const { isAvailable } = req.body as { isAvailable: boolean };
    if (isAvailable) await service.markAvailable(id, actorId);
    else await service.markOutOfStock(id, actorId);
    noContent(res);
  }),
);

adminInventoryRouter.patch(
  '/store-variants/:id/pricing',
  requirePermission(Permission.INVENTORY_WRITE),
  validate({
    params: idParams,
    body: z
      .object({
        pricePaise: z.number().int().min(0).optional(),
        mrpPaise: z.number().int().min(0).optional(),
      })
      .refine((v) => v.pricePaise !== undefined || v.mrpPaise !== undefined, {
        message: 'Nothing to update',
      }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.updatePricing(req.params['id'] as string, req.body, requireUser(req).id);
    noContent(res);
  }),
);

adminInventoryRouter.patch(
  '/store-variants/:id/limits',
  requirePermission(Permission.INVENTORY_WRITE),
  validate({
    params: idParams,
    body: z.object({
      maxQtyPerOrder: z.number().int().positive().max(1000).optional(),
      lowStockThreshold: z.number().int().min(0).max(10_000).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.updateLimits(req.params['id'] as string, req.body, requireUser(req).id);
    noContent(res);
  }),
);

adminInventoryRouter.get(
  '/inventory/low-stock',
  requirePermission(Permission.INVENTORY_READ),
  asyncHandler(async (_req: Request, res: Response) => {
    const store = await storeService.getActiveStore();
    ok(res, await service.listLowStock(store.id));
  }),
);

adminInventoryRouter.get(
  '/store-variants/:id/ledger',
  requirePermission(Permission.INVENTORY_READ),
  validate({ params: idParams }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.getLedger(req.params['id'] as string));
  }),
);
