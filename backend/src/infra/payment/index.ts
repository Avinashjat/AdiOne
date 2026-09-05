/**
 * PaymentProvider port + implementations.
 *
 * IMPORTANT CLARIFICATION (PRD §14.2): the mockup's UPI / Card / PhonePe /
 * GPay / Paytm list is ONE integration, not five. Those are methods inside the
 * PSP's checkout sheet. Building direct wallet integrations would multiply KYC,
 * reconciliation and failure surface for zero customer benefit.
 *
 * No provider SDK is imported outside this folder.
 */

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { UpiIntentProvider } from './upi-intent.provider';
import { env, isProduction } from '../../config/env';
import { moduleLogger } from '../../common/logger';
import { AppError } from '../../common/errors';
import { ErrorCode } from '../../shared';

const log = moduleLogger('payment');

export interface CreateIntentInput {
  orderId: string;
  orderNumber: string;
  amountPaise: number;
  currency: string;
  customer: { name: string | null; email: string | null; contact: string };
}

export interface CreateIntentResult {
  providerOrderId: string;
  publicKey: string;
}

export interface VerifyInput {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface VerifyResult {
  verified: boolean;
  /** Amount the PROVIDER says was captured — cross-checked against the order. */
  amountPaise: number;
  status: 'CAPTURED' | 'AUTHORIZED' | 'FAILED' | 'PENDING';
  method: string | null;
  failureReason?: string | null;
}

export interface WebhookEvent {
  eventId: string;
  type: string;
  signatureValid: boolean;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  amountPaise: number | null;
  status: 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'OTHER';
  payload: unknown;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

export interface PaymentProvider {
  readonly name: string;
  /** Publishable key for the client SDK. Never the secret. */
  publicKey(): string;
  createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;
  /** MUST re-query the provider, not merely check the client's signature. */
  verify(input: VerifyInput): Promise<VerifyResult>;
  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): WebhookEvent;
  refund(input: {
    providerPaymentId: string;
    amountPaise: number;
    reason: string;
  }): Promise<RefundResult>;
  getStatus(providerPaymentId: string): Promise<VerifyResult>;
}

/* -------------------------------------------------------------------------- */
/* Mock — development and tests                                               */
/* -------------------------------------------------------------------------- */

const MOCK_SECRET = 'adione-mock-secret';

/**
 * Deterministic fake gateway. Signatures are real HMACs over the same fields
 * Razorpay uses, so the verification CODE PATH is genuinely exercised in tests
 * rather than stubbed out — which is the point of having a mock at all.
 *
 * Blocked in production by the env validator.
 */
class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  private readonly amounts = new Map<string, number>();

  publicKey(): string {
    return 'mock_public_key';
  }

