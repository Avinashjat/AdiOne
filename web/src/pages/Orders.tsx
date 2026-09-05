/**
 * The order board (Task 13.3) — the highest-frequency screen in the system.
 *
 * Design constraints taken from how a counter actually works (PRD §5.1):
 *   - accepting an order is ONE click, never behind a menu or a detail page
 *   - a new order announces itself audibly and keeps announcing until seen
 *   - the board polls as well as listening on a socket, because a dropped
 *     socket must never cause a missed order
 *   - oldest-waiting orders are visually loudest
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AdminOrderTab,
  OrderStatus,
  PaymentMethod,
  type AdminOrderSummaryDto,
  type CursorPage,
  type DeliveryAgentDto,
} from '@shared';
import { formatPaise } from '@shared/money';
import { formatRelativeTime } from '@shared/datetime';
import { api } from '@/lib/api';
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  SearchInput,
  Spinner,
  StatusPill,
  Surface,
} from '@/components/ui';
import { useOrderSocket } from '@/lib/socket';

const TABS: { key: AdminOrderTab; label: string }[] = [
  // First, because an unconfirmed payment blocks the customer entirely — they
  // have paid and are waiting on the shop, and every minute is visible to them.
  { key: AdminOrderTab.PAYMENT_PENDING, label: 'Payment to verify' },
  { key: AdminOrderTab.NEW, label: 'New' },
  { key: AdminOrderTab.ACCEPTED, label: 'Accepted' },
  { key: AdminOrderTab.PREPARING, label: 'Preparing' },
  { key: AdminOrderTab.READY, label: 'Ready' },
  { key: AdminOrderTab.OUT_FOR_DELIVERY, label: 'Out for Delivery' },
  { key: AdminOrderTab.COMPLETED, label: 'Completed' },
  { key: AdminOrderTab.CANCELLED, label: 'Cancelled' },
];

/** The one next action for each state — so the primary button is never ambiguous. */
const NEXT_ACTION: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  [OrderStatus.ORDER_PLACED]: { to: OrderStatus.STORE_ACCEPTED, label: 'Accept' },
  [OrderStatus.STORE_ACCEPTED]: { to: OrderStatus.PREPARING, label: 'Start preparing' },
  [OrderStatus.PREPARING]: { to: OrderStatus.READY_FOR_PICKUP, label: 'Mark packed' },
  [OrderStatus.READY_FOR_PICKUP]: { to: OrderStatus.OUT_FOR_DELIVERY, label: 'Send out' },
  [OrderStatus.OUT_FOR_DELIVERY]: { to: OrderStatus.DELIVERED, label: 'Mark delivered' },
};

function useNewOrderChime(): { armed: boolean; announce: () => void; acknowledge: () => void } {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);

  const beep = useCallback(() => {
    // WebAudio rather than an audio file: no asset to ship, and it works
    // without the browser's autoplay heuristics blocking a <audio> element.
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, context.currentTime);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.25);
    } catch {
      // Audio blocked until the user interacts with the page — the visual
      // banner still does its job.
    }
  }, []);

  const announce = useCallback(() => {
    setArmed(true);
    beep();
    // Keeps ringing every 10s: a chime heard once while nobody is at the
    // counter is the same as no chime at all.
    if (timer.current === null) {
      timer.current = window.setInterval(beep, 10_000);
    }
  }, [beep]);

  const acknowledge = useCallback(() => {
    setArmed(false);
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (timer.current !== null) window.clearInterval(timer.current);
  }, []);

  return { armed, announce, acknowledge };
}

