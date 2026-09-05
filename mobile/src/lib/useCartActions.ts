/**
 * Cart actions shared by every screen that shows a product.
 *
 * Centralised so the "add / increment / decrement" behaviour — including what
 * happens when the server rejects — is identical on Home, the category grid,
 * search results and the product page.
 */

import { useMemo, useState } from 'react';
import type { CartDto } from '@shared';
import { ApiRequestError } from './api';
import { useCart, useCartMutations } from './queries';

export function useCartActions() {
  const { data: cart } = useCart();
  const { addItem, updateQty, removeItem } = useCartMutations();
  const [error, setError] = useState<string | null>(null);

  /** variantId -> line, so a grid can render quantities without a lookup per card. */
  const linesByVariant = useMemo(() => {
    const map = new Map<string, CartDto['items'][number]>();
    for (const item of cart?.items ?? []) map.set(item.variantId, item);
    return map;
  }, [cart]);

  const busy = addItem.isPending || updateQty.isPending || removeItem.isPending;

  const handle = async (action: Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await action;
    } catch (err) {
      // Server messages are user-safe by contract — "Only 2 left in stock"
      // beats any generic copy the app could invent.
      setError(err instanceof ApiRequestError ? err.message : 'Could not update your cart.');
    }
  };

  return {
    cart,
    error,
    busy,
    clearError: () => setError(null),
    qtyFor: (variantId: string) => linesByVariant.get(variantId)?.qty ?? 0,

    add: (variantId: string, qty = 1) =>
      handle(addItem.mutateAsync({ variantId, qty })),

    increment: (variantId: string) => {
      const line = linesByVariant.get(variantId);
      if (!line) return handle(addItem.mutateAsync({ variantId, qty: 1 }));
      return handle(updateQty.mutateAsync({ cartItemId: line.id, qty: line.qty + 1 }));
    },

    decrement: (variantId: string) => {
      const line = linesByVariant.get(variantId);
      if (!line) return Promise.resolve();
      // Zero means remove — it is what the stepper sends on the last unit.
      return handle(updateQty.mutateAsync({ cartItemId: line.id, qty: line.qty - 1 }));
    },
  };
}
