/**
 * Express application assembly.
 *
 * Middleware order is deliberate and load-bearing:
 *
 *   1. trust proxy      — so req.ip is the real client, not the load balancer
 *   2. requestLogger    — assign the request id BEFORE anything can fail
 *   3. helmet           — security headers on every response, including errors
 *   4. cors             — reject disallowed origins before doing any work
 *   5. webhook raw body — MUST precede the JSON parser (signatures are computed
 *                          over the exact bytes; a re-serialised body will not
 *                          verify)
 *   6. json / urlencoded / cookies
 *   7. compression
 *   8. routes
 *   9. 404 handler
 *  10. error handler    — last, always
 */

import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';

import { corsOrigins, env, isProduction } from './config/env';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { healthRouter } from './modules/health/health.routes';
import { apiRouter } from './routes';

export function createApp(): Express {
  const app = express();

  // Behind Nginx/Caddy in every deployed environment.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // "/orders" and "/orders/" are the same endpoint.
  app.set('strict routing', false);

  app.use(requestLogger);

  app.use(
    helmet({
      // The API serves JSON and (in dev) uploaded images; it renders no HTML,
      // so a CSP here would only constrain the static image route.
      contentSecurityPolicy: isProduction
        ? { directives: { defaultSrc: ["'none'"], imgSrc: ["'self'", 'data:'] } }
        : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: native mobile app, curl, server-to-server. These
        // are not browser cross-origin requests, so CORS does not apply.
        if (!origin) return callback(null, true);
        if (corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin not allowed: ${origin}`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Idempotency-Key',
        'X-Request-Id',
        'X-Client-Version',
        'X-Client-Platform',
        // Sent by the web and mobile clients to suppress ngrok's HTML
        // interstitial. It is a custom header, so the browser lists it in
        // Access-Control-Request-Headers and the preflight fails with
        // HeaderDisallowedByPreflightResponse unless it is allowed here.
        'ngrok-skip-browser-warning',
      ],
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 86_400,
    }),
  );

  // Payment webhooks are verified against an HMAC of the raw bytes. Parsing to
  // JSON first and re-stringifying changes key order and whitespace, and the
  // signature then never matches. This must stay above express.json().
  app.use('/api/v1/payments/webhook', express.raw({ type: '*/*', limit: '256kb' }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(compression());

  // Local development image storage. In production STORAGE_PROVIDER=s3 and
  // images are served from object storage / CDN instead.
  if (env.STORAGE_PROVIDER === 'local') {
    app.use('/static', express.static('storage', { maxAge: '7d', fallthrough: true }));
  }

  app.use('/health', healthRouter);
  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
