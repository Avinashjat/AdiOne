/**
 * Inventory (Phase 5).
 *
 * This module owns the only code allowed to move stock. Every movement writes
 * a `stock_ledger` row, so a discrepancy between the shelf and the system is
 * always explainable — the single most common operational failure in real
 * grocery retail (PRD §20 R8).
 *
 * The reservation primitives here are what Phase 8's order transaction calls;
 * they are deliberately written to take a transaction client so they run
 * INSIDE the caller's transaction and inherit its row locks.
 */

import { Prisma } from '@prisma/client';
import { ErrorCode, StockLedgerReason } from '../../shared';
import { AppError } from '../../common/errors';
import { prisma, runInTransaction, type Tx } from '../../infra/db/prisma';
import { moduleLogger } from '../../common/logger';

const log = moduleLogger('inventory');

export interface LockedOffer {
  id: string;
  variantId: string;
  storeId: string;
  pricePaise: number;
  mrpPaise: number;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  isAvailable: boolean;
  maxQtyPerOrder: number;
  allowCod: string;
}

/**
 * Locks the store's offer rows for a set of variants.
 *
 * THIS IS THE FUNCTION THAT PREVENTS OVERSELLING.
 *
 *   - `FOR UPDATE` holds the rows until the surrounding transaction commits,
 *     so two customers buying the last unit serialise instead of both reading
 *     "1 available".
 *   - `ORDER BY variant_id` makes the lock order deterministic. Without it,
 *     two concurrent orders containing the same two items in opposite order
 *     deadlock — the classic version of this bug.
 *
 * Must be called inside `runInTransaction`; locks taken outside one are
 * released immediately and protect nothing.
 */
export async function lockOffersForUpdate(
  tx: Tx,
  storeId: string,
  variantIds: string[],
): Promise<Map<string, LockedOffer>> {
  if (variantIds.length === 0) return new Map();

  const rows = await tx.$queryRaw<
    {
      id: string;
      variant_id: string;
      store_id: string;
      price_paise: number;
      mrp_paise: number;
      stock_qty: number;
      reserved_qty: number;
      is_available: boolean;
      max_qty_per_order: number;
      allow_cod: string;
    }[]
  >`
    SELECT id, variant_id, store_id, price_paise, mrp_paise, stock_qty,
           reserved_qty, is_available, max_qty_per_order, allow_cod
    FROM store_variants
    WHERE store_id = ${storeId}::uuid
      AND variant_id IN (${Prisma.join(variantIds.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY variant_id
    FOR UPDATE`;

  return new Map(
    rows.map((row) => [
      row.variant_id,
      {
        id: row.id,
        variantId: row.variant_id,
        storeId: row.store_id,
        pricePaise: row.price_paise,
        mrpPaise: row.mrp_paise,
        stockQty: row.stock_qty,
        reservedQty: row.reserved_qty,
        availableQty: Math.max(0, row.stock_qty - row.reserved_qty),
        isAvailable: row.is_available,
        maxQtyPerOrder: row.max_qty_per_order,
        allowCod: row.allow_cod,
      },
    ]),
  );
}

async function writeLedger(
  tx: Tx,
  input: {
    storeVariantId: string;
    delta: number;
    reason: StockLedgerReason;
    balanceAfter: number;
    orderId?: string | null;
    actorUserId?: string | null;
    note?: string | null;
  },
): Promise<void> {
  await tx.stockLedger.create({
    data: {
      storeVariantId: input.storeVariantId,
      delta: input.delta,
      reason: input.reason,
      balanceAfter: input.balanceAfter,
      orderId: input.orderId ?? null,
      actorUserId: input.actorUserId ?? null,
      note: input.note ?? null,
    },
  });
}

/**
 * Holds stock for an order awaiting payment.
 *
 * Increments `reserved_qty` rather than decrementing `stock_qty`: the goods are
 * still on the shelf, they are simply spoken for. The DB CHECK
 * `reserved_qty <= stock_qty` is the last line of defence if this is ever
 * called without a lock.
 */
