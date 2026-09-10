/**
 * Cart (Phase 6).
 *
 * THE CART STORES NO PRICES. `cart_items` holds only (variant, qty); every
 * price, discount and availability figure is resolved live from
 * `store_variants` on each read. There is nowhere for a stale or tampered
 * price to live, which is the "never trust client totals" rule expressed in
 * the data model rather than in a validation check.
 *
 * Revalidation NEVER silently alters the basket. When stock runs out or a
 * price moves, the cart is corrected AND a `changes[]` entry is returned so
 * the app can show "Tata Salt 1 kg is out of stock and was removed" — a
 * customer discovering a changed total at the payment screen is how trust is
 * lost.
 */

import {
  CodPolicy,
  ConfigKey,
  ErrorCode,
  type CartChangeDto,
  type CartDto,
  type CartItemDto,
} from "../../shared";
import { resolveItemCodPolicy } from "../../shared/cod";
import { AppError } from "../../common/errors";
import { prisma, type DbClient } from "../../infra/db/prisma";
import * as configService from "../configuration/configuration.service";
import * as storeService from "../stores/store.service";
import * as pricingService from "../pricing/pricing.service";
import { moduleLogger } from "../../common/logger";

const log = moduleLogger("cart");

/** Everything needed to price and validate a line, in one query. */
const CART_INCLUDE = (storeId: string) =>
  ({
    items: {
      orderBy: { createdAt: "asc" as const },
      include: {
        variant: {
          include: {
            product: {
              include: {
                brand: true,
                category: true,
                images: {
                  orderBy: {
                    displayOrder: "asc",
                  },
                  take: 1,
                },
              },
            },
            storeVariants: { where: { storeId } },
            images: { orderBy: { displayOrder: "asc" as const }, take: 1 },
          },
        },
      },
    },
  }) as const;

async function getOrCreateCart(
  userId: string,
  storeId: string,
  client: DbClient = prisma,
) {
  const existing = await client.cart.findFirst({
    where: { userId, storeId, status: "ACTIVE" },
    include: CART_INCLUDE(storeId),
  });
  if (existing) return existing;

  // The partial unique index `carts_one_active_per_user_store` guarantees a
  // concurrent duplicate create fails rather than producing two live carts.
  return client.cart.create({
    data: { userId, storeId, status: "ACTIVE" },
    include: CART_INCLUDE(storeId),
  });
}

type LoadedCart = Awaited<ReturnType<typeof getOrCreateCart>>;

/* -------------------------------------------------------------------------- */
/* Task 6.2 — revalidation                                                    */
/* -------------------------------------------------------------------------- */

interface RevalidationOutcome {
  items: CartItemDto[];
  changes: CartChangeDto[];
  priceable: pricingService.PriceableItem[];
  codPolicies: { productName: string; resolvedPolicy: CodPolicy }[];
}

