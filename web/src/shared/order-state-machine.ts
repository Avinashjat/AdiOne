/**
 * ⚠️  GENERATED FILE — DO NOT EDIT.
 *
 * Copied from backend/src/shared by `npm run sync:shared`.
 * Edit the canonical file in backend/src/shared and re-run the sync.
 */

/**
 * Order state machine — the single definition of which order transitions are
 * legal, who may perform them, and how internal states are presented to the
 * customer.
 *
 * This lives in `@adione/types` (not in the API) on purpose: the admin panel
 * needs it to decide which action buttons to render, and the mobile app needs
 * the timeline mapping. One definition, three consumers, no drift.
 *
 * The API's `transitionOrder()` service is the ONLY code permitted to write
 * `orders.status`, and it validates against `ALLOWED_TRANSITIONS` below.
 */

import { ActorType, OrderStatus, TERMINAL_ORDER_STATUSES } from './enums';

/* -------------------------------------------------------------------------- */
/* Legal transitions                                                          */
/* -------------------------------------------------------------------------- */

export const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.PENDING_PAYMENT]: [
    OrderStatus.PAYMENT_CONFIRMED,
    OrderStatus.PAYMENT_FAILED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PAYMENT_CONFIRMED]: [OrderStatus.ORDER_PLACED],
  [OrderStatus.ORDER_PLACED]: [
    OrderStatus.STORE_ACCEPTED,
    OrderStatus.REJECTED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.STORE_ACCEPTED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY_FOR_PICKUP, OrderStatus.CANCELLED],
  [OrderStatus.READY_FOR_PICKUP]: [
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  // Terminal states. REFUNDED is reachable only from a cancelled/rejected order
  // once the money is actually back with the customer.
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [OrderStatus.REFUNDED],
  [OrderStatus.REJECTED]: [OrderStatus.REFUNDED],
  [OrderStatus.PAYMENT_FAILED]: [],
  [OrderStatus.REFUNDED]: [],
};

/**
 * Which actors may perform a given transition.
 *
 * Note `OUT_FOR_DELIVERY -> CANCELLED` is ADMIN-only: it is an exception path
 * (customer unreachable, address wrong) that requires a reason and a manual
 * decision about the goods, so it must never be self-service.
 */
export const TRANSITION_ACTORS: Readonly<
  Partial<Record<`${OrderStatus}->${OrderStatus}`, readonly ActorType[]>>
> = {
  'PENDING_PAYMENT->PAYMENT_CONFIRMED': [ActorType.SYSTEM, ActorType.PAYMENT_WEBHOOK],
  'PENDING_PAYMENT->PAYMENT_FAILED': [ActorType.SYSTEM, ActorType.PAYMENT_WEBHOOK],
  'PENDING_PAYMENT->CANCELLED': [ActorType.CUSTOMER, ActorType.SYSTEM],
  'PAYMENT_CONFIRMED->ORDER_PLACED': [ActorType.SYSTEM, ActorType.PAYMENT_WEBHOOK],
  'ORDER_PLACED->STORE_ACCEPTED': [ActorType.ADMIN],
  'ORDER_PLACED->REJECTED': [ActorType.ADMIN],
  'ORDER_PLACED->CANCELLED': [ActorType.CUSTOMER, ActorType.ADMIN],
  'STORE_ACCEPTED->PREPARING': [ActorType.ADMIN],
  'STORE_ACCEPTED->CANCELLED': [ActorType.CUSTOMER, ActorType.ADMIN],
  'PREPARING->READY_FOR_PICKUP': [ActorType.ADMIN],
  'PREPARING->CANCELLED': [ActorType.ADMIN],
  'READY_FOR_PICKUP->OUT_FOR_DELIVERY': [ActorType.ADMIN, ActorType.DELIVERY_AGENT],
  'READY_FOR_PICKUP->CANCELLED': [ActorType.ADMIN],
  'OUT_FOR_DELIVERY->DELIVERED': [ActorType.ADMIN, ActorType.DELIVERY_AGENT],
  'OUT_FOR_DELIVERY->CANCELLED': [ActorType.ADMIN],
  'CANCELLED->REFUNDED': [ActorType.SYSTEM, ActorType.PAYMENT_WEBHOOK],
  'REJECTED->REFUNDED': [ActorType.SYSTEM, ActorType.PAYMENT_WEBHOOK],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

export function canActorTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: ActorType,
): boolean {
  if (!canTransition(from, to)) return false;
  const allowed = TRANSITION_ACTORS[`${from}->${to}`];
  // Absence of an entry means "system only" — fail closed, never open.
  return allowed ? allowed.includes(actor) : actor === ActorType.SYSTEM;
}

/**
 * Statuses an order must have passed through for a given status to be reached.
 * Used to render the completed portion of the tracking timeline.
 */
export const STATUS_PROGRESSION: readonly OrderStatus[] = [
  OrderStatus.ORDER_PLACED,
  OrderStatus.STORE_ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
];

/* -------------------------------------------------------------------------- */
/* Customer-facing timeline (deviation D5)                                     */
/* -------------------------------------------------------------------------- */

/**
 * The mockups show a 5-step timeline. Internally we track 12 states — there is
 * no "Packed" state, for example; PREPARING and READY_FOR_PICKUP both present
 * as "Order Packed".
 *
 * Mapping here, in one place, is what lets us keep a precise internal machine
 * without ever making a client switch on a raw status string.
 */
export const CustomerTimelineStep = {
  PLACED: 'PLACED',
  CONFIRMED: 'CONFIRMED',
  PACKED: 'PACKED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
} as const;
export type CustomerTimelineStep =
  (typeof CustomerTimelineStep)[keyof typeof CustomerTimelineStep];

