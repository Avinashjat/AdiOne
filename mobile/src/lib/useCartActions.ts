/**
 * Cart actions shared by every screen that shows a product.
 */

import { useMemo, useState } from "react";
import type { CartDto } from "@shared";
import { ApiRequestError } from "./api";
import { useCart, useCartMutations } from "./queries";
import { useLocation } from "@/lib/store";

export function useCartActions() {
  // IMPORTANT: pass the current serviceability distance
  // so cart pricing includes the correct delivery fee.
  const serviceability = useLocation(
    (state) => state.serviceability,
  );

  const distanceKm = serviceability?.distanceKm ?? null;

  const { data: cart } = useCart(distanceKm);

  const { addItem, updateQty, removeItem } = useCartMutations();

  const [error, setError] = useState<string | null>(null);

  const linesByVariant = useMemo(() => {
    const map = new Map<string, CartDto["items"][number]>();

    for (const item of cart?.items ?? []) {
      map.set(item.variantId, item);
    }

    return map;
  }, [cart]);

  const busy =
    addItem.isPending ||
    updateQty.isPending ||
    removeItem.isPending;

  const handle = async (action: Promise<unknown>): Promise<void> => {
    setError(null);

    try {
      await action;
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Could not update your cart.",
      );
    }
  };

  const add = (variantId: string, qty = 1) =>
    handle(
      addItem.mutateAsync({
        variantId,
        qty,
        distanceKm,
      }),
    );

  const increment = (variantId: string) => {
    const line = linesByVariant.get(variantId);

    if (!line) {
      return handle(
        addItem.mutateAsync({
          variantId,
          qty: 1,
          distanceKm,
        }),
      );
    }

    return handle(
      updateQty.mutateAsync({
        cartItemId: line.id,
        qty: line.qty + 1,
        distanceKm,
      }),
    );
  };

  const decrement = (variantId: string) => {
    const line = linesByVariant.get(variantId);

    if (!line) {
      return Promise.resolve();
    }

    return handle(
      updateQty.mutateAsync({
        cartItemId: line.id,
        qty: line.qty - 1,
        distanceKm,
      }),
    );
  };

  const remove = (variantId: string) => {
    const line = linesByVariant.get(variantId);

    if (!line) {
      return Promise.resolve();
    }

    return handle(
      removeItem.mutateAsync({
        cartItemId: line.id,
        distanceKm,
      }),
    );
  };

  const clear = async (): Promise<void> => {
    const items = cart?.items ?? [];

    if (items.length === 0) {
      return;
    }

    setError(null);

    try {
      for (const item of items) {
        await removeItem.mutateAsync({
          cartItemId: item.id,
          distanceKm,
        });
      }
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Could not clear your cart.",
      );
    }
  };

  return {
    cart,
    error,
    busy,

    clearError: () => setError(null),

    qtyFor: (variantId: string) =>
      linesByVariant.get(variantId)?.qty ?? 0,

    add,
    increment,
    decrement,
    remove,
    clear,
  };
}