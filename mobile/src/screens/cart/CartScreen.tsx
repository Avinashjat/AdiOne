/**
 * Cart (Task 14.9).
 *
 * The bill is rendered EXACTLY as the server returned it. No line is computed
 * here — not the subtotal, not the delivery fee, not the total. That is the
 * "never trust client totals" rule from the customer's side: there is no
 * arithmetic in this file to disagree with the server.
 *
 * `changes[]` is shown prominently. A customer discovering at the payment
 * screen that their total moved is how trust is lost; being told "Tata Salt
 * went out of stock and was removed" is how it is kept.
 */

import { FlatList, Image, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CartItemDto } from "@shared";
import { formatPaise } from "@shared/money";
import { colors, radius, spacing } from "@shared/theme";
import { useCart } from "@/lib/queries";
import { resolveImageUrl } from "@/lib/api";
import { useCartActions } from "@/lib/useCartActions";
import { useLocation } from "@/lib/store";

import {
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  NoticeStrip,
  Screen,
} from "@/components/ui";
import { QuantityStepper } from "@/components/ProductCard";

export default function CartScreen({
  onCheckout,
  onBrowse,
}: {
  onCheckout: () => void;
  onBrowse: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { data: cart, isLoading, isError, refetch } = useCart();
  const actions = useCartActions();
  const serviceability = useLocation((state) => state.serviceability);

  if (isLoading) return <Loading label="Loading your cart…" />;

  if (isError || !cart) {
    return (
      <ErrorState
        message="We could not load your cart."
        onRetry={() => void refetch()}
      />
    );
  }

  if (cart.items.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty"
        hint="Add items to get started."
        action={{ label: "Browse products", onPress: onBrowse }}
      />
    );
  }

  const outOfArea = serviceability !== null && !serviceability.serviceable;
  const canCheckout = cart.checkoutEnabled && !outOfArea;

  const renderItem = ({ item }: { item: CartItemDto }) => (
    <View style={styles.line}>
      {resolveImageUrl(item.imageUrl) ? (
        <Image
          source={{
            uri: resolveImageUrl(item.imageUrl) ?? undefined,
          }}
          style={styles.thumb}
          resizeMode="contain"
        />
      ) : (
        <View style={[styles.thumb, { backgroundColor: colors.skeleton }]} />
      )}

      <View style={{ flex: 1 }}>
        <AppText variant="body" numberOfLines={2}>
          {item.productName}
        </AppText>
        <AppText variant="caption" color={colors.textSecondary}>
          {item.variantName}
        </AppText>
        <View style={styles.priceRow}>
          <AppText variant="bodyStrong">
            {formatPaise(item.unitPricePaise)}
          </AppText>
          {item.mrpPaise > item.unitPricePaise && (
            <AppText
              variant="caption"
              color={colors.textMuted}
              style={{ textDecorationLine: "line-through" }}
            >
              {formatPaise(item.mrpPaise)}
            </AppText>
          )}
        </View>
      </View>

      <View style={{ alignItems: "flex-end", gap: spacing.sm }}>
        <AppText variant="bodyStrong">
          {formatPaise(item.lineTotalPaise)}
        </AppText>
        <QuantityStepper
          qty={item.qty}
          max={item.maxQtyPerOrder}
          busy={actions.busy}
          onIncrement={() => void actions.increment(item.variantId)}
          onDecrement={() => void actions.decrement(item.variantId)}
        />
      </View>
    </View>
  );

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <AppText variant="h1">Cart</AppText>
        <AppText variant="caption" color={colors.textSecondary}>
          {cart.bill.itemCount} item{cart.bill.itemCount === 1 ? "" : "s"}
        </AppText>
      </View>

      <FlatList
        data={cart.items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: spacing.base, paddingBottom: 240 }}
        ListHeaderComponent={
          <View>
            {/* Server corrections, surfaced rather than swallowed. */}
            {cart.changes.map((change, index) => (
              <NoticeStrip
                key={`${change.type}-${index}`}
                message={change.message}
              />
            ))}
            {actions.error && <NoticeStrip message={actions.error} />}
            {outOfArea && (
              <NoticeStrip
                message="We don't deliver to your current location, so this order can't be placed yet."
                tone="info"
              />
            )}
          </View>
        }
        ListFooterComponent={
          <Card style={{ marginTop: spacing.base }}>
            <AppText variant="h3">Bill Details</AppText>

            <BillRow
              label={`Item Total (${cart.bill.itemCount} items)`}
              value={formatPaise(cart.bill.itemsSubtotalPaise)}
            />
            {cart.bill.couponDiscountPaise > 0 && (
              <BillRow
                label={`Coupon (${cart.bill.couponCode})`}
                value={`− ${formatPaise(cart.bill.couponDiscountPaise)}`}
                tone="good"
              />
            )}
            <BillRow
              label="Delivery Fee"
              value={
                cart.bill.deliveryFeePaise === 0
                  ? "FREE"
                  : formatPaise(cart.bill.deliveryFeePaise)
              }
              tone={cart.bill.deliveryFeePaise === 0 ? "good" : "default"}
            />
            {cart.bill.platformFeePaise > 0 && (
              <BillRow
                label="Platform Fee"
                value={formatPaise(cart.bill.platformFeePaise)}
              />
            )}
            {cart.bill.taxPaise > 0 && (
              // Extracted from the inclusive price, never added on top.
              <BillRow
                label="Taxes (included)"
                value={formatPaise(cart.bill.taxPaise)}
                tone="muted"
              />
            )}

            <View style={styles.totalRow}>
              <AppText variant="h3">To Pay</AppText>
              <AppText variant="h3" color={colors.primary}>
                {formatPaise(cart.bill.totalPaise)}
              </AppText>
            </View>

            {cart.bill.totalSavingsPaise > 0 && (
              <AppText variant="bodyStrong" color={colors.primary}>
                You save {formatPaise(cart.bill.totalSavingsPaise)} on this
                order
              </AppText>
            )}
          </Card>
        }
      />

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + spacing.base }]}
      >
        {!canCheckout && cart.checkoutBlockedReason && (
          <AppText
            variant="body"
            color={colors.warning}
            style={{ marginBottom: spacing.sm, textAlign: "center" }}
          >
            {cart.checkoutBlockedReason}
          </AppText>
        )}
        <Button
          label={`Checkout · ${formatPaise(cart.bill.totalPaise)}`}
          onPress={onCheckout}
          disabled={!canCheckout}
        />
      </View>
    </Screen>
  );
}

function BillRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "muted";
}) {
  const color =
    tone === "good"
      ? colors.primary
      : tone === "muted"
        ? colors.textMuted
        : colors.textPrimary;
  return (
    <View style={styles.billRow}>
      <AppText variant="body" color={colors.textSecondary}>
        {label}
      </AppText>
      <AppText variant="body" color={color}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  line: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  billRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    marginBottom: spacing.xs,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
