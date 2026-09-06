/**
 * Order tracking (Task 14.11).
 *
 * The timeline comes from the server already mapped to the mockup's five
 * customer steps — the app never switches on a raw order status. That mapping
 * lives in one place (`toCustomerTimelineStep`) precisely so twelve internal
 * states can exist without leaking into the UI.
 *
 * IMPORTANT:
 *
 * PENDING_PAYMENT is an exception state.
 *
 * It must NOT be displayed as if the order is progressing through:
 * Order Placed → Order Confirmed → Order Packed → ...
 *
 * While payment is pending, the customer sees a dedicated payment-pending
 * message instead of the normal delivery timeline.
 *
 * Live updates arrive over the socket, but the screen ALSO polls. A tracking
 * screen that silently stops updating is worse than one costing a request
 * every 30 seconds.
 */

import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, ApiRequestError } from "@/lib/api";
import { OrderStatus, TERMINAL_ORDER_STATUSES } from "@shared";
import { formatPaise } from "@shared/money";
import { formatDateTimeInZone } from "@shared/datetime";
import { colors, radius, spacing } from "@shared/theme";
import { keys, useOrder } from "@/lib/queries";
import { useOrderSocket } from "@/lib/socket";

import {
  AppText,
  Button,
  Card,
  ErrorState,
  Loading,
  NoticeStrip,
  Screen,
  StatusBadge,
} from "@/components/ui";

