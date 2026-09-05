/**
 * Configuration data access. No business rules here — the service decides
 * precedence, defaults and caching.
 */

import type { Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../../infra/db/prisma';

export interface ConfigRow {
  key: string;
  storeId: string | null;
  value: Prisma.JsonValue;
  isPublic: boolean;
  description: string | null;
  updatedAt: Date;
}

/**
 * Loads every global row plus every override for one store, in a single query.
 *
 * The whole table is a few dozen rows, so reading all of it once and caching
 * the result is cheaper and far simpler than per-key lookups scattered through
 * request handling.
 */
export async function findAllForStore(
  storeId: string | null,
  client: DbClient = prisma,
): Promise<ConfigRow[]> {
  return client.configuration.findMany({
    where: storeId ? { OR: [{ storeId: null }, { storeId }] } : { storeId: null },
    select: {
      key: true,
      storeId: true,
      value: true,
      isPublic: true,
      description: true,
      updatedAt: true,
    },
    // Global rows first so the store override, read later, wins.
    orderBy: { storeId: 'asc' },
  });
}

const ROW_SELECT = {
  key: true,
  storeId: true,
  value: true,
  isPublic: true,
  description: true,
  updatedAt: true,
} as const;

export async function findOne(
  key: string,
  storeId: string | null,
  client: DbClient = prisma,
): Promise<ConfigRow | null> {
  // findFirst rather than findUnique: Prisma cannot express a compound unique
  // lookup with a NULL member (see the null_scope_unique migration).
  return client.configuration.findFirst({
    where: { key, storeId },
    select: ROW_SELECT,
  });
}

/**
 * Upsert by (key, storeId), handling the global scope where storeId is NULL.
 *
 * Implemented as find-then-write because Prisma's `upsert` requires a unique
 * `where` and refuses a NULL inside a compound unique. Uniqueness itself is
 * still guaranteed by the database:
 *   - composite UNIQUE (key, store_id)                    for store overrides
 *   - partial UNIQUE (key) WHERE store_id IS NULL         for globals
 * so a concurrent double-create fails on the constraint rather than producing
 * two rows.
 */
export async function upsert(
  input: {
    key: string;
    storeId: string | null;
    value: Prisma.InputJsonValue;
    description?: string | null;
    isPublic?: boolean;
    updatedByUserId?: string | null;
    /** When false, an existing row keeps its value and only metadata refreshes. */
    overwriteValue?: boolean;
  },
  client: DbClient = prisma,
): Promise<ConfigRow> {
  const existing = await client.configuration.findFirst({
    where: { key: input.key, storeId: input.storeId },
    select: { key: true },
  });

  if (existing) {
    // updateMany, not update: `update` also needs a unique `where`, which a
    // NULL storeId cannot satisfy. The partial unique index guarantees this
    // matches at most one row.
    await client.configuration.updateMany({
      where: { key: input.key, storeId: input.storeId },
      data: {
        ...(input.overwriteValue === false ? {} : { value: input.value }),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
        updatedByUserId: input.updatedByUserId ?? null,
      },
    });

    const updated = await client.configuration.findFirst({
      where: { key: input.key, storeId: input.storeId },
      select: ROW_SELECT,
    });
    // Non-null: we just confirmed the row exists and nothing deletes config
    // rows concurrently.
    return updated as ConfigRow;
  }

  return client.configuration.create({
    data: {
      key: input.key,
      storeId: input.storeId,
      value: input.value,
      description: input.description ?? null,
      isPublic: input.isPublic ?? false,
      updatedByUserId: input.updatedByUserId ?? null,
    },
    select: ROW_SELECT,
  });
}

export async function remove(
  key: string,
  storeId: string | null,
  client: DbClient = prisma,
): Promise<void> {
  await client.configuration.deleteMany({ where: { key, storeId } });
}