export async function reserveStock(
  tx: Tx,
  items: { storeVariantId: string; variantId: string; qty: number }[],
  orderId: string,
): Promise<void> {
  for (const item of items) {
    const updated = await tx.storeVariant.update({
      where: { id: item.storeVariantId },
      data: { reservedQty: { increment: item.qty } },
      select: { stockQty: true, reservedQty: true },
    });

    await writeLedger(tx, {
      storeVariantId: item.storeVariantId,
      delta: -item.qty,
      reason: StockLedgerReason.ORDER_RESERVE,
      balanceAfter: updated.stockQty - updated.reservedQty,
      orderId,
    });
  }
}

/**
 * Converts a reservation into a sale: the goods have left the shelf.
 * Called when payment is confirmed (online) or at placement (COD).
 */
export async function commitReservation(
  tx: Tx,
  items: { storeVariantId: string; qty: number }[],
  orderId: string,
): Promise<void> {
  for (const item of items) {
    const updated = await tx.storeVariant.update({
      where: { id: item.storeVariantId },
      data: {
        stockQty: { decrement: item.qty },
        reservedQty: { decrement: item.qty },
      },
      select: { stockQty: true, reservedQty: true },
    });

    await writeLedger(tx, {
      storeVariantId: item.storeVariantId,
      delta: -item.qty,
      reason: StockLedgerReason.ORDER_COMMIT,
      balanceAfter: updated.stockQty - updated.reservedQty,
      orderId,
    });
  }
}

/** Returns held stock to sale — payment failed, expired, or order cancelled. */
export async function releaseReservation(
  tx: Tx,
  items: { storeVariantId: string; qty: number }[],
  orderId: string,
  reason: StockLedgerReason = StockLedgerReason.ORDER_RELEASE,
): Promise<void> {
  for (const item of items) {
    const updated = await tx.storeVariant.update({
      where: { id: item.storeVariantId },
      data: { reservedQty: { decrement: item.qty } },
      select: { stockQty: true, reservedQty: true },
    });

    await writeLedger(tx, {
      storeVariantId: item.storeVariantId,
      delta: item.qty,
      reason,
      balanceAfter: updated.stockQty - updated.reservedQty,
      orderId,
    });
  }
}

/** Puts already-sold goods back — an order cancelled after commit. */
export async function restockCommitted(
  tx: Tx,
  items: { storeVariantId: string; qty: number }[],
  orderId: string,
): Promise<void> {
  for (const item of items) {
    const updated = await tx.storeVariant.update({
      where: { id: item.storeVariantId },
      data: { stockQty: { increment: item.qty } },
      select: { stockQty: true, reservedQty: true },
    });

    await writeLedger(tx, {
      storeVariantId: item.storeVariantId,
      delta: item.qty,
      reason: StockLedgerReason.ORDER_CANCEL_RESTOCK,
      balanceAfter: updated.stockQty - updated.reservedQty,
      orderId,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Task 5.1 — admin operations                                                */
/* -------------------------------------------------------------------------- */

export async function setStock(
  storeVariantId: string,
  newStockQty: number,
  actorUserId: string,
  note?: string,
): Promise<void> {
  await runInTransaction(async (tx) => {
    const [current] = await tx.$queryRaw<{ stock_qty: number; reserved_qty: number }[]>`
      SELECT stock_qty, reserved_qty FROM store_variants
      WHERE id = ${storeVariantId}::uuid FOR UPDATE`;

    if (!current) {
      throw new AppError(ErrorCode.NOT_FOUND, { message: 'Inventory record not found.' });
    }

    // Refusing rather than silently clamping: stock below what is already
    // promised to paying customers is a decision for a human, not a default.
    if (newStockQty < current.reserved_qty) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        message: `${current.reserved_qty} unit(s) are reserved for orders in progress. Stock cannot be set below that.`,
      });
    }

    await tx.storeVariant.update({
      where: { id: storeVariantId },
      data: { stockQty: newStockQty },
    });

    await writeLedger(tx, {
      storeVariantId,
      delta: newStockQty - current.stock_qty,
      reason: StockLedgerReason.MANUAL_ADJUST,
      balanceAfter: newStockQty - current.reserved_qty,
      actorUserId,
      note: note ?? 'manual stock adjustment',
    });
  });

  log.info({ storeVariantId, newStockQty, actorUserId }, 'stock adjusted');
}

export async function markOutOfStock(
  storeVariantId: string,
  actorUserId: string,
): Promise<void> {
  // Availability flag rather than zeroing stock: the shelf count may be
  // correct while the item is temporarily unsellable (damaged, misplaced), and
  // conflating the two destroys the audit trail.
  await prisma.storeVariant.update({
    where: { id: storeVariantId },
    data: { isAvailable: false },
  });
  log.info({ storeVariantId, actorUserId }, 'marked out of stock');
}

export async function markAvailable(
  storeVariantId: string,
  actorUserId: string,
): Promise<void> {
  await prisma.storeVariant.update({
    where: { id: storeVariantId },
    data: { isAvailable: true },
  });
  log.info({ storeVariantId, actorUserId }, 'marked available');
}

export async function updatePricing(
  storeVariantId: string,
  input: { pricePaise?: number; mrpPaise?: number },
  actorUserId: string,
): Promise<void> {
  const current = await prisma.storeVariant.findUnique({ where: { id: storeVariantId } });
  if (!current) throw new AppError(ErrorCode.NOT_FOUND, { message: 'Inventory record not found.' });

  const mrpPaise = input.mrpPaise ?? current.mrpPaise;
  const pricePaise = input.pricePaise ?? current.pricePaise;

  // Also enforced by a CHECK constraint; caught here so the admin gets a clear
  // message instead of a database error.
  if (pricePaise > mrpPaise) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: 'Selling price cannot be higher than MRP.',
    });
  }

  await prisma.storeVariant.update({
    where: { id: storeVariantId },
    data: { pricePaise, mrpPaise },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'inventory.price.update',
      entityType: 'StoreVariant',
      entityId: storeVariantId,
      before: { pricePaise: current.pricePaise, mrpPaise: current.mrpPaise },
      after: { pricePaise, mrpPaise },
    },
  });
}

