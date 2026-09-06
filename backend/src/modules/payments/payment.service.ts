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
} from "../../shared";
import { AppError } from "../../common/errors";
import { env } from "../../config/env";
import { prisma, runInTransaction } from "../../infra/db/prisma";
import {
  buildUpiIntentUrl,
  payments as provider,
  requiresManualPaymentConfirmation,
} from "../../infra/payment";
import type { WebhookEvent } from "../../infra/payment";
import { moduleLogger } from "../../common/logger";
import * as configService from "../configuration/configuration.service";
import {
  confirmPaymentAndPlace,
  transitionOrder,
} from "../orders/order-state.service";

const log = moduleLogger("payments");

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

  if (!order)
    throw new AppError(ErrorCode.NOT_FOUND, { message: "Order not found." });

  if (order.paymentMethod !== PaymentMethod.ONLINE) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "This order is Cash on Delivery.",
    });
  }
  if (order.paymentStatus === OrderPaymentStatus.PAID) {
    throw new AppError(ErrorCode.PAYMENT_ALREADY_CAPTURED);
  }
  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "This order is no longer awaiting payment.",
    });
  }

  // Reuse an existing intent when the customer reopens the payment sheet —
  // creating a second provider order per tap would clutter reconciliation.
  const existing = await prisma.payment.findFirst({
    where: {
      orderId,
      status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] },
    },
    orderBy: { createdAt: "desc" },
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
      currency: "INR",
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
        currency: "INR",
        status: PaymentStatus.CREATED,
      },
    });
  }

  const upiId = await configService.get(ConfigKey.ADIONE_UPI_ID);

  if (!upiId || !upiId.trim()) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "Merchant UPI ID is not configured.",
    });
  }

  // For direct UPI the "intent" is a deep link the phone hands to the
  // customer's UPI app. There is no gateway sheet and no callback.
  const upiIntentUrl = requiresManualPaymentConfirmation()
    ? buildUpiIntentUrl({
        vpa: upiId.trim(),
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

    // Kept for compatibility with the existing response contract.
    // It now represents the configured merchant UPI ID.
    publicKey: upiId.trim(),

    amountPaise: order.totalPaise,
    currency: "INR",

    prefill: {
      name: order.user.fullName,
      email: order.user.email,
      contact: order.deliveryMobile,
    },

    ...(upiIntentUrl
      ? {
          upiIntentUrl,
          upiVpa: upiId.trim(),
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
): Promise<{ status: "AWAITING_CONFIRMATION" }> {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, userId },
  });
  if (!order)
    throw new AppError(ErrorCode.NOT_FOUND, { message: "Order not found." });

  if (order.paymentStatus === OrderPaymentStatus.PAID) {
    throw new AppError(ErrorCode.PAYMENT_ALREADY_CAPTURED);
  }
  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "This order is no longer awaiting payment.",
    });
  }

  const holdMinutes = await configService.get(ConfigKey.PAYMENT_HOLD_MINUTES);

  await runInTransaction(async (tx) => {
    await tx.payment.updateMany({
      where: {
        orderId: order.id,
        status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] },
      },
      data: {
        status: PaymentStatus.PENDING,
        method: "upi",
        // The UTR is the customer's receipt number. It is what the shopkeeper
        // matches against their UPI app — the whole point of asking for it.
        rawPayload: {
          claimedAt: new Date().toISOString(),
          utr: input.utr ?? null,
        } as never,
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
    {
      orderId: order.id,
      orderNumber: order.orderNumber,
      utr: input.utr ?? null,
    },
    "customer claimed a UPI payment — awaiting store confirmation",
  );

  return { status: "AWAITING_CONFIRMATION" };
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
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: "Order not found.",
    });
  }

  if (order.paymentMethod !== PaymentMethod.ONLINE) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "This order is not an online UPI order.",
    });
  }

  // Idempotent: already paid means there is nothing more to do.
  if (order.paymentStatus === OrderPaymentStatus.PAID) {
    return;
  }

  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "This order is not awaiting payment.",
    });
  }

  if (!Number.isInteger(order.totalPaise) || order.totalPaise <= 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "Invalid order amount.",
    });
  }

  const payment = await prisma.payment.findFirst({
    where: {
      orderId: order.id,
      status: {
        in: [PaymentStatus.CREATED, PaymentStatus.PENDING],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  /*
   * The admin has independently checked the merchant UPI/bank account.
   * Only now is the payment marked captured.
   */
  await runInTransaction(async (tx) => {
    /*
     * Lock the order so two admin clicks cannot confirm it twice.
     */
    const [lockedOrder] = await tx.$queryRaw<
      { id: string; status: OrderStatus; payment_status: OrderPaymentStatus }[]
    >`
      SELECT
        id,
        status,
        payment_status
      FROM orders
      WHERE id = ${order.id}::uuid
      FOR UPDATE
    `;

    if (!lockedOrder) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        message: "Order not found.",
      });
    }

    if (lockedOrder.payment_status === OrderPaymentStatus.PAID) {
      return;
    }

    if (lockedOrder.status !== OrderStatus.PENDING_PAYMENT) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        message: "This order is not awaiting payment.",
      });
    }

    if (payment) {
      await tx.payment.update({
        where: {
          id: payment.id,
        },
        data: {
          status: PaymentStatus.CAPTURED,
          providerPaymentId:
            reference?.trim() ||
            payment.providerPaymentId ||
            `manual_${order.orderNumber}`,
          method: "upi",
          capturedAt: new Date(),
          rawPayload: {
            ...(typeof payment.rawPayload === "object" &&
            payment.rawPayload !== null
              ? payment.rawPayload
              : {}),
            manuallyConfirmed: true,
            confirmedBy: actorUserId,
            confirmedAt: new Date().toISOString(),
            utr: reference?.trim() || null,
          } as never,
        },
      });
    } else {
      await tx.payment.create({
        data: {
          orderId: order.id,
          provider: "manual_upi",
          providerOrderId: null,
          providerPaymentId: reference?.trim() || `manual_${order.orderNumber}`,
          amountPaise: order.totalPaise,
          currency: "INR",
          status: PaymentStatus.CAPTURED,
          method: "upi",
          capturedAt: new Date(),
          rawPayload: {
            manuallyConfirmed: true,
            confirmedBy: actorUserId,
            confirmedAt: new Date().toISOString(),
            utr: reference?.trim() || null,
          } as never,
        },
      });
    }

    await tx.order.update({
      where: {
        id: order.id,
      },
      data: {
        paymentStatus: OrderPaymentStatus.PAID,
      },
    });
  });

  /*
   * Move the order through the normal payment-confirmation path.
   *
   * This:
   * - commits reserved stock
   * - changes PENDING_PAYMENT -> PAYMENT_CONFIRMED
   * - preserves the existing order state machine
   */
  await confirmPaymentAndPlace(order.id, ActorType.ADMIN);

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: "payment.confirm_manual",
      entityType: "Order",
      entityId: order.id,
      after: {
        reference: reference?.trim() || null,
        amountPaise: order.totalPaise,
        paymentMethod: order.paymentMethod,
      },
    },
  });

  log.info(
    {
      orderId: order.id,
      orderNumber: order.orderNumber,
      actorUserId,
      reference: reference ?? null,
      amountPaise: order.totalPaise,
    },
    "UPI payment manually confirmed by admin",
  );
}

