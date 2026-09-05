/**
 * Payments (Phase 9).
 *
 * Three paths converge on ONE idempotent handler (PRD §14.4):
 *
 *   FAST      client calls /payments/verify after the PSP sheet closes
 *   TRUTH     the PSP's signed webhook arrives
 *   RECONCILE a job sweeps payments left pending and asks the provider
 *
 * Whichever arrives first wins; the others are no-ops. That is what survives
 * the real failure modes — the app killed mid-payment, the webhook arriving
 * before the client returns, the phone losing network after paying, or the
 * provider retrying a webhook five times.
 *
 * A CLIENT-REPORTED SUCCESS NEVER CONFIRMS A PAYMENT ON ITS OWN. `/verify`
 * re-queries the provider server-side.
 */

import {
  ActorType,
  ConfigKey,
  ErrorCode,
  NotificationType,
  OrderPaymentStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  RefundStatus,
  type CreatePaymentResponse,
  type VerifyPaymentResponse,
} from '../../shared';
import { AppError } from '../../common/errors';
import { env } from '../../config/env';
import { prisma, runInTransaction } from '../../infra/db/prisma';
import {
  buildUpiIntentUrl,
  payments as provider,
  requiresManualPaymentConfirmation,
} from '../../infra/payment';
import type { WebhookEvent } from '../../infra/payment';
import { moduleLogger } from '../../common/logger';
import * as configService from '../configuration/configuration.service';
import { confirmPaymentAndPlace, transitionOrder } from '../orders/order-state.service';

const log = moduleLogger('payments');

/* -------------------------------------------------------------------------- */
/* Task 9.2 — create                                                          */
/* -------------------------------------------------------------------------- */

export async function createPayment(
  userId: string,
  orderId: string,
): Promise<CreatePaymentResponse> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { user: true },
  });

  if (!order) throw new AppError(ErrorCode.NOT_FOUND, { message: 'Order not found.' });

  if (order.paymentMethod !== PaymentMethod.ONLINE) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: 'This order is Cash on Delivery.',
    });
  }
  if (order.paymentStatus === OrderPaymentStatus.PAID) {
    throw new AppError(ErrorCode.PAYMENT_ALREADY_CAPTURED);
  }
  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: 'This order is no longer awaiting payment.',
    });
  }

  // Reuse an existing intent when the customer reopens the payment sheet —
  // creating a second provider order per tap would clutter reconciliation.
  const existing = await prisma.payment.findFirst({
    where: { orderId, status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] } },
    orderBy: { createdAt: 'desc' },
  });

  // Reopening the payment sheet must return the SAME provider order, not mint
  // a new one. Creating a fresh intent per tap would leave orphaned provider
  // orders and make reconciliation ambiguous about which one the customer paid.
  let providerOrderId = existing?.providerOrderId ?? null;

  if (!providerOrderId) {
    const intent = await provider.createIntent({
      orderId: order.id,
      orderNumber: order.orderNumber,
      // The amount ALWAYS comes from the order the server computed.
      amountPaise: order.totalPaise,
      currency: 'INR',
      customer: {
        name: order.user.fullName,
        email: order.user.email,
        contact: order.deliveryMobile,
      },
    });
    providerOrderId = intent.providerOrderId;

    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: provider.name,
        providerOrderId,
        amountPaise: order.totalPaise,
        currency: 'INR',
        status: PaymentStatus.CREATED,
      },
    });
  }

  const publicKey = provider.publicKey();

  // For direct UPI the "intent" is a deep link the phone hands to the
  // customer's UPI app. There is no gateway sheet and no callback.
  const upiIntentUrl = requiresManualPaymentConfirmation()
    ? buildUpiIntentUrl({
        vpa: publicKey,
        payeeName: env.UPI_PAYEE_NAME,
        // Always the server's total, never a client figure.
        amountPaise: order.totalPaise,
        orderNumber: order.orderNumber,
      })
    : null;

  return {
    paymentId: existing?.id ?? providerOrderId,
    provider: provider.name,
    providerOrderId,
    publicKey,
    amountPaise: order.totalPaise,
    currency: 'INR',
    prefill: {
      name: order.user.fullName,
      email: order.user.email,
      contact: order.deliveryMobile,
    },
    ...(upiIntentUrl
      ? {
          upiIntentUrl,
          upiVpa: publicKey,
          // Tells the app to show "I have paid" instead of waiting for a
          // gateway callback that will never arrive.
          requiresManualConfirmation: true,
        }
      : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* UPI: the customer claims, the store confirms                               */
/* -------------------------------------------------------------------------- */

/**
 * Records the customer's claim that they have paid by UPI.
 *
 * THIS DOES NOT CONFIRM THE ORDER. Nothing here can verify that money moved —
 * accepting the claim would let anyone tap a button and receive goods. It
 * records the claim (with the UTR if given), extends the stock hold so a
 * genuine payment is not cancelled while the shop is busy, and puts the order
 * in front of the store to verify against its own UPI app.
 */
export async function claimUpiPayment(
  userId: string,
  input: { orderId: string; utr?: string | null },
): Promise<{ status: 'AWAITING_CONFIRMATION' }> {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, userId },
  });
  if (!order) throw new AppError(ErrorCode.NOT_FOUND, { message: 'Order not found.' });

  if (order.paymentStatus === OrderPaymentStatus.PAID) {
    throw new AppError(ErrorCode.PAYMENT_ALREADY_CAPTURED);
  }
  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: 'This order is no longer awaiting payment.',
    });
  }

  const holdMinutes = await configService.get(ConfigKey.PAYMENT_HOLD_MINUTES);

  await runInTransaction(async (tx) => {
    await tx.payment.updateMany({
      where: { orderId: order.id, status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] } },
      data: {
        status: PaymentStatus.PENDING,
        method: 'upi',
        // The UTR is the customer's receipt number. It is what the shopkeeper
        // matches against their UPI app — the whole point of asking for it.
        rawPayload: { claimedAt: new Date().toISOString(), utr: input.utr ?? null } as never,
      },
    });

    // A manual check takes longer than an automatic one. Without this the
    // release job would cancel orders the customer genuinely paid for.
    await tx.order.update({
      where: { id: order.id },
      data: {
        reservationExpiresAt: new Date(Date.now() + holdMinutes * 4 * 60_000),
      },
    });
  });

  log.info(
    { orderId: order.id, orderNumber: order.orderNumber, utr: input.utr ?? null },
    'customer claimed a UPI payment — awaiting store confirmation',
  );

  return { status: 'AWAITING_CONFIRMATION' };
}