async function revalidate(cart: LoadedCart): Promise<RevalidationOutcome> {
  const store = await storeService.getActiveStore();
  const config = await configService.getMany([
    ConfigKey.DEFAULT_COD_POLICY,
    ConfigKey.DEFAULT_MAX_QTY_PER_ORDER,
  ]);

  const items: CartItemDto[] = [];
  const changes: CartChangeDto[] = [];
  const priceable: pricingService.PriceableItem[] = [];
  const codPolicies: { productName: string; resolvedPolicy: CodPolicy }[] = [];

  const removeIds: string[] = [];
  const quantityFixes: { id: string; qty: number }[] = [];

  for (const item of cart.items) {
    const variant = item.variant;
    const product = variant.product;
    const offer = variant.storeVariants[0];
    const productName = `${product.name} ${variant.variantName}`.trim();

    // --- gone entirely -----------------------------------------------------
    const inactive =
      product.status !== "ACTIVE" ||
      product.deletedAt !== null ||
      variant.status !== "ACTIVE" ||
      variant.deletedAt !== null ||
      !offer;

    if (inactive) {
      removeIds.push(item.id);
      changes.push({
        type: "ITEM_REMOVED_UNAVAILABLE",
        variantId: variant.id,
        productName,
        message: `${productName} is no longer available and was removed from your cart.`,
      });
      continue;
    }

    const availableQty = Math.max(0, offer!.stockQty - offer!.reservedQty);
    const inStock = offer!.isAvailable && availableQty > 0;

    if (!inStock) {
      removeIds.push(item.id);
      changes.push({
        type: "ITEM_REMOVED_OUT_OF_STOCK",
        variantId: variant.id,
        productName,
        message: `${productName} is out of stock and was removed from your cart.`,
      });
      continue;
    }

    // --- quantity ----------------------------------------------------------
    const maxQty = offer!.maxQtyPerOrder || config.DEFAULT_MAX_QTY_PER_ORDER;
    let qty = item.qty;

    if (qty > availableQty) {
      changes.push({
        type: "QTY_REDUCED_STOCK",
        variantId: variant.id,
        productName,
        message: `Only ${availableQty} left of ${productName}. Quantity updated.`,
        previousValue: qty,
        newValue: availableQty,
      });
      qty = availableQty;
    }

    if (qty > maxQty) {
      changes.push({
        type: "QTY_REDUCED_LIMIT",
        variantId: variant.id,
        productName,
        message: `You can order up to ${maxQty} of ${productName} per order.`,
        previousValue: qty,
        newValue: maxQty,
      });
      qty = maxQty;
    }

    if (qty !== item.qty) quantityFixes.push({ id: item.id, qty });

    // --- COD ---------------------------------------------------------------
    const categoryChain: CodPolicy[] = [];
    let category = product.category;
    // One level is loaded eagerly; ancestors resolve from the catalog cache
    // when the full chain matters (order creation).
    if (category) categoryChain.push(category.allowCod);

    const resolvedPolicy = resolveItemCodPolicy(
      {
        storeVariant: offer!.allowCod,
        productVariant: variant.allowCod,
        product: product.allowCod,
        categoryChain,
        store: store.allowCod,
      },
      config.DEFAULT_COD_POLICY,
    );
    codPolicies.push({ productName, resolvedPolicy });

    const image =
      variant.imageUrl ??
      variant.images[0]?.url ??
      variant.product.images[0]?.url ??
      null;

    items.push({
      id: item.id,
      variantId: variant.id,
      productId: product.id,
      productName: product.name,
      variantName: variant.variantName,
      brandName: product.brand?.name ?? null,
      imageUrl: image,
      qty,
      mrpPaise: offer!.mrpPaise,
      unitPricePaise: offer!.pricePaise,
      lineTotalPaise: offer!.pricePaise * qty,
      lineDiscountPaise: Math.max(
        0,
        (offer!.mrpPaise - offer!.pricePaise) * qty,
      ),
      inStock: true,
      availableQty,
      maxQtyPerOrder: maxQty,
      allowCod: resolvedPolicy === CodPolicy.ALLOW,
    });

    priceable.push({
      variantId: variant.id,
      qty,
      mrpPaise: offer!.mrpPaise,
      unitPricePaise: offer!.pricePaise,
      taxRateBp: product.taxRateBp,
    });
  }

  // Persist the corrections so the next read is consistent with what the
  // customer was just shown.
  if (removeIds.length > 0) {
    await prisma.cartItem.deleteMany({ where: { id: { in: removeIds } } });
  }
  for (const fix of quantityFixes) {
    await prisma.cartItem.update({
      where: { id: fix.id },
      data: { qty: fix.qty },
    });
  }

  if (changes.length > 0) {
    log.info(
      { cartId: cart.id, changes: changes.length },
      "cart corrected on revalidation",
    );
  }

  return { items, changes, priceable, codPolicies };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface CartContext {
  cartId: string;
  storeId: string;
  priceable: pricingService.PriceableItem[];
  codPolicies: { productName: string; resolvedPolicy: CodPolicy }[];
  couponCode: string | null;
}

/**
 * Builds the full cart payload. Always revalidates — there is no "fast path"
 * that skips it, because a stale cart is exactly what produces a surprise at
 * checkout.
 */
export async function getCart(
  userId: string,
  options: { distanceKm?: number | null } = {},
): Promise<{ dto: CartDto; context: CartContext }> {
  const store = await storeService.getActiveStore();
  const cart = await getOrCreateCart(userId, store.id);
  const { items, changes, priceable, codPolicies } = await revalidate(cart);

  let couponCode = cart.couponCode;
  let coupon: pricingService.ResolvedCoupon | null = null;

  if (couponCode) {
    try {
      coupon = await pricingService.resolveCoupon(couponCode, userId);
    } catch {
      // A coupon that has since expired or hit its limit is dropped with a
      // notice rather than blocking the whole cart from loading.
      await prisma.cart.update({
        where: { id: cart.id },
        data: { couponCode: null },
      });
      changes.push({
        type: "COUPON_REMOVED",
        variantId: null,
        productName: null,
        message: `Coupon ${couponCode} is no longer valid and was removed.`,
      });
      couponCode = null;
    }
  }

  const { bill } = await pricingService.computeBill({
    items: priceable,
    distanceKm: options.distanceKm ?? null,
    coupon,
  });

  const minOrderValuePaise = await configService.get(
    ConfigKey.MIN_ORDER_VALUE_PAISE,
  );
  const shortfallPaise = Math.max(
    0,
    minOrderValuePaise - bill.itemsSubtotalPaise,
  );

  let checkoutBlockedReason: string | null = null;
  if (items.length === 0) checkoutBlockedReason = "Your cart is empty.";
  else if (shortfallPaise > 0) {
    checkoutBlockedReason = `Add ₹${Math.ceil(shortfallPaise / 100)} more to place an order.`;
  }

  return {
    dto: {
      id: cart.id,
      items,
      bill,
      changes,
      checkoutEnabled: checkoutBlockedReason === null,
      checkoutBlockedReason,
      minOrderValuePaise,
      shortfallPaise,
    },
    context: {
      cartId: cart.id,
      storeId: store.id,
      priceable,
      codPolicies,
      couponCode,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Task 6.1 — mutations                                                       */
/* -------------------------------------------------------------------------- */

export async function addItem(
  userId: string,
  variantId: string,
  qty: number,
  distanceKm: number | null = null,
): Promise<CartDto> {
  const store = await storeService.getActiveStore();

  const offer = await prisma.storeVariant.findUnique({
    where: { storeId_variantId: { storeId: store.id, variantId } },
    include: { variant: { include: { product: true } } },
  });

  if (
    !offer ||
    offer.variant.status !== "ACTIVE" ||
    offer.variant.product.status !== "ACTIVE"
  ) {
    throw new AppError(ErrorCode.PRODUCT_UNAVAILABLE);
  }

  const availableQty = Math.max(0, offer.stockQty - offer.reservedQty);
  if (!offer.isAvailable || availableQty <= 0) {
    throw new AppError(ErrorCode.ITEM_OUT_OF_STOCK, {
      message: `${offer.variant.product.name} is out of stock.`,
    });
  }

  const cart = await getOrCreateCart(userId, store.id);
  const existing = cart.items.find((item) => item.variantId === variantId);
  const desiredQty = (existing?.qty ?? 0) + qty;

  const maxQty =
    offer.maxQtyPerOrder ||
    (await configService.get(ConfigKey.DEFAULT_MAX_QTY_PER_ORDER));

  if (desiredQty > maxQty) {
    throw new AppError(ErrorCode.QTY_LIMIT_EXCEEDED, {
      message: `You can order up to ${maxQty} of this item per order.`,
    });
  }
  if (desiredQty > availableQty) {
    throw new AppError(ErrorCode.INSUFFICIENT_STOCK, {
      message: `Only ${availableQty} left in stock.`,
    });
  }

  // The unique (cart_id, variant_id) index makes this a single atomic upsert
  // rather than a read-then-write that two taps could race.
  await prisma.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
    create: { cartId: cart.id, variantId, qty },
    update: { qty: desiredQty },
  });

  return (await getCart(userId, { distanceKm })).dto;
}

export async function updateItemQty(
  userId: string,
  cartItemId: string,
  qty: number,
  distanceKm: number | null = null,
): Promise<CartDto> {
  const store = await storeService.getActiveStore();

  const item = await prisma.cartItem.findFirst({
    where: {
      id: cartItemId,
      cart: { userId, storeId: store.id, status: "ACTIVE" },
    },
    include: {
      variant: { include: { storeVariants: { where: { storeId: store.id } } } },
    },
  });

  // Ownership is checked HERE, in the service — the route guard only proves
  // the caller is logged in, not that this cart item is theirs.
  if (!item)
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: "Cart item not found.",
    });

  if (qty <= 0) {
    await prisma.cartItem.delete({ where: { id: cartItemId } });
    return (await getCart(userId, { distanceKm })).dto;
  }

  const offer = item.variant.storeVariants[0];
  if (!offer) throw new AppError(ErrorCode.PRODUCT_UNAVAILABLE);

  const availableQty = Math.max(0, offer.stockQty - offer.reservedQty);
  if (qty > availableQty) {
    throw new AppError(ErrorCode.INSUFFICIENT_STOCK, {
      message: `Only ${availableQty} left in stock.`,
    });
  }
  if (qty > offer.maxQtyPerOrder) {
    throw new AppError(ErrorCode.QTY_LIMIT_EXCEEDED, {
      message: `You can order up to ${offer.maxQtyPerOrder} of this item per order.`,
    });
  }

  await prisma.cartItem.update({ where: { id: cartItemId }, data: { qty } });
  return (await getCart(userId, { distanceKm })).dto;
}

