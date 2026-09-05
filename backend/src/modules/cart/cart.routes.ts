import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../shared';
import { asyncHandler, ok } from '../../common/response';
import { validate } from '../../middleware/validate';
import { authenticate, requirePermission, requireUser } from '../../middleware/auth';
import * as service from './cart.service';

const uuid = z.string().uuid();

export const cartRouter: Router = Router();

cartRouter.use(authenticate, requirePermission(Permission.CART_MANAGE));

cartRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, (await service.getCart(requireUser(req).id)).dto);
  }),
);

cartRouter.post(
  '/items',
  validate({
    body: z.object({
      variantId: uuid,
      // Bounded here as well as against the per-item limit: an unbounded qty
      // would be an easy way to attempt an integer overflow on the total.
      qty: z.number().int().positive().max(1000).default(1),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { variantId, qty } = req.body as { variantId: string; qty: number };
    ok(res, await service.addItem(requireUser(req).id, variantId, qty));
  }),
);

cartRouter.patch(
  '/items/:id',
  validate({
    params: z.object({ id: uuid }),
    // Zero is allowed and means "remove" — it is what the stepper sends when
    // the customer taps minus on the last unit.
    body: z.object({ qty: z.number().int().min(0).max(1000) }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { qty } = req.body as { qty: number };
    ok(res, await service.updateItemQty(requireUser(req).id, req.params['id'] as string, qty));
  }),
);

cartRouter.delete(
  '/items/:id',
  validate({ params: z.object({ id: uuid }) }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.removeItem(requireUser(req).id, req.params['id'] as string));
  }),
);

cartRouter.delete(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.clearCart(requireUser(req).id));
  }),
);

cartRouter.post(
  '/coupon',
  validate({ body: z.object({ code: z.string().trim().min(2).max(40) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.body as { code: string };
    ok(res, await service.applyCoupon(requireUser(req).id, code));
  }),
);

cartRouter.delete(
  '/coupon',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.removeCoupon(requireUser(req).id));
  }),
);