export default function OrdersPage() {
  const [tab, setTab] = useState<AdminOrderTab>(AdminOrderTab.NEW);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const chime = useNewOrderChime();

  const query = useQuery({
    queryKey: ['admin-orders', tab, search],
    queryFn: () =>
      api.get<CursorPage<AdminOrderSummaryDto>>(
        `/admin/orders?tab=${tab}&limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
    // Poll regardless of the socket. Realtime is an optimisation; this is the
    // guarantee that an order is never missed.
    refetchInterval: 20_000,
  });

  const agents = useQuery({
    queryKey: ['delivery-agents'],
    queryFn: () => api.get<DeliveryAgentDto[]>('/admin/delivery-agents'),
  });

  useOrderSocket({
    onNewOrder: () => {
      chime.announce();
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
    onStatusChanged: () => void queryClient.invalidateQueries({ queryKey: ['admin-orders'] }),
  });

  const advance = useMutation({
    mutationFn: async (input: {
      orderId: string;
      toStatus: OrderStatus;
      reason?: string;
      deliveryOtp?: string;
    }) => {
      await api.patch(`/admin/orders/${input.orderId}/status`, {
        toStatus: input.toStatus,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.deliveryOtp ? { deliveryOtp: input.deliveryOtp } : {}),
      });
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  /**
   * Confirms a direct-UPI payment.
   *
   * This is the verification step for UPI: no gateway tells us the money
   * arrived, so a human checks the shop's UPI app and says so. Confirming
   * commits the stock reservation and places the order.
   */
  const confirmPayment = useMutation({
    mutationFn: (input: { orderId: string; reference: string | null }) =>
      api.post(`/admin/orders/${input.orderId}/confirm-payment`, {
        reference: input.reference,
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const assign = useMutation({
    mutationFn: (input: { orderId: string; agentId: string }) =>
      api.post(`/admin/orders/${input.orderId}/assign`, { agentId: input.agentId }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-orders'] }),
    onError: (err: Error) => setError(err.message),
  });

  const orders = query.data?.items ?? [];
  const newCount = useMemo(
    () => (tab === AdminOrderTab.NEW ? orders.length : 0),
    [orders.length, tab],
  );

  function handleAdvance(order: AdminOrderSummaryDto): void {
    const action = NEXT_ACTION[order.status];
    if (!action) return;

    if (action.to === OrderStatus.DELIVERED && order.paymentMethod === PaymentMethod.COD) {
      // Proof the parcel reached the customer, and the reason cash handovers
      // are auditable at all.
      const otp = window.prompt('Ask the customer for their 4-digit delivery OTP:');
      if (!otp) return;
      advance.mutate({ orderId: order.id, toStatus: action.to, deliveryOtp: otp });
      return;
    }
    advance.mutate({ orderId: order.id, toStatus: action.to });
  }

  function handleReject(order: AdminOrderSummaryDto): void {
    const reason = window.prompt('Why is this order being rejected? The customer will see this.');
    if (!reason) return;
    advance.mutate({ orderId: order.id, toStatus: OrderStatus.REJECTED, reason });
  }

  return (
    <div className="space-y-4">
      {chime.armed && (
        <button
          onClick={chime.acknowledge}
          className="w-full rounded-xl bg-brand-500 px-4 py-3 text-left font-semibold text-white shadow-lg"
        >
          New order received — tap to silence
        </button>
      )}

      <Surface className="px-2">
        <div className="flex flex-nowrap gap-1 overflow-x-auto">
          {TABS.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`relative min-h-11 whitespace-nowrap px-4 text-sm font-semibold transition ${
                tab === item.key
                  ? 'text-brand-600 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand-500'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {item.label}
              {item.key === AdminOrderTab.NEW && newCount > 0 && (
                <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-600">
                  {newCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </Surface>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search by order number or phone…"
        className="max-w-md"
      />

      <ErrorBanner message={error} />

      {query.isLoading ? (
        <Spinner label="Loading orders…" />
      ) : orders.length === 0 ? (
        <EmptyState title="No orders here" hint="New orders appear automatically." />
      ) : (
        <div className="grid gap-3">
          {orders.map((order) => {
            const action = NEXT_ACTION[order.status];
            // Orders waiting more than 5 minutes for acceptance get a red edge.
            const waitingTooLong =
              order.status === OrderStatus.ORDER_PLACED && order.minutesSincePlaced >= 5;

            return (
              <Card
                key={order.id}
                className={waitingTooLong ? 'border-l-4 border-l-danger-500' : ''}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold">#{order.orderNumber}</span>
                      <StatusPill status={order.status} />
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                          order.paymentMethod === PaymentMethod.COD
                            ? 'bg-warn-50 text-warn-500'
                            : order.paymentStatus === 'PAID'
                              ? 'bg-brand-50 text-brand-600'
                              : 'bg-danger-50 text-danger-500'
                        }`}
                      >
                        {order.paymentMethod === PaymentMethod.COD
                          ? 'COD'
                          : `ONLINE · ${order.paymentStatus}`}
                      </span>
                    </div>

                    <p className="mt-1 text-sm text-gray-700">
                      {order.customerName} · {order.customerMobile}
                    </p>
                    <p className="text-sm text-gray-500">{order.addressSummary}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {order.itemCount} items · {order.distanceKm.toFixed(1)} km ·{' '}
                      {formatRelativeTime(new Date(order.placedAt))}
                      {order.deliveryAgentName && ` · ${order.deliveryAgentName}`}
                    </p>

                    {/* The UTR is what you search for in your UPI app. Shown
                        large and monospaced because it is read digit by digit. */}
                    {order.status === OrderStatus.PENDING_PAYMENT && order.paymentClaim && (
                      <div className="mt-2 rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2">
                        <p className="text-sm font-semibold text-warn-500">
                          Customer says they have paid
                        </p>
                        {order.paymentClaim.utr ? (
                          <p className="mt-0.5 text-sm text-gray-700">
                            UPI reference:{' '}
                            <span className="font-mono font-semibold tracking-wide">
                              {order.paymentClaim.utr}
                            </span>
                          </p>
                        ) : (
                          <p className="mt-0.5 text-sm text-gray-700">
                            No reference given — match by amount and time.
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-gray-500">
                          Check your UPI app for {formatPaise(order.totalPaise)} before confirming.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span className="text-lg font-bold">{formatPaise(order.totalPaise)}</span>

                    <div className="flex flex-wrap justify-end gap-2">
                      {order.status === OrderStatus.READY_FOR_PICKUP && (
                        <select
                          className="min-h-11 rounded-lg border border-gray-300 px-2 text-sm"
                          defaultValue=""
                          onChange={(event) =>
                            event.target.value &&
                            assign.mutate({ orderId: order.id, agentId: event.target.value })
                          }
                        >
                          <option value="" disabled>
                            Assign rider…
                          </option>
                          {(agents.data ?? [])
                            .filter((agent) => agent.isActive)
                            .map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agent.name} ({agent.activeOrderCount})
                              </option>
                            ))}
                        </select>
                      )}

                      {order.status === OrderStatus.PENDING_PAYMENT && (
                        <>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              const reason = window.prompt(
                                'Cancel this order? The customer will see this reason.',
                                'Payment not received',
                              );
                              if (!reason) return;
                              advance.mutate({
                                orderId: order.id,
                                toStatus: OrderStatus.CANCELLED,
                                reason,
                              });
                            }}
                          >
                            Not received
                          </Button>

                          <Button
                            onClick={() =>
                              // Confirmed only after a human has looked at the
                              // bank app — hence the explicit prompt rather
                              // than a one-click action.
                              window.confirm(
                                `Confirm you can see ${formatPaise(order.totalPaise)} in your UPI app for order ${order.orderNumber}?`,
                              ) &&
                              confirmPayment.mutate({
                                orderId: order.id,
                                reference: order.paymentClaim?.utr ?? null,
                              })
                            }
                            disabled={confirmPayment.isPending}
                          >
                            Payment received
                          </Button>
                        </>
                      )}

                      {order.status === OrderStatus.ORDER_PLACED && (
                        <Button variant="secondary" onClick={() => handleReject(order)}>
                          Reject
                        </Button>
                      )}

                      {action && (
                        <Button
                          onClick={() => handleAdvance(order)}
                          disabled={advance.isPending}
                        >
                          {action.label}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