export async function removeItem(
  userId: string,
  cartItemId: string,
  distanceKm: number | null = null,
): Promise<CartDto> {
  const store = await storeService.getActiveStore();
  const deleted = await prisma.cartItem.deleteMany({
    where: {
      id: cartItemId,
      cart: { userId, storeId: store.id, status: "ACTIVE" },
    },
  });
  if (deleted.count === 0) {
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: "Cart item not found.",
    });
  }
  return (await getCart(userId, { distanceKm })).dto;
}

export async function clearCart(
  userId: string,
  distanceKm: number | null = null,
): Promise<CartDto> {
  const store = await storeService.getActiveStore();
  const cart = await prisma.cart.findFirst({
    where: { userId, storeId: store.id, status: "ACTIVE" },
  });
  if (cart) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await prisma.cart.update({
      where: { id: cart.id },
      data: { couponCode: null },
    });
  }
  return (await getCart(userId, { distanceKm })).dto;
}

export async function applyCoupon(
  userId: string,
  code: string,
  distanceKm: number | null = null,
): Promise<CartDto> {
  // Validate before storing, so an invalid code is rejected immediately rather
  // than silently dropped at the next cart read.
  const coupon = await pricingService.resolveCoupon(code, userId);

  const store = await storeService.getActiveStore();
  const cart = await getOrCreateCart(userId, store.id);
  await prisma.cart.update({
    where: { id: cart.id },
    data: { couponCode: coupon.code },
  });

  return (await getCart(userId, { distanceKm })).dto;
}

export async function removeCoupon(
  userId: string,
  distanceKm: number | null = null,
): Promise<CartDto> {
  const store = await storeService.getActiveStore();
  const cart = await prisma.cart.findFirst({
    where: { userId, storeId: store.id, status: "ACTIVE" },
  });
  if (cart)
    await prisma.cart.update({
      where: { id: cart.id },
      data: { couponCode: null },
    });
  return (await getCart(userId, { distanceKm })).dto;
}

/** Marks the cart converted once its order is created. */
export async function markConverted(
  cartId: string,
  client: DbClient = prisma,
): Promise<void> {
  await client.cart.update({
    where: { id: cartId },
    data: { status: "CONVERTED" },
  });
}
