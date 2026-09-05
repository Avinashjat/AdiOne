import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../shared';
import { asyncHandler, ok } from '../../common/response';
import { validate } from '../../middleware/validate';
import { authenticate, requirePermission, requireUser } from '../../middleware/auth';
import { idempotency } from '../../middleware/idempotency';
import { prisma } from '../../infra/db/prisma';
import * as service from './payment.service';

const uuid = z.string().uuid();

export const paymentRouter: Router = Router();

/**
 * POST /payments/webhook
 *
 * PUBLIC and unauthenticated — the PSP has no token. Authenticity comes from
 * the HMAC over the RAW body, which is why `express.raw()` is mounted for this
 * path in app.ts ABOVE the JSON parser: re-serialising the body changes the
 * bytes and the signature would never match.
 *
 * Declared before the `authenticate` middleware below so it stays public.
 */
paymentRouter.post(
  '/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body ?? {}));
    ok(res, await service.handleWebhook(rawBody, req.headers as Record<string, string>));
  }),
);

paymentRouter.use(authenticate, requirePermission(Permission.ORDER_CREATE));

/**
 * Idempotent: a double-tap on "Pay" must not create two provider orders and
 * two chances to be charged.
 */
paymentRouter.post(
  '/create',
  validate({ body: z.object({ orderId: uuid }) }),
  idempotency('POST /payments/create'),
  asyncHandler(async (req: Request, res: Response) => {
    const { orderId } = req.body as { orderId: string };
    ok(res, await service.createPayment(requireUser(req).id, orderId));
  }),
);

paymentRouter.post(
  '/verify',
  validate({
    body: z.object({
      orderId: uuid,
      providerOrderId: z.string().min(4).max(120),
      providerPaymentId: z.string().min(4).max(120),
      signature: z.string().min(16).max(512),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    ok(res, await service.verifyPayment(requireUser(req).id, req.body));
  }),
);

/**
 * POST /payments/claim
 *
 * The customer says they paid by UPI. This records the claim and puts the
 * order in the store's verification queue — it does NOT confirm anything.
 * Accepting a self-reported payment would hand out goods for free.
 */
paymentRouter.post(
  '/claim',
  validate({
    body: z.object({
      orderId: uuid,
      // UTR / RRN from the customer's receipt. 12 digits, but optional —
      // plenty of customers will not find it, and refusing the claim over a
      // missing reference just moves the problem to a phone call.
      utr: z
        .string()
        .trim()
        .regex(/^\d{12}$/, 'The UPI reference number is 12 digits')
        .nullable()
        .optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as { orderId: string; utr?: string | null };
    ok(res, await service.claimUpiPayment(requireUser(req).id, body));
  }),
);

paymentRouter.get(
  '/:orderId/status',
  validate({ params: z.object({ orderId: uuid }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const user = requireUser(req);
    const order = await prisma.order.findFirst({
      where: { id: req.params['orderId'] as string, userId: user.id },
      select: { status: true, paymentStatus: true, totalPaise: true },
    });
    ok(res, order ?? null);
  }),
);
