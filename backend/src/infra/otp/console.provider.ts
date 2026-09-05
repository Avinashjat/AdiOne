/**
 * Development OTP provider — prints the code to the server log.
 *
 * The environment validator REFUSES to boot production with this provider,
 * because writing an OTP to a log file is exactly the disclosure the hashed
 * storage elsewhere is designed to prevent.
 */

import { moduleLogger } from '../../common/logger';
import { isProduction } from '../../config/env';
import { maskMobile } from '../../shared/phone';
import type { OtpProvider, SendOtpInput, SendOtpResult } from './types';

const log = moduleLogger('otp:console');

export class ConsoleOtpProvider implements OtpProvider {
  readonly name = 'console';

  async send(input: SendOtpInput): Promise<SendOtpResult> {
    if (isProduction) {
      // Defence in depth: the env validator should have prevented this, but a
      // stub must never silently "deliver" an OTP in production.
      throw new Error('ConsoleOtpProvider must never be used in production');
    }

    log.info(
      { mobile: maskMobile(input.mobile) },
      `DEV OTP for ${maskMobile(input.mobile)} is ${input.code} ` +
        `(valid ${input.expiresInMinutes} min)`,
    );

    return { messageId: `console-${Date.now()}`, devCode: input.code };
  }
}
