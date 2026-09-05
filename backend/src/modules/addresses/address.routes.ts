import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../shared';
import { normalizeIndianMobile, isValidPincode } from '../../shared/phone';
import { asyncHandler, created, noContent, ok } from '../../common/response';
import { validate } from '../../middleware/validate';
import { authenticate, requirePermission, requireUser } from '../../middleware/auth';
import * as service from './address.service';

const uuid = z.string().uuid();

const mobile = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizeIndianMobile(value);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid 10-digit mobile number',
      });
      return z.NEVER;
    }
    return normalized;
  });

/**
 * Address fields match the mockup exactly.
 *
 * `area` and `landmark` carry more weight than street or house number in this
 * market — "Near Shiv Mandir, Main Road" often IS the whole address, and it is
 * what the rider actually navigates by. So `area` is required while house
 * number and street are not.
 */
const addressBody = z.object({
  label: z.string().trim().min(1).max(30).default('Home'),
  fullName: z.string().trim().min(2, 'Enter the recipient name').max(120),
  mobile,
  houseNo: z.string().trim().max(80).nullable().optional(),
  street: z.string().trim().max(160).nullable().optional(),
  area: z.string().trim().min(2, 'Enter your area or village').max(160),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: z
    .string()
    .trim()
    .refine(isValidPincode, 'Enter a valid 6-digit PIN code'),
  landmark: z.string().trim().max(160).nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  isDefault: z.boolean().optional(),
});

export const addressRouter: Router = Router();

addressRouter.use(authenticate, requirePermission(Permission.ADDRESS_MANAGE));

addressRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.listAddresses(requireUser(req).id));
  }),
);

addressRouter.post(
  '/',
  validate({ body: addressBody }),
  asyncHandler(async (req: Request, res: Response) => {
    created(res, await service.createAddress(requireUser(req).id, req.body));
  }),
);

addressRouter.patch(
  '/:id',
  validate({ params: z.object({ id: uuid }), body: addressBody.partial() }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(
      res,
      await service.updateAddress(requireUser(req).id, req.params['id'] as string, req.body),
    );
  }),
);

addressRouter.delete(
  '/:id',
  validate({ params: z.object({ id: uuid }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.deleteAddress(requireUser(req).id, req.params['id'] as string);
    noContent(res);
  }),
);

addressRouter.post(
  '/:id/default',
  validate({ params: z.object({ id: uuid }) }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.setDefaultAddress(requireUser(req).id, req.params['id'] as string));
  }),
);