export async function updateLimits(
  storeVariantId: string,
  input: { maxQtyPerOrder?: number; lowStockThreshold?: number },
  _actorUserId: string,
): Promise<void> {
  await prisma.storeVariant.update({
    where: { id: storeVariantId },
    data: {
      ...(input.maxQtyPerOrder !== undefined ? { maxQtyPerOrder: input.maxQtyPerOrder } : {}),
      ...(input.lowStockThreshold !== undefined
        ? { lowStockThreshold: input.lowStockThreshold }
        : {}),
    },
  });
}

export interface LowStockRow {
  storeVariantId: string;
  productName: string;
  variantName: string;
  availableQty: number;
  lowStockThreshold: number;
}

/** Feeds the admin dashboard's low-stock panel. Uses the partial index. */
export async function listLowStock(storeId: string, limit = 50): Promise<LowStockRow[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      product_name: string;
      variant_name: string;
      available_qty: number;
      low_stock_threshold: number;
    }[]
  >`
    SELECT sv.id, p.name AS product_name, v.variant_name,
           (sv.stock_qty - sv.reserved_qty) AS available_qty,
           sv.low_stock_threshold
    FROM store_variants sv
    JOIN product_variants v ON v.id = sv.variant_id
    JOIN products p ON p.id = v.product_id
    WHERE sv.store_id = ${storeId}::uuid
      AND (sv.stock_qty - sv.reserved_qty) <= sv.low_stock_threshold
      AND v.deleted_at IS NULL AND p.deleted_at IS NULL
    ORDER BY (sv.stock_qty - sv.reserved_qty) ASC
    LIMIT ${limit}`;

  return rows.map((row) => ({
    storeVariantId: row.id,
    productName: row.product_name,
    variantName: row.variant_name,
    availableQty: Number(row.available_qty),
    lowStockThreshold: row.low_stock_threshold,
  }));
}

/** Stock movement history for one offer — the "why is this number wrong" view. */
export async function getLedger(storeVariantId: string, limit = 100) {
  return prisma.stockLedger.findMany({
    where: { storeVariantId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { actor: { select: { fullName: true, mobile: true } } },
  });
}