/**
 * Admin manually rejects a direct UPI payment after checking the
 * merchant UPI/bank account and determining that the payment was not received.
 *
 * This is deliberately different from "Keep Pending":
 * - Keep Pending does nothing.
 * - This action explicitly marks the payment as failed.
 */
export async function rejectManualUpiPayment(
  orderId: string,
  actorUserId: string,
  reason: string,
): Promise<void> {
  const cleanReason = reason.trim();

  if (!cleanReason) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "A reason is required when marking payment as failed.",
    });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: "Order not found.",
    });
  }

  if (order.paymentMethod !== PaymentMethod.ONLINE) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "This order is not an online UPI order.",
    });
  }

  /*
   * Idempotent: if it is already failed, there is nothing more to do.
   */
  if (order.status === OrderStatus.PAYMENT_FAILED) {
    return;
  }

  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "This order is not awaiting payment.",
    });
  }

  await runInTransaction(async (tx) => {
    /*
     * Lock the order so two admin actions cannot race.
     */
    const [lockedOrder] = await tx.$queryRaw<
      { id: string; status: OrderStatus; payment_status: OrderPaymentStatus }[]
    >`
      SELECT
        id,
        status,
        payment_status
      FROM orders
      WHERE id = ${order.id}::uuid
      FOR UPDATE
    `;

    if (!lockedOrder) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        message: "Order not found.",
      });
    }

    if (lockedOrder.status === OrderStatus.PAYMENT_FAILED) {
      return;
    }

    if (lockedOrder.status !== OrderStatus.PENDING_PAYMENT) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        message: "This order is not awaiting payment.",
      });
    }

    /*
     * Mark any outstanding payment intent as failed.
     */
    await tx.payment.updateMany({
      where: {
        orderId: order.id,
        status: {
          in: [PaymentStatus.CREATED, PaymentStatus.PENDING],
        },
      },
      data: {
        status: PaymentStatus.FAILED,
        failureReason: cleanReason,
        rawPayload: {
          manuallyRejected: true,
          rejectedBy: actorUserId,
          rejectedAt: new Date().toISOString(),
          reason: cleanReason,
        } as never,
      },
    });
  });

  /*
   * Use the normal state-machine path so stock reservation cleanup
   * and other PAYMENT_FAILED side effects still happen.
   */
  await transitionOrder({
    orderId: order.id,
    toStatus: OrderStatus.PAYMENT_FAILED,
    actorType: ActorType.ADMIN,
    reason: cleanReason,
  });

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: "payment.reject_manual",
      entityType: "Order",
      entityId: order.id,
      after: {
        reason: cleanReason,
        amountPaise: order.totalPaise,
        paymentMethod: order.paymentMethod,
      },
    },
  });

  log.info(
    {
      orderId: order.id,
      orderNumber: order.orderNumber,
      actorUserId,
      reason: cleanReason,
      amountPaise: order.totalPaise,
    },
    "UPI payment manually rejected by admin",
  );
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
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: input.orderId },
  });

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
      "PAYMENT AMOUNT MISMATCH — not confirming",
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
        where: {
          orderId: order.id,
          status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] },
        },
        orderBy: { createdAt: "desc" },
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
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
  });
  if (order.status !== OrderStatus.PENDING_PAYMENT) return;

  await prisma.payment.updateMany({
    where: {
      orderId,
      status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] },
    },
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
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, userId },
  });
  if (!order)
    throw new AppError(ErrorCode.NOT_FOUND, { message: "Order not found." });

  // The client's word is a HINT. This asks the provider directly.
  const result = await provider.verify({
    providerOrderId: input.providerOrderId,
    providerPaymentId: input.providerPaymentId,
    signature: input.signature,
  });

  if (!result.verified) {
    log.warn(
      { orderId: order.id, reason: result.failureReason },
      "payment verification failed",
    );
    await settleFailure(
      order.id,
      result.failureReason ?? "verification failed",
      ActorType.SYSTEM,
    );
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

  const updated = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
  });
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
    log.error({ eventId: event.eventId }, "webhook signature invalid");
    throw new AppError(ErrorCode.WEBHOOK_SIGNATURE_INVALID);
  }

  // Replay guard. Providers retry aggressively; the unique index turns every
  // retry into a cheap no-op instead of a double-settlement.
  const existing = await prisma.paymentEvent.findUnique({
    where: {
      provider_eventId: { provider: provider.name, eventId: event.eventId },
    },
  });
  if (existing?.processedAt) {
    log.info(
      { eventId: event.eventId },
      "webhook already processed — ignoring replay",
    );
    return { received: true };
  }

  const record = await prisma.paymentEvent.upsert({
    where: {
      provider_eventId: { provider: provider.name, eventId: event.eventId },
    },
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
          where: {
            provider: provider.name,
            providerOrderId: event.providerOrderId,
          },
        })
      : null;

    if (!payment) {
      log.warn(
        { eventId: event.eventId },
        "webhook for an unknown payment — recorded only",
      );
    } else if (event.status === "CAPTURED" && event.providerPaymentId) {
      await settleCapture({
        orderId: payment.orderId,
        providerPaymentId: event.providerPaymentId,
        providerOrderId: event.providerOrderId,
        amountPaise: event.amountPaise ?? payment.amountPaise,
        method: null,
        actorType: ActorType.PAYMENT_WEBHOOK,
        rawPayload: event.payload,
      });
    } else if (event.status === "FAILED") {
      await settleFailure(
        payment.orderId,
        "payment failed at gateway",
        ActorType.PAYMENT_WEBHOOK,
      );
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
    log.error(
      { err: error, eventId: event.eventId },
      "webhook processing failed",
    );
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
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
  });

  if (order.paymentMethod === PaymentMethod.COD) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message:
        "Cash on Delivery orders are settled in cash — no online refund is possible.",
    });
  }
  if (order.paymentStatus !== OrderPaymentStatus.PAID) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: "This order has not been paid, so there is nothing to refund.",
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
    where: {
      orderId,
      status: {
        in: [
          RefundStatus.PENDING,
          RefundStatus.PROCESSING,
          RefundStatus.COMPLETED,
        ],
      },
    },
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
          ...(result.status === "COMPLETED" ? { completedAt: new Date() } : {}),
        },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REFUNDED },
      });
    });

    if (result.status === "COMPLETED") {
      // Only from a terminal cancelled/rejected state — the state machine
      // rejects it otherwise, which is the intended guard.
      await transitionOrder({
        orderId,
        toStatus: OrderStatus.REFUNDED,
        actorType: ActorType.SYSTEM,
        actorUserId,
        reason,
      }).catch((error) =>
        log.warn({ err: error, orderId }, "refund transition skipped"),
      );
    }

    log.info(
      { orderId, refundId: refund.id, status: result.status },
      "refund issued",
    );
    return { refundId: refund.id, status: result.status as RefundStatus };
  } catch (error) {
    await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: RefundStatus.FAILED,
        failureReason: String(error).slice(0, 300),
      },
    });
    log.error({ err: error, orderId }, "refund failed — needs manual action");
    throw new AppError(ErrorCode.REFUND_FAILED);
  }
}

/** Auto-refund on cancellation or rejection of a paid order. */
export async function refundIfPaid(
  orderId: string,
  reason: string,
): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return;
  if (order.paymentMethod !== PaymentMethod.ONLINE) return;
  if (order.paymentStatus !== OrderPaymentStatus.PAID) return;

  await refundOrder(orderId, reason, order.userId).catch((error) =>
    log.error(
      { err: error, orderId },
      "auto-refund failed — needs manual action",
    ),
  );
}

export const NOTIFICATION_ON_REFUND = NotificationType.REFUND_INITIATED;