  static sign(providerOrderId: string, providerPaymentId: string): string {
    return createHmac('sha256', MOCK_SECRET)
      .update(`${providerOrderId}|${providerPaymentId}`)
      .digest('hex');
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    if (isProduction) throw new Error('MockPaymentProvider must not run in production');
    const providerOrderId = `mock_order_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    this.amounts.set(providerOrderId, input.amountPaise);
    return { providerOrderId, publicKey: 'mock_public_key' };
  }

  async verify(input: VerifyInput): Promise<VerifyResult> {
    const expected = MockPaymentProvider.sign(input.providerOrderId, input.providerPaymentId);
    const verified =
      expected.length === input.signature.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature));

    return {
      verified,
      amountPaise: this.amounts.get(input.providerOrderId) ?? 0,
      status: verified ? 'CAPTURED' : 'FAILED',
      method: 'upi',
      failureReason: verified ? null : 'signature mismatch',
    };
  }

  parseWebhook(rawBody: Buffer): WebhookEvent {
    const payload = JSON.parse(rawBody.toString('utf8')) as Record<string, string | number>;
    return {
      eventId: String(payload['event_id'] ?? randomUUID()),
      type: String(payload['type'] ?? 'payment.captured'),
      signatureValid: true,
      providerOrderId: (payload['provider_order_id'] as string) ?? null,
      providerPaymentId: (payload['provider_payment_id'] as string) ?? null,
      amountPaise: (payload['amount_paise'] as number) ?? null,
      status: payload['type'] === 'payment.failed' ? 'FAILED' : 'CAPTURED',
      payload,
    };
  }

  async refund(input: { providerPaymentId: string }): Promise<RefundResult> {
    return {
      providerRefundId: `mock_rfnd_${input.providerPaymentId.slice(-8)}`,
      status: 'COMPLETED',
    };
  }

  async getStatus(providerPaymentId: string): Promise<VerifyResult> {
    return {
      verified: true,
      amountPaise: 0,
      status: providerPaymentId.startsWith('mock_pay_fail') ? 'FAILED' : 'CAPTURED',
      method: 'upi',
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Razorpay                                                                   */
/* -------------------------------------------------------------------------- */

const RAZORPAY_API = 'https://api.razorpay.com/v1';

class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay';

  publicKey(): string {
    return env.RAZORPAY_KEY_ID ?? '';
  }

  private authHeader(): string {
    const token = Buffer.from(
      `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`,
    ).toString('base64');
    return `Basic ${token}`;
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${RAZORPAY_API}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const description =
        (body['error'] as { description?: string } | undefined)?.description ?? 'unknown';
      throw new AppError(ErrorCode.PAYMENT_FAILED, {
        internalMessage: `razorpay ${path} ${response.status}: ${description}`,
      });
    }
    return body as T;
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const order = await this.call<{ id: string }>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amountPaise, // Razorpay works in paise natively.
        currency: input.currency,
        receipt: input.orderNumber,
        notes: { orderId: input.orderId },
      }),
    });
    return { providerOrderId: order.id, publicKey: env.RAZORPAY_KEY_ID ?? '' };
  }

  /**
   * Two independent checks:
   *   1. the HMAC the client returned matches our own secret, and
   *   2. the provider's API confirms the payment is actually captured.
   *
   * The second is what makes a forged client response useless — a signature
   * alone proves the client talked to Razorpay, not that money moved.
   */
  async verify(input: VerifyInput): Promise<VerifyResult> {
    const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET ?? '')
      .update(`${input.providerOrderId}|${input.providerPaymentId}`)
      .digest('hex');

    const signatureValid =
      expected.length === input.signature.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature));

    if (!signatureValid) {
      return { verified: false, amountPaise: 0, status: 'FAILED', method: null,
        failureReason: 'signature mismatch' };
    }

    const payment = await this.call<{
      status: string;
      amount: number;
      method: string;
      error_description?: string;
    }>(`/payments/${input.providerPaymentId}`);

    const captured = payment.status === 'captured';
    return {
      verified: captured,
      amountPaise: payment.amount,
      status: captured ? 'CAPTURED' : payment.status === 'authorized' ? 'AUTHORIZED' : 'FAILED',
      method: payment.method ?? null,
      failureReason: payment.error_description ?? null,
    };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): WebhookEvent {
    const signature = headers['x-razorpay-signature'] ?? '';
    const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET ?? '')
      .update(rawBody)
      .digest('hex');

    const signatureValid =
      expected.length === signature.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

    const payload = JSON.parse(rawBody.toString('utf8')) as {
      event?: string;
      payload?: { payment?: { entity?: Record<string, unknown> } };
    };
    const entity = payload.payload?.payment?.entity ?? {};

    return {
      eventId: headers['x-razorpay-event-id'] ?? String(entity['id'] ?? randomUUID()),
      type: payload.event ?? 'unknown',
      signatureValid,
      providerOrderId: (entity['order_id'] as string) ?? null,
      providerPaymentId: (entity['id'] as string) ?? null,
      amountPaise: (entity['amount'] as number) ?? null,
      status:
        payload.event === 'payment.captured'
          ? 'CAPTURED'
          : payload.event === 'payment.failed'
            ? 'FAILED'
            : payload.event === 'refund.processed'
              ? 'REFUNDED'
              : 'OTHER',
      payload,
    };
  }

  async refund(input: {
    providerPaymentId: string;
    amountPaise: number;
    reason: string;
  }): Promise<RefundResult> {
    const refund = await this.call<{ id: string; status: string }>(
      `/payments/${input.providerPaymentId}/refund`,
      {
        method: 'POST',
        body: JSON.stringify({ amount: input.amountPaise, notes: { reason: input.reason } }),
      },
    );
    return {
      providerRefundId: refund.id,
      status: refund.status === 'processed' ? 'COMPLETED' : 'PROCESSING',
    };
  }

  async getStatus(providerPaymentId: string): Promise<VerifyResult> {
    const payment = await this.call<{ status: string; amount: number; method: string }>(
      `/payments/${providerPaymentId}`,
    );
    return {
      verified: payment.status === 'captured',
      amountPaise: payment.amount,
      status: payment.status === 'captured' ? 'CAPTURED' : 'FAILED',
      method: payment.method ?? null,
    };
  }
}

function createProvider(): PaymentProvider {
  const provider =
    env.PAYMENT_PROVIDER === 'razorpay'
      ? new RazorpayProvider()
      : env.PAYMENT_PROVIDER === 'upi_intent'
        ? new UpiIntentProvider()
        : new MockPaymentProvider();

  if (provider.name === 'upi_intent') {
    log.warn(
      { provider: provider.name, vpa: env.UPI_VPA },
      'UPI intent payments have no automatic confirmation — every online order must be verified by the store in the admin panel',
    );
  } else {
    log.info({ provider: provider.name }, 'payment provider initialised');
  }

  return provider;
}

/** True when payments must be confirmed by a human rather than a gateway. */
export function requiresManualPaymentConfirmation(): boolean {
  return env.PAYMENT_PROVIDER === 'upi_intent';
}

export const payments: PaymentProvider = createProvider();
export { MockPaymentProvider };
export { buildUpiIntentUrl } from './upi-intent.provider';
