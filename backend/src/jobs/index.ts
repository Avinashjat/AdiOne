/**
 * Background jobs.
 *
 * An in-process scheduler, not a queue: at this volume a queue would be
 * infrastructure to run, monitor and debug for no benefit. Each job is small,
 * idempotent and safe to run concurrently with live traffic — which is what
 * makes extracting them to a worker later a deployment change rather than a
 * rewrite (PRD §18.2).
 */

import {
  ActorType,
  NotificationType,
  OrderStatus,
  PaymentStatus,
} from '../shared';
import { prisma } from '../infra/db/prisma';
import { payments as provider } from '../infra/payment';
import { moduleLogger } from '../common/logger';
import { transitionOrder } from '../modules/orders/order-state.service';
import * as notificationService from '../modules/notifications/notification.service';

const log = moduleLogger('jobs');

const timers: NodeJS.Timeout[] = [];

/**
 * Releases stock held by online orders whose payment never completed.
 *
 * Without this, one abandoned checkout removes an item from sale forever.
 * Uses the partial index on `status = 'PENDING_PAYMENT'`, so the scan stays
 * proportional to unpaid orders rather than to order history.
 */
export async function releaseExpiredReservations(): Promise<number> {
  const expired = await prisma.order.findMany({
    where: {
      status: OrderStatus.PENDING_PAYMENT,
      reservationExpiresAt: { lt: new Date() },
    },
    select: { id: true, orderNumber: true },
    take: 50,
  });

  for (const order of expired) {
    try {
      // The state machine releases the reservation as a side effect, so stock
      // and status can never disagree.
      await transitionOrder({
        orderId: order.id,
        toStatus: OrderStatus.PAYMENT_FAILED,
        actorType: ActorType.SYSTEM,
        reason: 'Payment was not completed in time',
      });
      log.info({ orderId: order.id }, 'released expired reservation');
    } catch (error) {
      log.error({ err: error, orderId: order.id }, 'failed to release reservation');
    }
  }

  return expired.length;
}

/**
 * Third settlement path (PRD §14.4).
 *
 * Covers the case where the customer paid but neither the client callback nor
 * the webhook reached us — the money is with the provider and the order would
 * otherwise sit unpaid.
 */
export async function reconcilePayments(): Promise<number> {
  const stale = await prisma.payment.findMany({
    where: {
      status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] },
      providerPaymentId: { not: null },
      createdAt: { lt: new Date(Date.now() - 15 * 60_000) },
    },
    take: 25,
  });

  let settled = 0;

  for (const payment of stale) {
    try {
      const status = await provider.getStatus(payment.providerPaymentId!);

      if (status.status === 'CAPTURED') {
        // Amount mismatch is treated as fraud and never auto-confirmed.
        if (status.amountPaise !== payment.amountPaise) {
          log.error(
            { paymentId: payment.id, expected: payment.amountPaise, actual: status.amountPaise },
            'reconciliation found an amount mismatch — manual review required',
          );
          continue;
        }

        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.CAPTURED, capturedAt: new Date() },
        });

        await transitionOrder({
          orderId: payment.orderId,
          toStatus: OrderStatus.PAYMENT_CONFIRMED,
          actorType: ActorType.SYSTEM,
          reason: 'Reconciled with payment provider',
        });
        await transitionOrder({
          orderId: payment.orderId,
          toStatus: OrderStatus.ORDER_PLACED,
          actorType: ActorType.SYSTEM,
        });

        settled += 1;
        log.warn({ paymentId: payment.id }, 'payment settled by reconciliation');
      }
    } catch (error) {
      log.error({ err: error, paymentId: payment.id }, 'reconciliation failed');
    }
  }

  return settled;
}

/** Notifies customers waiting on an out-of-stock item that it is back. */
export async function notifyBackInStock(): Promise<number> {
  const subscriptions = await prisma.$queryRaw<
    { id: string; user_id: string; variant_id: string }[]
  >`
    SELECT s.id, s.user_id, s.variant_id
    FROM back_in_stock_subscriptions s
    JOIN store_variants sv ON sv.variant_id = s.variant_id AND sv.store_id = s.store_id
    WHERE s.notified_at IS NULL
      AND sv.is_available
      AND (sv.stock_qty - sv.reserved_qty) > 0
    LIMIT 100`;

  for (const subscription of subscriptions) {
    await notificationService.notify({
      userId: subscription.user_id,
      type: NotificationType.BACK_IN_STOCK,
    });
    await prisma.backInStockSubscription.update({
      where: { id: subscription.id },
      data: { notifiedAt: new Date() },
    });
  }

  return subscriptions.length;
}

/** Housekeeping: expired idempotency keys and old refresh tokens. */
export async function cleanupExpired(): Promise<void> {
  const now = new Date();
  await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } },
  });
}

function schedule(name: string, intervalMs: number, task: () => Promise<unknown>): void {
  const timer = setInterval(() => {
    void task().catch((error) => log.error({ err: error, job: name }, 'job failed'));
  }, intervalMs);
  // Never hold the process open just for a timer.
  timer.unref();
  timers.push(timer);
}

export function startJobs(): void {
  // Reservation release is the most time-sensitive: every minute an expired
  // hold survives is a minute an item is unsellable.
  schedule('release-reservations', 60_000, releaseExpiredReservations);
  schedule('reconcile-payments', 5 * 60_000, reconcilePayments);
  schedule('retry-notifications', 2 * 60_000, () => notificationService.retryPending());
  schedule('back-in-stock', 5 * 60_000, notifyBackInStock);
  schedule('cleanup', 60 * 60_000, cleanupExpired);

  log.info({ jobs: timers.length }, 'background jobs started');
}

export function stopJobs(): void {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
}
