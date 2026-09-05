/**
 * Category management.
 *
 * The tree is materialised server-side, so this screen only ever sends a
 * parent id and lets the API recompute paths and depths.
 */

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CategoryDto } from '@shared';
import { api } from '@/lib/api';
import {
  Button,
  EmptyState,
  ErrorBanner,
  Field,
  Icon,
  Modal,
  Pill,
  Spinner,
  StatCard,
  TableWrap,
  Td,
  Th,
  Thumb,
  inputClass,
} from '@/components/ui';

function flatten(categories: CategoryDto[]): CategoryDto[] {
  return categories.flatMap((category) => [category, ...flatten(category.children ?? [])]);
}

function AddCategoryModal({
  categories,
  onClose,
  onCreated,
}: {
  categories: CategoryDto[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [nameHi, setNameHi] = useState('');
  const [parentId, setParentId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post('/admin/categories', {
        name: name.trim(),
        ...(nameHi.trim() ? { nameHi: nameHi.trim() } : {}),
        ...(parentId ? { parentId } : {}),
        ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
        displayOrder: Number(displayOrder) || 0,
      }),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    create.mutate();
  }

  return (
    <Modal
      title="Add Category"
      subtitle="Categories decide how customers browse the catalogue."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Save Category'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorBanner message={error} />

        <Field label="Name" required>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
            placeholder="Staples"
            required
          />
        </Field>

        <Field label="Hindi name" hint="Optional. Shown when the app is switched to Hindi.">
          <input
            value={nameHi}
            onChange={(event) => setNameHi(event.target.value)}
            className={inputClass}
            placeholder="किराना"
          />
        </Field>

        <Field label="Parent category" hint="Leave empty to create a top-level category.">
          <select
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
            className={inputClass}
          >
            <option value="">None — top level</option>
            {flatten(categories).map((category) => (
              <option key={category.id} value={category.id}>
                {' '.repeat(category.depth * 3)}
                {category.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Image URL" hint="Optional. Paste the address of an already-hosted image.">
          <input
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            className={inputClass}
            placeholder="https://…"
            type="url"
          />
        </Field>

        <Field label="Display order" hint="Lower numbers appear first.">
          <input
            type="number"
            min="0"
            value={displayOrder}
            onChange={(event) => setDisplayOrder(event.target.value)}
            className={inputClass}
          />
        </Field>
      </form>
    </Modal>
  );
}

export default function CategoriesPage() {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<CategoryDto[]>('/categories?includeChildren=true'),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['categories'] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/categories/${id}`),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const tree = categories.data ?? [];
  const rows = flatten(tree);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button onClick={() => setAdding(true)}>
          <Icon name="plus" className="h-4 w-4" />
          Add Category
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard icon="categories" label="Total Categories" value={rows.length} tone="brand" />
        <StatCard icon="dashboard" label="Top Level" value={tree.length} tone="blue" />
        <StatCard
          icon="products"
          label="Products Categorised"
          value={rows.reduce((sum, category) => sum + (category.productCount ?? 0), 0)}
          tone="purple"
        />
      </div>

      <ErrorBanner message={error} />

      {categories.isLoading ? (
        <Spinner label="Loading categories…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No categories yet" hint="Add one before creating products." />
      ) : (
        <TableWrap>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <Th>Category</Th>
                <Th>Level</Th>
                <Th>Products</Th>
                <Th>Order</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((category) => (
                <tr key={category.id} className="transition hover:bg-gray-50/60">
                  <Td>
                    <div
                      className="flex items-center gap-3"
                      style={{ paddingLeft: `${category.depth * 20}px` }}
                    >
                      <Thumb src={category.imageUrl} alt={category.name} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-900">{category.name}</p>
                        <p className="truncate text-xs text-gray-500">{category.slug}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    {category.depth === 0 ? (
                      <Pill tone="brand">Top level</Pill>
                    ) : (
                      <Pill tone="gray">Level {category.depth + 1}</Pill>
                    )}
                  </Td>
                  <Td className="text-gray-600">{category.productCount ?? '—'}</Td>
                  <Td className="text-gray-600">{category.displayOrder}</Td>
                  <Td>
                    <div className="flex justify-end">
                      <button
                        aria-label={`Delete ${category.name}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete “${category.name}”? Categories with products or sub-categories cannot be deleted.`,
                            )
                          ) {
                            remove.mutate(category.id);
                          }
                        }}
                        className="rounded-lg p-2 text-gray-400 transition hover:bg-danger-50 hover:text-danger-500"
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      {adding && (
        <AddCategoryModal
          categories={tree}
          onClose={() => setAdding(false)}
          onCreated={invalidate}
        />
      )}
    </div>
  );
}
