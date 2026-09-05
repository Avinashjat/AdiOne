/**
 * OTP generation, storage and verification.
 *
 * Security properties, all deliberate:
 *
 *  - The code is generated with `crypto.randomInt`, never `Math.random`. A
 *    six-digit code from a predictable PRNG is guessable, which would defeat
 *    the entire login mechanism.
 *  - Only `HMAC-SHA256(code, OTP_PEPPER)` is stored. A bare hash of a 6-digit
 *    code is trivially reversible — there are only a million possibilities —
 *    so the server-side pepper is what makes cache access useless to an
 *    attacker.
 *  - Attempts are counted server-side and the code is destroyed after
 *    OTP_MAX_ATTEMPTS, so an attacker gets a handful of guesses, not a million.
 *  - Verification uses a constant-time comparison.
 *  - A successful verification consumes the code immediately: an OTP is
 *    single-use even within its validity window.
 */

import { ErrorCode } from '../../shared';
import { AppError } from '../../common/errors';
import { hmacSha256, randomNumericCode, safeEqual } from '../../common/crypto';
import { cache, CacheKey } from '../../infra/cache';
import { env, isProduction } from '../../config/env';
import { otpProvider } from '../../infra/otp';
import { moduleLogger } from '../../common/logger';
import { maskMobile } from '../../shared/phone';

const log = moduleLogger('auth:otp');

export interface SendOtpOutcome {
  resendAfterSeconds: number;
  expiresInSeconds: number;
  /** Non-production only, so local and automated testing can log in. */
  devOtp?: string;
}

function hashCode(code: string): string {
  return hmacSha256(code, env.OTP_PEPPER);
}

/**
 * Generates, stores and sends a code.
 *
 * A resend cooldown is enforced separately from the hourly rate limit: the
 * rate limit stops abuse over time, the cooldown stops a customer
 * double-tapping "Resend" and burning two SMS credits for one login.
 */
export async function sendOtp(mobile: string): Promise<SendOtpOutcome> {
  const cooldownKey = CacheKey.otpResendCooldown(mobile);

  const cooldownRemaining = await cache.ttl(cooldownKey);
  if (cooldownRemaining > 0) {
    throw new AppError(ErrorCode.OTP_RESEND_TOO_SOON, {
      message: `Please wait ${cooldownRemaining} seconds before requesting another OTP.`,
      retryAfterSeconds: cooldownRemaining,
      internalMessage: `resend cooldown active for ${maskMobile(mobile)}`,
    });
  }

  const code = randomNumericCode(env.OTP_LENGTH);

  // Store before sending. If the SMS fails the customer simply retries; if we
  // sent first and the write failed, a delivered code would not verify.
  await cache.set(CacheKey.otp(mobile), hashCode(code), env.OTP_TTL_SECONDS);
  // A fresh code resets the attempt counter — otherwise a previous failed
  // attempt would eat into the new code's allowance.
  await cache.delete(CacheKey.otpAttempts(mobile));

  try {
    const result = await otpProvider.send({
      mobile,
      code,
      expiresInMinutes: Math.ceil(env.OTP_TTL_SECONDS / 60),
    });

    await cache.set(cooldownKey, '1', env.OTP_RESEND_COOLDOWN_SECONDS);

    log.info(
      { mobile: maskMobile(mobile), provider: otpProvider.name, messageId: result.messageId },
      'otp sent',
    );

    return {
      resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
      expiresInSeconds: env.OTP_TTL_SECONDS,
      // Guarded twice: the provider only sets devCode outside production, and
      // this refuses to pass it through in production regardless.
      ...(result.devCode && !isProduction ? { devOtp: result.devCode } : {}),
    };
  } catch (error) {
    // Delivery failed, so the stored code is unreachable — remove it rather
    // than leaving a code nobody has blocking the next request.
    await cache.delete(CacheKey.otp(mobile));
    throw error;
  }
}

/**
 * Verifies a submitted code. Throws on any failure; returns nothing on success.
 * The caller decides what a successful verification means (create user, log in).
 */
export async function verifyOtp(mobile: string, submittedCode: string): Promise<void> {
  const otpKey = CacheKey.otp(mobile);
  const attemptsKey = CacheKey.otpAttempts(mobile);

  const storedHash = await cache.get(otpKey);
  if (!storedHash) {
    // Expired and never-requested are deliberately indistinguishable, so the
    // endpoint cannot be used to probe which numbers have a login in flight.
    throw new AppError(ErrorCode.OTP_EXPIRED, {
      internalMessage: `no active otp for ${maskMobile(mobile)}`,
    });
  }

  const attempts = await cache.increment(attemptsKey, env.OTP_TTL_SECONDS);
  if (attempts > env.OTP_MAX_ATTEMPTS) {
    // Destroy the code: an attacker must request a new one, which the
    // per-mobile rate limit then throttles.
    await cache.delete(otpKey);
    await cache.delete(attemptsKey);
    log.warn({ mobile: maskMobile(mobile), attempts }, 'otp max attempts exceeded');
    throw new AppError(ErrorCode.OTP_MAX_ATTEMPTS, {
      internalMessage: `otp attempts exceeded for ${maskMobile(mobile)}`,
    });
  }

  if (!safeEqual(hashCode(submittedCode), storedHash)) {
    const remaining = Math.max(0, env.OTP_MAX_ATTEMPTS - attempts);
    throw new AppError(ErrorCode.OTP_INVALID, {
      message:
        remaining > 0
          ? `Incorrect OTP. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining.`
          : 'Incorrect OTP.',
      internalMessage: `otp mismatch for ${maskMobile(mobile)} (attempt ${attempts})`,
    });
  }

  // Single use: consume on success so a replayed request cannot log in again.
  await cache.delete(otpKey);
  await cache.delete(attemptsKey);
}

/** Clears OTP state for a number. Used by tests and by admin support actions. */
export async function clearOtpState(mobile: string): Promise<void> {
  await Promise.all([
    cache.delete(CacheKey.otp(mobile)),
    cache.delete(CacheKey.otpAttempts(mobile)),
    cache.delete(CacheKey.otpResendCooldown(mobile)),
  ]);
}