export default function OrderTrackingScreen({
  orderId,
  onBack,
}: {
  orderId: string;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: order, isLoading, isError, refetch } = useOrder(orderId, true);

  const [cancelError, setCancelError] = useState<string | null>(null);

  const cancelOrder = useMutation({
    mutationFn: (reason: string) =>
      api.post(`/orders/${orderId}/cancel`, { reason }),

    onSuccess: () => {
      setCancelError(null);

      void queryClient.invalidateQueries({
        queryKey: keys.order(orderId),
      });

      void queryClient.invalidateQueries({
        queryKey: keys.orders,
      });

      // Stock goes back on the shelf server-side, so the catalogue is stale.
      void queryClient.invalidateQueries({
        queryKey: ["home"],
      });
    },

    onError: (err: Error) =>
      setCancelError(
        err instanceof ApiRequestError
          ? err.message
          : "Could not cancel this order.",
      ),
  });

  const isLive = order ? !TERMINAL_ORDER_STATUSES.includes(order.status) : true;

  useOrderSocket({
    onStatusChanged: (event) => {
      if (event.orderId === orderId) {
        void queryClient.invalidateQueries({
          queryKey: keys.order(orderId),
        });
      }
    },
  });

  useEffect(() => {
    if (!isLive) {
      void queryClient.invalidateQueries({
        queryKey: keys.orders,
      });
    }
  }, [isLive, queryClient]);

  if (isLoading) {
    return <Loading label="Loading your order…" />;
  }

  if (isError || !order) {
    return (
      <ErrorState
        message="We could not load this order."
        onRetry={() => void refetch()}
      />
    );
  }

  /**
   * PENDING_PAYMENT is NOT a normal order timeline.
   *
   * Do not show:
   *   Order Placed
   *   Order Confirmed
   *   Order Packed
   *
   * as if the order is progressing.
   *
   * Payment must be verified before the store starts preparing the order.
   */
  const paymentPending = order.status === OrderStatus.PENDING_PAYMENT;

  /**
   * Other terminal states remain exception states and do not use the normal
   * progress timeline.
   */
  const exception =
    TERMINAL_ORDER_STATUSES.includes(order.status) &&
    order.status !== OrderStatus.DELIVERED;

  return (
    <Screen>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + spacing.sm,
          },
        ]}
      >
        <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
          <AppText variant="h2">←</AppText>
        </Pressable>

        <AppText variant="h3">Order Tracking</AppText>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.base,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
      >
        <Card
          style={{
            backgroundColor: colors.primarySurface,
          }}
        >
          <View style={styles.summaryRow}>
            <View>
              <AppText variant="caption" color={colors.textSecondary}>
                {paymentPending
                  ? "Payment status"
                  : isLive
                    ? "Estimated delivery"
                    : "Order"}
              </AppText>

              <AppText variant="display" color={colors.primary}>
                {paymentPending
                  ? "Payment Pending"
                  : isLive && order.etaMinutes
                    ? `${order.etaMinutes} mins`
                    : order.statusLabel}
              </AppText>
            </View>

            <View style={{ alignItems: "flex-end" }}>
              <AppText variant="caption" color={colors.textSecondary}>
                Order ID
              </AppText>

              <AppText variant="bodyStrong">#{order.orderNumber}</AppText>
            </View>
          </View>
        </Card>

        {paymentPending && (
          <Card
            style={{
              marginTop: spacing.base,
              backgroundColor: colors.primarySurface,
            }}
          >
            <AppText variant="h3">Payment Pending</AppText>

            <AppText
              variant="body"
              color={colors.textSecondary}
              style={{
                marginTop: spacing.sm,
              }}
            >
              Your order is waiting for payment verification.
            </AppText>

            <AppText
              variant="body"
              color={colors.textSecondary}
              style={{
                marginTop: spacing.sm,
              }}
            >
              The store will confirm your payment before preparing your order.
            </AppText>
          </Card>
        )}

        {!paymentPending && exception && (
          <View
            style={{
              marginTop: spacing.base,
            }}
          >
            {/*
             * Exception states get a banner INSTEAD of a progress timeline —
             * showing "step 2 of 5" on a cancelled order is nonsense.
             */}
            <NoticeStrip
              message={
                order.cancellationReason
                  ? `${order.statusLabel}: ${order.cancellationReason}`
                  : order.statusLabel
              }
            />
          </View>
        )}

        {!paymentPending && !exception && (
          <Card
            style={{
              marginTop: spacing.base,
            }}
          >
            <AppText variant="h3">Order Status</AppText>

            <View
              style={{
                marginTop: spacing.base,
              }}
            >
              {order.timeline.map((entry, index) => {
                const done = entry.status === "COMPLETED";
                const active = entry.status === "IN_PROGRESS";
                const last = index === order.timeline.length - 1;

                return (
                  <View key={entry.step} style={styles.timelineRow}>
                    <View style={{ alignItems: "center" }}>
                      <View
                        style={[
                          styles.timelineDot,
                          (done || active) && {
                            backgroundColor: colors.primary,
                            borderColor: colors.primary,
                          },
                          active && {
                            backgroundColor: colors.surface,
                          },
                        ]}
                      >
                        {done && (
                          <AppText variant="caption" color={colors.onPrimary}>
                            ✓
                          </AppText>
                        )}
                      </View>

                      {!last && (
                        <View
                          style={[
                            styles.timelineLine,
                            done && {
                              backgroundColor: colors.primary,
                            },
                          ]}
                        />
                      )}
                    </View>

                    <View
                      style={{
                        flex: 1,
                        paddingBottom: spacing.lg,
                      }}
                    >
                      <AppText
                        variant="bodyStrong"
                        color={
                          done || active ? colors.textPrimary : colors.textMuted
                        }
                      >
                        {entry.label}
                      </AppText>

                      {entry.at && (
                        <AppText variant="caption" color={colors.textSecondary}>
                          {formatDateTimeInZone(
                            new Date(entry.at),
                            "Asia/Kolkata",
                          )}
                        </AppText>
                      )}

                      {active && (
                        <AppText variant="caption" color={colors.primary}>
                          In progress
                        </AppText>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>
        )}

        {order.deliveryOtp && (
          <Card
            style={{
              marginTop: spacing.base,
              backgroundColor: colors.primarySurface,
            }}
          >
            <AppText variant="bodyStrong">Delivery OTP</AppText>

            <AppText variant="displayLarge" color={colors.primary}>
              {order.deliveryOtp}
            </AppText>

            <AppText variant="caption" color={colors.textSecondary}>
              Share this with the delivery partner when your order arrives.
            </AppText>
          </Card>
        )}

        {order.deliveryAgent && (
          <Card
            style={{
              marginTop: spacing.base,
            }}
          >
            <AppText variant="bodyStrong">{order.deliveryAgent.name}</AppText>

            <AppText variant="body" color={colors.textSecondary}>
              {order.deliveryAgent.mobile}
            </AppText>
          </Card>
        )}

        <Card
          style={{
            marginTop: spacing.base,
          }}
        >
          <AppText variant="h3">Delivery Address</AppText>

          <AppText
            variant="body"
            color={colors.textSecondary}
            style={{
              marginTop: spacing.xs,
            }}
          >
            {order.deliveryAddress.area}
          </AppText>

          <AppText variant="body" color={colors.textSecondary}>
            {order.deliveryAddress.city}, {order.deliveryAddress.state}{" "}
            {order.deliveryAddress.pincode}
          </AppText>
        </Card>

        <Card
          style={{
            marginTop: spacing.base,
          }}
        >
          <View style={styles.summaryRow}>
            <AppText variant="h3">Order Summary</AppText>

            <StatusBadge status={order.status} />
          </View>

          {order.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <AppText variant="body">{item.productName}</AppText>

                <AppText variant="caption" color={colors.textSecondary}>
                  {item.variantName} · Qty {item.qty}
                </AppText>
              </View>

              <AppText variant="body">
                {formatPaise(item.lineTotalPaise)}
              </AppText>
            </View>
          ))}

          <View style={styles.totalRow}>
            <AppText variant="h3">Total</AppText>

            <AppText variant="h3">{formatPaise(order.bill.totalPaise)}</AppText>
          </View>

          <AppText variant="caption" color={colors.textSecondary}>
            Paid by{" "}
            {order.paymentMethod === "COD" ? "Cash on Delivery" : "Online"} ·{" "}
            {order.paymentStatus}
          </AppText>
        </Card>

        {order.canCancel && (
          <Button
            label="Cancel order"
            variant="secondary"
            loading={cancelOrder.isPending}
            onPress={() =>
              Alert.alert("Cancel this order?", "This cannot be undone.", [
                {
                  text: "Keep order",
                  style: "cancel",
                },
                {
                  text: "Cancel order",
                  style: "destructive",
                  // A reason is required by the API and is what the store
                  // sees on its board, so it is sent rather than left blank.
                  onPress: () => cancelOrder.mutate("Cancelled by customer"),
                },
              ])
            }
            style={{
              marginTop: spacing.lg,
            }}
          />
        )}

        {cancelError && (
          <View
            style={{
              marginTop: spacing.md,
            }}
          >
            <NoticeStrip message={cancelError} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },

  back: {
    width: 40,
    height: 40,
    justifyContent: "center",
  },

  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  timelineRow: {
    flexDirection: "row",
    gap: spacing.md,
  },

  timelineDot: {
    width: 24,
    height: 24,
    borderRadius: radius.circle,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },

  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
    minHeight: 28,
  },

  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