/**
 * The store confirms it can see the money in its UPI app.
 *
 * This is the verification step for direct UPI — a human looked at the bank
 * app. It is deliberately an ADMIN action: no customer input can reach it.
 */
export async function confirmPaymentManually(
  orderId: string,
  actorUserId: string,
  reference?: string | null,
): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

  if (order.paymentStatus === OrderPaymentStatus.PAID) return; // idempotent
  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: 'This order is not awaiting payment.',
    });
  }

  await prisma.payment.updateMany({
    where: { orderId, status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] } },
    data: {
      status: PaymentStatus.CAPTURED,
      providerPaymentId: reference ?? `manual_${orderId.slice(0, 8)}`,
      capturedAt: new Date(),
    },
  });

  // Commits the stock reservation and places the order, exactly as a gateway
  // confirmation would — the same path, a different trigger.
  await confirmPaymentAndPlace(orderId, ActorType.ADMIN);

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'payment.confirm_manual',
      entityType: 'Order',
      entityId: orderId,
      after: { reference: reference ?? null },
    },
  });

  log.info({ orderId, actorUserId, reference }, 'payment confirmed manually by the store');
}

/* -------------------------------------------------------------------------- */
/* The single convergent handler                                              */
/* -------------------------------------------------------------------------- */

interface SettlementInput {
  orderId: string;
  providerPaymentId: string;
  providerOrderId: string | null;
  amountPaise: number;
  method: string | null;
  actorType: ActorType;
  rawPayload?: unknown;
}

/**
 * Records a successful capture and advances the order.
 *
 * Idempotent by construction:
 *   - `UNIQUE (provider, provider_payment_id)` makes a second capture row
 *     impossible at the storage layer;
 *   - `transitionOrder` treats an already-applied transition as a no-op.
 */
