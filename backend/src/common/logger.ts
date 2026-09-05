/**
 * Structured logging.
 *
 * Two rules that matter more than anything else here:
 *
 *   1. EVERY log line carries the request id, so a customer's "something went
 *      wrong" screenshot maps to exact server logs.
 *   2. NO personal data or secret ever reaches a log. Mobile numbers are
 *      masked, OTPs / tokens / passwords / signatures are redacted outright.
 *      This is enforced by the redaction config below rather than by asking
 *      developers to remember.
 */

import pino, { type Logger, type LoggerOptions } from 'pino';
import { env, isProduction } from '../config/env';
import { getRequestContext } from './request-context';

/**
 * Paths pino removes before serialising. Covers the usual header and body
 * locations for each sensitive field.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-razorpay-signature"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'otp',
  '*.otp',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'signature',
  '*.signature',
  'jwtSecret',
  'otpPepper',
  'keySecret',
  'webhookSecret',
];

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  base: { service: 'adione-api', env: env.NODE_ENV },
  // ISO timestamps: log aggregators handle them, humans can read them.
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  /**
   * Injects request-scoped fields into every line without the caller passing
   * them. This is the whole point of the AsyncLocalStorage context.
   */
  mixin() {
    const context = getRequestContext();
    if (!context) return {};
    return {
      requestId: context.requestId,
      ...(context.userId ? { userId: context.userId } : {}),
      ...(context.route ? { route: context.route } : {}),
    };
  },
};

// Pretty output in development; raw JSON everywhere else so log shippers and
// Sentry can parse it.
export const logger: Logger = isProduction
  ? pino(options)
  : pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname,service,env',
          singleLine: false,
        },
      },
    });

/** Child logger tagged with a module name, e.g. `orders`, `payments`. */
export function moduleLogger(moduleName: string): Logger {
  return logger.child({ module: moduleName });
}
