/**
 * Request validation middleware.
 *
 * Every endpoint that accepts input runs its Zod schema here. The parsed
 * (and coerced) result REPLACES the raw input on the request, so a controller
 * can never accidentally read an unvalidated field — the untrusted version is
 * simply gone by the time the handler runs.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);

      if (schemas.query) {
        // Express 5 makes req.query a getter-only property, so it cannot be
        // reassigned. The parsed result is stashed for `validatedQuery()`.
        const parsed = schemas.query.parse(req.query);
        Object.defineProperty(req, 'validatedQuery', {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      }

      if (schemas.params) req.params = schemas.params.parse(req.params);

      next();
    } catch (error) {
      // ZodError is normalised into a field-level 400 by the error handler.
      next(error);
    }
  };
}

/** Reads the validated query set by `validate({ query })`. */
export function validatedQuery<T>(req: Request): T {
  return (req as Request & { validatedQuery: T }).validatedQuery;
}
