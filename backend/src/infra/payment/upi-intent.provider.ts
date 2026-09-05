/**
 * UPI intent provider — pay directly to the shop's VPA.
 *
 * HOW THIS DIFFERS FROM A PAYMENT GATEWAY, and why the rest of the flow is
 * shaped the way it is:
 *
 * A `upi://pay?...` deep link hands the customer to their own UPI app. The
 * money moves bank-to-bank, straight into the shop's account. There is NO
 * callback, NO webhook and NO API to query — nothing ever tells this server
 * that a payment succeeded.
 *
 * So `verify()` here does NOT verify. It cannot. Trusting the app's claim
 * would mean any customer could tap "I have paid" and receive goods for free.
 * Instead:
 *
 *   1. the customer pays in their UPI app and taps "I have paid",
 *      optionally entering the 12-digit UTR from their receipt;
 *   2. the order waits, with stock still reserved, in a queue the store sees;
 *   3. the STORE checks its own UPI app and confirms — that confirmation is
 *      the only thing that moves the order forward.
 *
 * This is exactly how small merchants operate today, and the manual step is
 * the honest cost of not using a gateway. Switch PAYMENT_PROVIDER=razorpay to
 * get automatic settlement back.
 */

import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { moduleLogger } from '../../common/logger';
import { AppError } from '../../common/errors';
import { ErrorCode } from '../../shared';
import type {
  CreateIntentInput,
  CreateIntentResult,
  PaymentProvider,
  RefundResult,
  VerifyInput,
  VerifyResult,
  WebhookEvent,
} from './index';

const log = moduleLogger('payment:upi');

/**
 * Builds the NPCI-standard UPI intent URL.
 *
 *   pa  payee VPA          tn  transaction note (our order number)
 *   pn  payee name         tr  transaction reference
 *   am  amount in RUPEES   cu  currency
 *
 * `am` is rupees with two decimals, NOT paise — the one place in this codebase
 * where an amount leaves in rupee form, because the UPI spec requires it.
 * Getting this wrong would charge 100x.
 */
export function buildUpiIntentUrl(input: {
  vpa: string;
  payeeName: string;
  amountPaise: number;
  orderNumber: string;
}): string {
  const params = new URLSearchParams({
    pa: input.vpa,
    pn: input.payeeName,
    am: (input.amountPaise / 100).toFixed(2),
    cu: 'INR',
    tn: `AdiOne order ${input.orderNumber}`,
    tr: input.orderNumber,
  });
  return `upi://pay?${params.toString()}`;
}

export class UpiIntentProvider implements PaymentProvider {
  readonly name = 'upi_intent';

  publicKey(): string {
    // The VPA is public by design — it is printed on shop counters.
    return env.UPI_VPA ?? '';
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    if (!env.UPI_VPA) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
        message: 'Online payment is not set up yet. Please choose Cash on Delivery.',
        internalMessage: 'UPI_VPA is not configured',
      });
    }

    // There is no provider-side order, so we mint our own reference. It is
    // what the customer's UTR is later reconciled against.
    const providerOrderId = `upi_${input.orderNumber}_${randomUUID().slice(0, 8)}`;

    log.info(
      { orderNumber: input.orderNumber, amountPaise: input.amountPaise },
      'upi intent created',
    );

    return { providerOrderId, publicKey: env.UPI_VPA };
  }

  /**
   * Always reports unverified. Deliberately.
   *
   * There is nothing to check against — no gateway API, no signature. The
   * store's confirmation in the admin panel is the verification step, and
   * returning `verified: false` here is what forces the flow through it
   * instead of quietly trusting the client.
   */
  async verify(_input: VerifyInput): Promise<VerifyResult> {
    return {
      verified: false,
      amountPaise: 0,
      status: 'PENDING',
      method: 'upi',
      failureReason: 'UPI payments are confirmed by the store, not automatically',
    };
  }

  parseWebhook(): WebhookEvent {
    // No provider sends us webhooks. Anything arriving here is not from a UPI
    // payment and must not be trusted.
    throw new AppError(ErrorCode.WEBHOOK_SIGNATURE_INVALID, {
      internalMessage: 'the UPI intent provider receives no webhooks',
    });
  }

  async refund(): Promise<RefundResult> {
    // Money went bank-to-bank into the shop's account; only the shopkeeper can
    // send it back. Surfaced as an error so it appears in the admin panel as a
    // task rather than silently reporting success.
    throw new AppError(ErrorCode.REFUND_FAILED, {
      message:
        'This payment was made directly by UPI. Please refund the customer from your UPI app and mark the order refunded.',
      internalMessage: 'automatic refunds are impossible for direct UPI transfers',
    });
  }

  async getStatus(): Promise<VerifyResult> {
    return {
      verified: false,
      amountPaise: 0,
      status: 'PENDING',
      method: 'upi',
    };
  }
}