async function settleCapture(input: SettlementInput): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: input.orderId } });

  // Amount cross-check. A mismatch means the customer was charged something
  // other than the order total — treated as fraud, never auto-confirmed.
  if (input.amountPaise !== order.totalPaise) {
    log.error(
      {
        orderId: order.id,
        expected: order.totalPaise,
        received: input.amountPaise,
        providerPaymentId: input.providerPaymentId,
      },
      'PAYMENT AMOUNT MISMATCH — not confirming',
    );
    throw new AppError(ErrorCode.PAYMENT_AMOUNT_MISMATCH);
  }

  const alreadyCaptured = await prisma.payment.findFirst({
    where: {
      provider: provider.name,
      providerPaymentId: input.providerPaymentId,
      status: PaymentStatus.CAPTURED,
    },
  });

  if (!alreadyCaptured) {
    await runInTransaction(async (tx) => {
      const pending = await tx.payment.findFirst({
        where: { orderId: order.id, status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] } },
        orderBy: { createdAt: 'desc' },
      });

      if (pending) {
        await tx.payment.update({
          where: { id: pending.id },
          data: {
            providerPaymentId: input.providerPaymentId,
            providerOrderId: input.providerOrderId ?? pending.providerOrderId,
            status: PaymentStatus.CAPTURED,
            method: input.method,
            capturedAt: new Date(),
            rawPayload: (input.rawPayload ?? null) as never,
          },
        });
      } else {
        // Webhook arrived for a payment we never recorded an intent for —
        // record it rather than dropping the money on the floor.
        await tx.payment.create({
          data: {
            orderId: order.id,
            provider: provider.name,
            providerOrderId: input.providerOrderId,
            providerPaymentId: input.providerPaymentId,
            amountPaise: input.amountPaise,
            status: PaymentStatus.CAPTURED,
            method: input.method,
            capturedAt: new Date(),
            rawPayload: (input.rawPayload ?? null) as never,
          },
        });
      }
    });
  }

  if (order.status === OrderStatus.PENDING_PAYMENT) {
    // Commits the stock reservation and places the order, in one transaction.
    await confirmPaymentAndPlace(order.id, input.actorType);
  }
}

async function settleFailure(
  orderId: string,
  reason: string,
  actorType: ActorType,
): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status !== OrderStatus.PENDING_PAYMENT) return;

  await prisma.payment.updateMany({
    where: { orderId, status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] } },
    data: { status: PaymentStatus.FAILED, failureReason: reason },
  });

  // Releases the stock reservation via the state machine's side effects.
  await transitionOrder({
    orderId,
    toStatus: OrderStatus.PAYMENT_FAILED,
    actorType,
    reason,
  });
}

/* -------------------------------------------------------------------------- */
/* Task 9.2 — verify (fast path)                                              */
/* -------------------------------------------------------------------------- */

export async function verifyPayment(
  userId: string,
  input: {
    orderId: string;
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
  },
): Promise<VerifyPaymentResponse> {
  const order = await prisma.order.findFirst({ where: { id: input.orderId, userId } });
  if (!order) throw new AppError(ErrorCode.NOT_FOUND, { message: 'Order not found.' });

  // The client's word is a HINT. This asks the provider directly.
  const result = await provider.verify({
    providerOrderId: input.providerOrderId,
    providerPaymentId: input.providerPaymentId,
    signature: input.signature,
  });

  if (!result.verified) {
    log.warn(
      { orderId: order.id, reason: result.failureReason },
      'payment verification failed',
    );
    await settleFailure(order.id, result.failureReason ?? 'verification failed', ActorType.SYSTEM);
    throw new AppError(ErrorCode.PAYMENT_VERIFICATION_FAILED);
  }

  await settleCapture({
    orderId: order.id,
    providerPaymentId: input.providerPaymentId,
    providerOrderId: input.providerOrderId,
    amountPaise: result.amountPaise,
    method: result.method,
    actorType: ActorType.SYSTEM,
  });

  const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  return {
    verified: true,
    orderStatus: updated.status,
    paymentStatus: updated.paymentStatus,
  };
}

/* -------------------------------------------------------------------------- */
/* Task 9.2 — webhook (truth path)                                            */
/* -------------------------------------------------------------------------- */

export async function handleWebhook(
  rawBody: Buffer,
  headers: Record<string, string | undefined>,
): Promise<{ received: true }> {
  let event: WebhookEvent;
  try {
    event = provider.parseWebhook(rawBody, headers);
  } catch (error) {
    throw new AppError(ErrorCode.WEBHOOK_SIGNATURE_INVALID, {
      internalMessage: `unparseable webhook: ${String(error)}`,
    });
  }

  if (!event.signatureValid) {
    log.error({ eventId: event.eventId }, 'webhook signature invalid');
    throw new AppError(ErrorCode.WEBHOOK_SIGNATURE_INVALID);
  }

  // Replay guard. Providers retry aggressively; the unique index turns every
  // retry into a cheap no-op instead of a double-settlement.
  const existing = await prisma.paymentEvent.findUnique({
    where: { provider_eventId: { provider: provider.name, eventId: event.eventId } },
  });
  if (existing?.processedAt) {
    log.info({ eventId: event.eventId }, 'webhook already processed — ignoring replay');
    return { received: true };
  }

  const record = await prisma.paymentEvent.upsert({
    where: { provider_eventId: { provider: provider.name, eventId: event.eventId } },
    create: {
      provider: provider.name,
      eventId: event.eventId,
      eventType: event.type,
      signatureValid: true,
      payload: event.payload as never,
    },
    update: {},
  });

  try {
    const payment = event.providerOrderId
      ? await prisma.payment.findFirst({
          where: { provider: provider.name, providerOrderId: event.providerOrderId },
        })
      : null;

    if (!payment) {
      log.warn({ eventId: event.eventId }, 'webhook for an unknown payment — recorded only');
    } else if (event.status === 'CAPTURED' && event.providerPaymentId) {
      await settleCapture({
        orderId: payment.orderId,
        providerPaymentId: event.providerPaymentId,
        providerOrderId: event.providerOrderId,
        amountPaise: event.amountPaise ?? payment.amountPaise,
        method: null,
        actorType: ActorType.PAYMENT_WEBHOOK,
        rawPayload: event.payload,
      });
    } else if (event.status === 'FAILED') {
      await settleFailure(payment.orderId, 'payment failed at gateway', ActorType.PAYMENT_WEBHOOK);
    }

    await prisma.paymentEvent.update({
      where: { id: record.id },
      data: { processedAt: new Date() },
    });
  } catch (error) {
    // Record the failure and return 200 anyway: a 500 makes the provider retry
    // forever, and the reconciliation job will pick this up regardless.
    //
    // The stable error CODE is stored, not just the prose message — this row
    // is what someone triages an unsettled payment from, and grepping for
    // PAYMENT_AMOUNT_MISMATCH must work.
    const reason = AppError.is(error)
      ? `${error.code}: ${error.internalMessage ?? error.message}`
      : String(error);

    await prisma.paymentEvent.update({
      where: { id: record.id },
      data: { error: reason.slice(0, 500) },
    });
    log.error({ err: error, eventId: event.eventId }, 'webhook processing failed');
  }

  return { received: true };
}

