/**
 * Per-request context propagated without threading arguments through every
 * function signature.
 *
 * Used for the request id that appears in every log line and every error
 * response, so a customer's "something went wrong" screenshot can be traced to
 * exact server logs.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  userId?: string;
  role?: string;
  ip?: string;
  route?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string {
  return storage.getStore()?.requestId ?? 'no-request-id';
}

/** Attaches values to the active context (e.g. userId once auth has resolved). */
export function setRequestContextValues(values: Partial<RequestContext>): void {
  const current = storage.getStore();
  if (current) Object.assign(current, values);
}
