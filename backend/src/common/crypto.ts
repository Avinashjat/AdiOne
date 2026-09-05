/**
 * Cryptographic helpers.
 *
 * Centralised so that "how do we hash this" is decided once, not per module.
 * Nothing here logs, and nothing here accepts a plaintext secret it does not
 * immediately consume.
 */

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * Cost factor for admin passwords. 12 is ~250 ms on commodity hardware in
 * 2026 — slow enough to make offline cracking expensive, fast enough that a
 * store owner logging in does not notice.
 */
const BCRYPT_ROUNDS = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * SHA-256 hex digest. Used for refresh tokens and idempotency request bodies —
 * values that are already high-entropy, where a slow KDF buys nothing and
 * would only add latency to every request.
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Keyed HMAC-SHA256. Used to hash OTPs before storing them.
 *
 * A bare hash of a 6-digit OTP is trivially reversible — there are only a
 * million possibilities. The server-side pepper means an attacker who reads
 * the cache still cannot recover the code.
 */
export function hmacSha256(input: string, key: string): string {
  return createHmac('sha256', key).update(input, 'utf8').digest('hex');
}

/** Constant-time comparison, for anything an attacker can submit repeatedly. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Cryptographically random opaque token (refresh tokens, webhook nonces). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Cryptographically random numeric code, for OTPs.
 *
 * `crypto.randomInt` rather than `Math.random`: an OTP generated from a
 * predictable PRNG is guessable, which defeats the entire login mechanism.
 */
export function randomNumericCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += randomInt(0, 10);
  return out;
}