export const CUSTOMER_TIMELINE_STEPS: readonly CustomerTimelineStep[] = [
  CustomerTimelineStep.PLACED,
  CustomerTimelineStep.CONFIRMED,
  CustomerTimelineStep.PACKED,
  CustomerTimelineStep.OUT_FOR_DELIVERY,
  CustomerTimelineStep.DELIVERED,
];

export const CUSTOMER_TIMELINE_LABELS: Readonly<Record<CustomerTimelineStep, string>> = {
  [CustomerTimelineStep.PLACED]: 'Order Placed',
  [CustomerTimelineStep.CONFIRMED]: 'Order Confirmed',
  [CustomerTimelineStep.PACKED]: 'Order Packed',
  [CustomerTimelineStep.OUT_FOR_DELIVERY]: 'Out for Delivery',
  [CustomerTimelineStep.DELIVERED]: 'Delivered',
};

/**
 * Maps an internal status to its timeline step.
 * `null` means the order is in an exception state and the UI must show a
 * banner (cancelled / rejected / payment failed / awaiting payment) instead of
 * a progress timeline.
 */
export function toCustomerTimelineStep(
  status: OrderStatus,
): CustomerTimelineStep | null {
  switch (status) {
    case OrderStatus.PAYMENT_CONFIRMED:
    case OrderStatus.ORDER_PLACED:
      return CustomerTimelineStep.PLACED;
    case OrderStatus.STORE_ACCEPTED:
      return CustomerTimelineStep.CONFIRMED;
    case OrderStatus.PREPARING:
    case OrderStatus.READY_FOR_PICKUP:
      return CustomerTimelineStep.PACKED;
    case OrderStatus.OUT_FOR_DELIVERY:
      return CustomerTimelineStep.OUT_FOR_DELIVERY;
    case OrderStatus.DELIVERED:
      return CustomerTimelineStep.DELIVERED;
    case OrderStatus.PENDING_PAYMENT:
    case OrderStatus.PAYMENT_FAILED:
    case OrderStatus.CANCELLED:
    case OrderStatus.REJECTED:
    case OrderStatus.REFUNDED:
      return null;
    default: {
      // Exhaustiveness guard — adding a status without handling it fails the build.
      const _never: never = status;
      return _never;
    }
  }
}

/** Short, user-safe label for any internal status (badges, lists). */
export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  [OrderStatus.PENDING_PAYMENT]: 'Awaiting Payment',
  [OrderStatus.PAYMENT_CONFIRMED]: 'Payment Received',
  [OrderStatus.ORDER_PLACED]: 'Order Placed',
  [OrderStatus.STORE_ACCEPTED]: 'Confirmed',
  [OrderStatus.PREPARING]: 'Preparing',
  [OrderStatus.READY_FOR_PICKUP]: 'Packed',
  [OrderStatus.OUT_FOR_DELIVERY]: 'Out for Delivery',
  [OrderStatus.DELIVERED]: 'Delivered',
  [OrderStatus.CANCELLED]: 'Cancelled',
  [OrderStatus.PAYMENT_FAILED]: 'Payment Failed',
  [OrderStatus.REJECTED]: 'Rejected',
  [OrderStatus.REFUNDED]: 'Refunded',
};

/**
 * Coarse bucket used by "My Orders" badges in the mockup
 * (Delivered / Cancelled / Ongoing).
 */
export const OrderBucket = {
  ONGOING: 'ONGOING',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderBucket = (typeof OrderBucket)[keyof typeof OrderBucket];

export function toOrderBucket(status: OrderStatus): OrderBucket {
  if (status === OrderStatus.DELIVERED) return OrderBucket.DELIVERED;
  if (
    status === OrderStatus.CANCELLED ||
    status === OrderStatus.REJECTED ||
    status === OrderStatus.PAYMENT_FAILED ||
    status === OrderStatus.REFUNDED
  ) {
    return OrderBucket.CANCELLED;
  }
  return OrderBucket.ONGOING;
}

/* -------------------------------------------------------------------------- */
/* Admin tabs (mockup section 38)                                             */
/* -------------------------------------------------------------------------- */

export const AdminOrderTab = {
  /**
   * Orders whose payment the store must verify by hand.
   *
   * Only meaningful with direct-UPI payments, where no gateway confirms
   * anything — without this tab those orders would be invisible until they
   * expired.
   */
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  NEW: 'NEW',
  ACCEPTED: 'ACCEPTED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type AdminOrderTab = (typeof AdminOrderTab)[keyof typeof AdminOrderTab];

export const ADMIN_TAB_STATUSES: Readonly<Record<AdminOrderTab, readonly OrderStatus[]>> = {
  [AdminOrderTab.PAYMENT_PENDING]: [OrderStatus.PENDING_PAYMENT],
  [AdminOrderTab.NEW]: [OrderStatus.ORDER_PLACED],
  [AdminOrderTab.ACCEPTED]: [OrderStatus.STORE_ACCEPTED],
  [AdminOrderTab.PREPARING]: [OrderStatus.PREPARING],
  [AdminOrderTab.READY]: [OrderStatus.READY_FOR_PICKUP],
  [AdminOrderTab.OUT_FOR_DELIVERY]: [OrderStatus.OUT_FOR_DELIVERY],
  [AdminOrderTab.COMPLETED]: [OrderStatus.DELIVERED],
  [AdminOrderTab.CANCELLED]: [
    OrderStatus.CANCELLED,
    OrderStatus.REJECTED,
    OrderStatus.PAYMENT_FAILED,
    OrderStatus.REFUNDED,
  ],
};
