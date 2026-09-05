/**
 * Server-state hooks.
 *
 * Every one of these returns data the SERVER computed — prices, stock, COD
 * eligibility, totals. The app renders them and never derives them.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CartDto,
  CategoryDto,
  CursorPage,
  HomeFeedDto,
  OrderDetailDto,
  OrderSummaryDto,
  ProductDetailDto,
  ProductSummaryDto,
} from '@shared';
import { api } from './api';

export const keys = {
  home: ['home'] as const,
  categories: ['categories'] as const,
  products: (params: string) => ['products', params] as const,
  product: (id: string) => ['product', id] as const,
  search: (term: string) => ['search', term] as const,
  cart: ['cart'] as const,
  orders: ['orders'] as const,
  order: (id: string) => ['order', id] as const,
};

export function useHomeFeed() {
  return useQuery({ queryKey: keys.home, queryFn: () => api.get<HomeFeedDto>('/home') });
}

export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: () => api.get<CategoryDto[]>('/categories?includeChildren=true&withCounts=true'),
    // The category tree changes a few times a month; refetching it on every
    // screen entry would waste a round trip the customer waits for.
    staleTime: 10 * 60_000,
  });
}

export function useProducts(params: { categoryId?: string; inStock?: boolean }) {
  const query = new URLSearchParams({ limit: '30' });
  if (params.categoryId) query.set('categoryId', params.categoryId);
  if (params.inStock) query.set('inStock', 'true');

  return useQuery({
    queryKey: keys.products(query.toString()),
    queryFn: () => api.get<CursorPage<ProductSummaryDto>>(`/products?${query.toString()}`),
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: keys.product(id),
    queryFn: () => api.get<ProductDetailDto>(`/products/${id}`),
  });
}

export function useSearch(term: string) {
  return useQuery({
    queryKey: keys.search(term),
    queryFn: () =>
      api.get<CursorPage<ProductSummaryDto>>(
        `/products/search?q=${encodeURIComponent(term)}&limit=30`,
      ),
    enabled: term.trim().length >= 2,
  });
}

/* -------------------------------------------------------------------------- */
/* Cart                                                                       */
/* -------------------------------------------------------------------------- */

export function useCart() {
  return useQuery({
    queryKey: keys.cart,
    queryFn: () => api.get<CartDto>('/cart'),
    // Always revalidated server-side, so a stale local copy is never used to
    // decide anything.
    staleTime: 0,
  });
}

/**
 * Cart mutations.
 *
 * The server's response REPLACES local state rather than being merged into it.
 * If it corrected a quantity or removed an out-of-stock line, that correction
 * is what the customer must see — a merge would quietly restore the item.
 */
export function useCartMutations() {
  const queryClient = useQueryClient();
  const write = (data: CartDto) => queryClient.setQueryData(keys.cart, data);

  const addItem = useMutation({
    mutationFn: (input: { variantId: string; qty?: number }) =>
      api.post<CartDto>('/cart/items', { variantId: input.variantId, qty: input.qty ?? 1 }),
    onSuccess: write,
  });

  const updateQty = useMutation({
    mutationFn: (input: { cartItemId: string; qty: number }) =>
      api.patch<CartDto>(`/cart/items/${input.cartItemId}`, { qty: input.qty }),
    onSuccess: write,
  });

  const removeItem = useMutation({
    mutationFn: (cartItemId: string) => api.delete<CartDto>(`/cart/items/${cartItemId}`),
    onSuccess: write,
  });

  const applyCoupon = useMutation({
    mutationFn: (code: string) => api.post<CartDto>('/cart/coupon', { code }),
    onSuccess: write,
  });

  return { addItem, updateQty, removeItem, applyCoupon };
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

export function useOrders() {
  return useQuery({
    queryKey: keys.orders,
    queryFn: () => api.get<CursorPage<OrderSummaryDto>>('/orders?limit=20'),
  });
}

export function useOrder(id: string, live: boolean) {
  return useQuery({
    queryKey: keys.order(id),
    queryFn: () => api.get<OrderDetailDto>(`/orders/${id}`),
    // Polling backs up the socket. A tracking screen that silently stops
    // updating is worse than one that costs a request every 30 seconds.
    refetchInterval: live ? 30_000 : false,
  });
}
