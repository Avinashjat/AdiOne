/**
 * MSG91 OTP provider.
 *
 * NOTE ON LAUNCH TIMING: sending transactional SMS in India requires a
 * TRAI/DLT-registered sender id and a pre-approved message template. That
 * registration takes days to weeks and is the single most under-estimated
 * blocker in Indian app launches (PRD §19.3). Until it clears, run with
 * OTP_PROVIDER=console — nothing else in the auth flow changes.
 */

import { moduleLogger } from '../../common/logger';
import { env } from '../../config/env';
import { toE164, maskMobile } from '../../shared/phone';
import { AppError } from '../../common/errors';
import { ErrorCode } from '../../shared';
import type { OtpProvider, SendOtpInput, SendOtpResult } from './types';

const log = moduleLogger('otp:msg91');

const MSG91_OTP_ENDPOINT = 'https://control.msg91.com/api/v5/otp';
const REQUEST_TIMEOUT_MS = 10_000;

export class Msg91OtpProvider implements OtpProvider {
  readonly name = 'msg91';

  async send(input: SendOtpInput): Promise<SendOtpResult> {
    const url = new URL(MSG91_OTP_ENDPOINT);
    url.searchParams.set('template_id', env.MSG91_TEMPLATE_ID ?? '');
    url.searchParams.set('mobile', toE164(input.mobile));
    url.searchParams.set('otp', input.code);
    url.searchParams.set('otp_expiry', String(input.expiresInMinutes));
    if (env.MSG91_SENDER_ID) url.searchParams.set('sender', env.MSG91_SENDER_ID);

    // A hung SMS gateway must not hold a request open indefinitely — the
    // customer is staring at a spinner on the OTP screen.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authkey: env.MSG91_AUTH_KEY ?? '',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        type?: string;
        request_id?: string;
        message?: string;
      };

      if (!response.ok || payload.type === 'error') {
        // The provider's message goes to the log; the customer sees only the
        // generic user-safe copy for OTP_SEND_FAILED.
        log.error(
          {
            mobile: maskMobile(input.mobile),
            status: response.status,
            providerMessage: payload.message,
          },
          'msg91 send failed',
        );
        throw new AppError(ErrorCode.OTP_SEND_FAILED, {
          internalMessage: `msg91 ${response.status}: ${payload.message ?? 'unknown error'}`,
        });
      }

      log.info(
        { mobile: maskMobile(input.mobile), requestId: payload.request_id },
        'otp sent',
      );
      return { messageId: payload.request_id ?? null };
    } catch (error) {
      if (AppError.is(error)) throw error;
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new AppError(ErrorCode.OTP_SEND_FAILED, {
        internalMessage: aborted
          ? `msg91 request timed out after ${REQUEST_TIMEOUT_MS}ms`
          : `msg91 request failed: ${String(error)}`,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
