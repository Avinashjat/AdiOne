import type { Store, StoreHours } from '@prisma/client';
import { ACTIVE_ORDER_STATUSES } from '../../shared';
import { prisma, type DbClient } from '../../infra/db/prisma';

export type StoreWithHours = Store & { hours: StoreHours[] };

/**
 * V1 serves a single store. Selecting "the first store" is the shape
 * multi-store will replace with "the nearest serviceable store", and every
 * caller already passes the resolved store around rather than assuming one
 * exists — so V6 changes this function, not its callers.
 *
 * `isActive` is deliberately NOT a filter here. It is the owner's trading
 * switch, not a soft delete: when it is off the store still has to resolve so
 * the catalog keeps loading, the admin panel can read the row it is about to
 * switch back on, and customers see "we're closed" instead of a dead app.
 * Trading is gated where it belongs — `getStoreOpenState` reports closed and
 * `assertStoreAcceptingOrders` refuses the order.
 */
export async function findStore(client: DbClient = prisma): Promise<StoreWithHours | null> {
  return client.store.findFirst({
    include: { hours: { orderBy: { dayOfWeek: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function findStoreById(
  id: string,
  client: DbClient = prisma,
): Promise<StoreWithHours | null> {
  return client.store.findUnique({
    where: { id },
    include: { hours: { orderBy: { dayOfWeek: 'asc' } } },
  });
}

/** True when the store has an explicit closure recorded for a local date. */
export async function hasClosureOn(
  storeId: string,
  localDate: Date,
  client: DbClient = prisma,
): Promise<boolean> {
  const closure = await client.storeClosure.findUnique({
    where: { storeId_closedOn: { storeId, closedOn: localDate } },
    select: { id: true },
  });
  return closure !== null;
}

/**
 * Orders the store is actively working on. Feeds the workload term in the ETA,
 * so a busy shop quotes a longer time instead of a promise it cannot keep.
 */
export async function countActiveOrders(
  storeId: string,
  client: DbClient = prisma,
): Promise<number> {
  return client.order.count({
    where: { storeId, status: { in: [...ACTIVE_ORDER_STATUSES] } },
  });
}
