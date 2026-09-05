import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeliveryAgentDto } from '@shared';
import { formatPaise } from '@shared/money';
import { api } from '@/lib/api';
import { Button, Card, EmptyState, ErrorBanner, Field, Spinner, inputClass } from '@/components/ui';

interface CashRow {
  agentId: string;
  agentName: string;
  orderCount: number;
  cashPaise: number;
}

export default function DeliveryPage() {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const agents = useQuery({
    queryKey: ['delivery-agents'],
    queryFn: () => api.get<DeliveryAgentDto[]>('/admin/delivery-agents'),
  });

  const cash = useQuery({
    queryKey: ['cash-summary'],
    queryFn: () => api.get<CashRow[]>('/admin/delivery/cash-summary'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['delivery-agents'] });
    void queryClient.invalidateQueries({ queryKey: ['cash-summary'] });
  };

  const create = useMutation({
    mutationFn: () => api.post('/admin/delivery-agents', { name, mobile, vehicleNumber }),
    onSuccess: () => {
      setName('');
      setMobile('');
      setVehicleNumber('');
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const update = useMutation({
    mutationFn: (input: { id: string; patch: Partial<DeliveryAgentDto> }) =>
      api.patch(`/admin/delivery-agents/${input.id}`, input.patch),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/delivery-agents/${id}`),
    onSuccess: invalidate,
    // Deleting is refused while the rider still holds parcels — the message
    // says how many, so the action is obvious.
    onError: (err: Error) => setError(err.message),
  });

  function handleCreate(event: FormEvent): void {
    event.preventDefault();
    create.mutate();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <ErrorBanner message={error} />

        {agents.isLoading ? (
          <Spinner label="Loading delivery partners…" />
        ) : (agents.data?.length ?? 0) === 0 ? (
          <EmptyState title="No delivery partners yet" hint="Add one to start assigning orders." />
        ) : (
          <div className="grid gap-3">
            {(agents.data ?? []).map((agent) => (
              <Card key={agent.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{agent.name}</p>
                    <p className="text-sm text-gray-600">
                      {agent.mobile}
                      {agent.vehicleNumber ? ` · ${agent.vehicleNumber}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {agent.activeOrderCount} order(s) in hand
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={agent.isAvailable ? 'secondary' : 'primary'}
                      onClick={() =>
                        update.mutate({
                          id: agent.id,
                          patch: { isAvailable: !agent.isAvailable },
                        })
                      }
                    >
                      {agent.isAvailable ? 'Mark busy' : 'Mark available'}
                    </Button>
                    <Button
                      variant={agent.isActive ? 'secondary' : 'primary'}
                      onClick={() =>
                        update.mutate({ id: agent.id, patch: { isActive: !agent.isActive } })
                      }
                    >
                      {agent.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button variant="danger" onClick={() => remove.mutate(agent.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        <Card>
          <h2 className="mb-3 font-semibold">Cash to collect (last 24 hours)</h2>
          {(cash.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-500">No cash deliveries in this period.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {(cash.data ?? []).map((row) => (
                <li key={row.agentId} className="flex justify-between py-2 text-sm">
                  <span>
                    {row.agentName}
                    <span className="ml-2 text-gray-500">{row.orderCount} deliveries</span>
                  </span>
                  <span className="font-semibold">{formatPaise(row.cashPaise)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="h-fit">
        <h2 className="mb-3 font-semibold">Add delivery partner</h2>
        <form onSubmit={handleCreate} className="space-y-3">
          <Field label="Name">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Mobile">
            <input
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Vehicle number" hint="Optional">
            <input
              value={vehicleNumber}
              onChange={(event) => setVehicleNumber(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Button type="submit" disabled={create.isPending} className="w-full">
            Add partner
          </Button>
        </form>
      </Card>
    </div>
  );
}
