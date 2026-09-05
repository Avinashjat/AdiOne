/**
 * Inventory (Task 13.5).
 *
 * The low-stock list is the whole point of this screen: it is the one view
 * that tells the shopkeeper what to reorder before a customer finds out.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CursorPage, ProductSummaryDto } from '@shared';
import { formatPaise } from '@shared/money';
import { api } from '@/lib/api';
import {
  Button,
  EmptyState,
  ErrorBanner,
  Panel,
  Pill,
  Spinner,
  StatCard,
  Td,
  Th,
} from '@/components/ui';

interface LowStockRow {
  storeVariantId: string;
  productName: string;
  variantName: string;
  availableQty: number;
  lowStockThreshold: number;
}

export default function InventoryPage() {
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const lowStock = useQuery({
    queryKey: ['low-stock'],
    queryFn: () => api.get<LowStockRow[]>('/admin/inventory/low-stock'),
  });

  const products = useQuery({
    queryKey: ['admin-products', ''],
    queryFn: () => api.get<CursorPage<ProductSummaryDto>>('/products?limit=100'),
  });

  const setStock = useMutation({
    mutationFn: (input: { storeVariantId: string; stockQty: number }) =>
      api.patch(`/admin/store-variants/${input.storeVariantId}/stock`, {
        stockQty: input.stockQty,
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['low-stock'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-products'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const all = products.data?.items ?? [];
  const rows = lowStock.data ?? [];

  const outOfStock = rows.filter((row) => row.availableQty <= 0).length;
  const inStock = all.filter((product) => (product.defaultVariant?.availableQty ?? 0) > 0).length;

  // Retail value of what is on the shelf right now, at selling price.
  const stockValuePaise = all.reduce((sum, product) => {
    const variant = product.defaultVariant;
    if (!variant) return sum;
    return sum + variant.pricePaise * Math.max(0, variant.availableQty);
  }, 0);

  function promptRestock(row: LowStockRow): void {
    const answer = window.prompt(
      `New stock count for ${row.productName} (${row.variantName})`,
      String(row.availableQty),
    );
    if (answer === null) return;
    const next = Number(answer);
    if (!Number.isFinite(next) || next < 0) {
      setError('Enter a whole number of units, zero or more.');
      return;
    }
    setStock.mutate({ storeVariantId: row.storeVariantId, stockQty: Math.floor(next) });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon="products"
          label="Total Products"
          value={all.length}
          foot="All products in store"
          tone="brand"
        />
        <StatCard
          icon="box"
          label="In Stock"
          value={inStock}
          foot="Products in stock"
          tone="blue"
        />
        <StatCard
          icon="alert"
          label="Low Stock"
          value={Math.max(0, rows.length - outOfStock)}
          foot="Needs attention"
          tone="amber"
        />
        <StatCard
          icon="inventory"
          label="Out of Stock"
          value={outOfStock}
          foot="Out of stock"
          tone="red"
        />
      </div>

      <ErrorBanner message={error} />

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Low Stock Products" className="xl:col-span-2" bodyClass="">
          {lowStock.isLoading ? (
            <Spinner label="Loading stock levels…" />
          ) : rows.length === 0 ? (
            <div className="p-5 pt-0">
              <EmptyState
                title="Nothing is running low"
                hint="Every product is above its low-stock threshold."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="border-y border-gray-200 bg-gray-50">
                  <tr>
                    <Th>Product</Th>
                    <Th>Current Stock</Th>
                    <Th>Min. Stock Level</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Action</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row) => (
                    <tr key={row.storeVariantId} className="transition hover:bg-gray-50/60">
                      <Td>
                        <p className="font-medium text-gray-900">{row.productName}</p>
                        <p className="text-xs text-gray-500">{row.variantName}</p>
                      </Td>
                      <Td>
                        <span
                          className={`font-semibold ${
                            row.availableQty <= 0 ? 'text-danger-500' : 'text-warn-500'
                          }`}
                        >
                          {row.availableQty} units
                        </span>
                      </Td>
                      <Td className="text-gray-600">{row.lowStockThreshold} units</Td>
                      <Td>
                        {row.availableQty <= 0 ? (
                          <Pill tone="red">Out of Stock</Pill>
                        ) : (
                          <Pill tone="amber">Low Stock</Pill>
                        )}
                      </Td>
                      <Td>
                        <div className="flex justify-end">
                          <Button variant="soft" onClick={() => promptRestock(row)}>
                            Update Stock
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Stock Summary">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-gray-600">Total Products</dt>
              <dd className="font-semibold text-gray-900">{all.length}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-600">In Stock</dt>
              <dd className="font-semibold text-gray-900">{inStock}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-600">Low Stock</dt>
              <dd className="font-semibold text-warn-500">
                {Math.max(0, rows.length - outOfStock)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-600">Out of Stock</dt>
              <dd className="font-semibold text-danger-500">{outOfStock}</dd>
            </div>

            <div className="border-t border-gray-200 pt-3">
              <div className="flex items-center justify-between">
                <dt className="text-gray-600">Total Stock Value</dt>
                <dd className="font-semibold text-gray-900">{formatPaise(stockValuePaise)}</dd>
              </div>
              <p className="mt-1.5 text-xs text-gray-500">
                On-hand units at their current selling price, across the first 100 products.
              </p>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