/* -------------------------------------------------------------------------- */
/* Task 9.3 — refunds                                                         */
/* -------------------------------------------------------------------------- */

export async function refundOrder(
  orderId: string,
  reason: string,
  actorUserId: string,
): Promise<{ refundId: string; status: RefundStatus }> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

  if (order.paymentMethod === PaymentMethod.COD) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: 'Cash on Delivery orders are settled in cash — no online refund is possible.',
    });
  }
  if (order.paymentStatus !== OrderPaymentStatus.PAID) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: 'This order has not been paid, so there is nothing to refund.',
    });
  }

  const payment = await prisma.payment.findFirst({
    where: { orderId, status: PaymentStatus.CAPTURED },
  });
  if (!payment?.providerPaymentId) {
    throw new AppError(ErrorCode.REFUND_FAILED, {
      internalMessage: `no captured payment for order ${orderId}`,
    });
  }

  const existing = await prisma.refund.findFirst({
    where: { orderId, status: { in: [RefundStatus.PENDING, RefundStatus.PROCESSING, RefundStatus.COMPLETED] } },
  });
  if (existing) {
    return { refundId: existing.id, status: existing.status };
  }

  const refund = await prisma.refund.create({
    data: {
      paymentId: payment.id,
      orderId,
      amountPaise: order.totalPaise,
      status: RefundStatus.PENDING,
      reason,
    },
  });

  try {
    const result = await provider.refund({
      providerPaymentId: payment.providerPaymentId,
      amountPaise: order.totalPaise,
      reason,
    });

    await runInTransaction(async (tx) => {
      await tx.refund.update({
        where: { id: refund.id },
        data: {
          providerRefundId: result.providerRefundId,
          status: result.status as RefundStatus,
          ...(result.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
        },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REFUNDED },
      });
    });

    if (result.status === 'COMPLETED') {
      // Only from a terminal cancelled/rejected state — the state machine
      // rejects it otherwise, which is the intended guard.
      await transitionOrder({
        orderId,
        toStatus: OrderStatus.REFUNDED,
        actorType: ActorType.SYSTEM,
        actorUserId,
        reason,
      }).catch((error) => log.warn({ err: error, orderId }, 'refund transition skipped'));
    }

    log.info({ orderId, refundId: refund.id, status: result.status }, 'refund issued');
    return { refundId: refund.id, status: result.status as RefundStatus };
  } catch (error) {
    await prisma.refund.update({
      where: { id: refund.id },
      data: { status: RefundStatus.FAILED, failureReason: String(error).slice(0, 300) },
    });
    log.error({ err: error, orderId }, 'refund failed — needs manual action');
    throw new AppError(ErrorCode.REFUND_FAILED);
  }
}

/** Auto-refund on cancellation or rejection of a paid order. */
export async function refundIfPaid(orderId: string, reason: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return;
  if (order.paymentMethod !== PaymentMethod.ONLINE) return;
  if (order.paymentStatus !== OrderPaymentStatus.PAID) return;

  await refundOrder(orderId, reason, order.userId).catch((error) =>
    log.error({ err: error, orderId }, 'auto-refund failed — needs manual action'),
  );
}

export const NOTIFICATION_ON_REFUND = NotificationType.REFUND_INITIATED;
