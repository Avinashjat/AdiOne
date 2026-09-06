/**
 * Checkout (Task 14.10) — Address → Payment → Review → Place Order.
 *
 * THE MOST SAFETY-CRITICAL SCREEN IN THE APP. Four properties matter more than
 * anything visual:
 *
 *   1. The bill comes from `POST /checkout/quote`, which runs the SAME pricing
 *      engine as order creation. The app never computes a total.
 *   2. ONE Idempotency-Key is generated per checkout attempt and reused across
 *      every retry of that attempt, so a lost response can never become a
 *      second order.
 *   3. The button disables on first press and stays disabled until the request
 *      settles — a double-tap on a slow connection is the norm, not the edge.
 *   4. `expectedTotalPaise` is sent purely as a safety check. If prices moved
 *      while the customer was reviewing, the server rejects with PRICE_CHANGED
 *      and they re-confirm rather than being silently charged more.
 */

import { useCallback, useEffect, useState } from "react";
import * as Crypto from "expo-crypto";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ErrorCode,
  PaymentMethod,
  type AddressDto,
  type CheckoutQuoteResponse,
  type OrderDetailDto,
} from "@shared";

import { formatPaise } from "@shared/money";
import { formatEtaRange } from "@shared/distance";
import { colors, radius, spacing } from "@shared/theme";

import { api, ApiRequestError } from "@/lib/api";
import { keys } from "@/lib/queries";

import {
  AppText,
  Button,
  Card,
  ErrorState,
  Loading,
  NoticeStrip,
  Screen,
} from "@/components/ui";

type Step = "address" | "payment" | "review";

const STEPS: { key: Step; label: string }[] = [
  { key: "address", label: "Address" },
  { key: "payment", label: "Payment" },
  { key: "review", label: "Review" },
];

export default function CheckoutScreen({
  onBack,
  onPlaced,
  onAddAddress,
}: {
  onBack: () => void;
  onPlaced: (order: OrderDetailDto, requiresPayment: boolean) => void;
  onAddAddress: () => void;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("address");
  const [addressId, setAddressId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    PaymentMethod.COD,
  );

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * One key per checkout ATTEMPT, not per request. Regenerated only when the
   * customer starts over, so every retry of this attempt collapses into the
   * same order server-side.
   */
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    Crypto.randomUUID(),
  );

  const addresses = useQuery({
    queryKey: ["addresses"],
    queryFn: () => api.get<AddressDto[]>("/addresses"),
  });

  useEffect(() => {
    if (addressId || !addresses.data) return;

    const preferred =
      addresses.data.find((item) => item.isDefault && item.isServiceable) ??
      addresses.data.find((item) => item.isServiceable);

    if (preferred) {
      setAddressId(preferred.id);
    }
  }, [addresses.data, addressId]);

  const quote = useQuery({
    queryKey: ["checkout-quote", addressId],

    queryFn: () =>
      api.post<CheckoutQuoteResponse>("/checkout/quote", { addressId }),

    enabled: addressId !== null,
  });

  // COD may become unavailable between screens (an item added, a cap crossed).
  // Falling back rather than letting the customer submit a doomed order.
  useEffect(() => {
    if (
      quote.data &&
      paymentMethod === PaymentMethod.COD &&
      !quote.data.codAllowed
    ) {
      setPaymentMethod(PaymentMethod.ONLINE);
    }
  }, [quote.data, paymentMethod]);

  const placeOrder = useCallback(async (): Promise<void> => {
    if (!addressId || !quote.data || placing) return;

    setPlacing(true);
    setError(null);

    try {
      const result = await api.post<{
        order: OrderDetailDto;
        requiresPayment: boolean;
      }>(
        "/orders",
        {
          addressId,
          paymentMethod,

          // Safety check only — never the charged amount.
          expectedTotalPaise: quote.data.bill.totalPaise,
        },
        idempotencyKey,
      );

      await queryClient.invalidateQueries({
        queryKey: keys.cart,
      });

      await queryClient.invalidateQueries({
        queryKey: keys.orders,
      });

      onPlaced(result.order, result.requiresPayment);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);

        // Prices moved while reviewing: refresh the quote so the customer
        // re-confirms against the real total instead of retrying blindly.
        if (
          err.code === ErrorCode.PRICE_CHANGED ||
          err.code === ErrorCode.ITEM_OUT_OF_STOCK
        ) {
          await quote.refetch();

          // A changed basket is a NEW attempt, so it gets a new key.
          setIdempotencyKey(Crypto.randomUUID());
        }
      } else {
        setError("Could not place your order. Please try again.");
      }
    } finally {
      setPlacing(false);
    }
  }, [
    addressId,
    quote,
    placing,
    paymentMethod,
    idempotencyKey,
    queryClient,
    onPlaced,
  ]);

  if (addresses.isLoading) {
    return <Loading label="Loading checkout…" />;
  }

  if (addresses.isError) {
    return (
      <ErrorState
        message="We could not load your addresses."
        onRetry={() => void addresses.refetch()}
      />
    );
  }

  const bill = quote.data?.bill;

  const selected =
    addresses.data?.find((item) => item.id === addressId) ?? null;

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

        <AppText variant="h3">Checkout</AppText>
      </View>

      <View style={styles.stepper}>
        {STEPS.map((item, index) => {
          const currentIndex = STEPS.findIndex((entry) => entry.key === step);

          const done = index < currentIndex;
          const active = index === currentIndex;

          return (
            <View key={item.key} style={styles.stepItem}>
              <View
                style={[
                  styles.stepDot,
                  (done || active) && {
                    backgroundColor: colors.primary,
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={
                    done || active ? colors.onPrimary : colors.textSecondary
                  }
                >
                  {done ? "✓" : index + 1}
                </AppText>
              </View>

              <AppText
                variant="caption"
                color={active ? colors.primary : colors.textSecondary}
              >
                {item.label}
              </AppText>
            </View>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.base,
          paddingBottom: 180,
        }}
      >
        {error && <NoticeStrip message={error} />}

        {quote.data?.changes.map((change, index) => (
          <NoticeStrip key={index} message={change.message} />
        ))}

        {step === "address" && (
          <View>
            <AppText variant="h3">Delivery Address</AppText>

            {(addresses.data ?? []).length === 0 ? (
              <Card
                style={{
                  marginTop: spacing.base,
                }}
              >
                <AppText variant="body" color={colors.textSecondary}>
                  You have not added an address yet.
                </AppText>

                <Button
                  label="Add address"
                  onPress={onAddAddress}
                  style={{
                    marginTop: spacing.base,
                  }}
                />
              </Card>
            ) : (
              (addresses.data ?? []).map((address) => (
                <Pressable
                  key={address.id}
                  onPress={() =>
                    address.isServiceable && setAddressId(address.id)
                  }
                  style={[
                    styles.addressCard,
                    address.id === addressId && {
                      borderColor: colors.primary,
                    },
                    !address.isServiceable && {
                      opacity: 0.55,
                    },
                  ]}
                >
                  <AppText variant="bodyStrong">{address.label}</AppText>

                  <AppText variant="body" color={colors.textSecondary}>
                    {address.fullName} · {address.mobile}
                  </AppText>

                  <AppText variant="body" color={colors.textSecondary}>
                    {address.area}, {address.city} {address.pincode}
                  </AppText>

                  {!address.isServiceable && (
                    <AppText variant="caption" color={colors.danger}>
                      We don’t deliver to this address
                    </AppText>
                  )}
                </Pressable>
              ))
            )}

            {quote.data?.serviceability.serviceable && (
              <Card
                style={{
                  marginTop: spacing.base,
                  backgroundColor: colors.primarySurface,
                }}
              >
                <AppText variant="bodyStrong" color={colors.primary}>
                  Delivery in{" "}
                  {formatEtaRange(
                    quote.data.etaMinMinutes,
                    quote.data.etaMaxMinutes,
                  )}
                </AppText>
              </Card>
            )}
          </View>
        )}

        {step === "payment" && (
          <View>
            <AppText variant="h3">Select Payment Method</AppText>

            {/* UPI only, deliberately: the server runs PAYMENT_PROVIDER=upi_intent
                and the next screen is a UPI app picker. Promising cards and
                wallets here would be discovered as false only after the order
                is already placed. */}
            <PaymentOption
              label="Pay by UPI"
              hint="GPay, PhonePe, Paytm, BHIM or your bank app"
              selected={paymentMethod === PaymentMethod.ONLINE}
              onPress={() => setPaymentMethod(PaymentMethod.ONLINE)}
            />

            {/* COD is shown DISABLED WITH A REASON rather than hidden —
                a missing option is confusing, an explained one is not. */}
            <PaymentOption
              label="Cash on Delivery"
              hint={
                quote.data?.codAllowed
                  ? "Pay when your order is delivered"
                  : (quote.data?.codBlockedReason ??
                    "Not available for this order")
              }
              selected={paymentMethod === PaymentMethod.COD}
              disabled={!quote.data?.codAllowed}
              onPress={() => setPaymentMethod(PaymentMethod.COD)}
            />
          </View>
        )}

        {step === "review" && bill && (
          <View>
            <AppText variant="h3">Review your order</AppText>

            {selected && (
              <Card
                style={{
                  marginTop: spacing.base,
                }}
              >
                <AppText variant="bodyStrong">{selected.label}</AppText>

                <AppText variant="body" color={colors.textSecondary}>
                  {selected.area}, {selected.city} {selected.pincode}
                </AppText>
              </Card>
            )}

            <Card
              style={{
                marginTop: spacing.base,
              }}
            >
              <AppText variant="h3">Bill Details</AppText>

              <Row
                label={`Item Total (${bill.itemCount} items)`}
                value={formatPaise(bill.itemsSubtotalPaise)}
              />

              {bill.couponDiscountPaise > 0 && (
                <Row
                  label="Coupon"
                  value={`− ${formatPaise(bill.couponDiscountPaise)}`}
                />
              )}

              <Row
                label="Delivery Fee"
                value={
                  bill.deliveryFeePaise === 0
                    ? "FREE"
                    : formatPaise(bill.deliveryFeePaise)
                }
              />

              {bill.platformFeePaise > 0 && (
                <Row
                  label="Platform Fee"
                  value={formatPaise(bill.platformFeePaise)}
                />
              )}

              <View style={styles.totalRow}>
                <AppText variant="h3">To Pay</AppText>

                <AppText variant="h3" color={colors.primary}>
                  {formatPaise(bill.totalPaise)}
                </AppText>
              </View>
            </Card>

            <Card
              style={{
                marginTop: spacing.base,
              }}
            >
              <AppText variant="bodyStrong">
                {paymentMethod === PaymentMethod.COD
                  ? "Cash on Delivery"
                  : "Pay by UPI"}
              </AppText>
            </Card>
          </View>
        )}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + spacing.base,
          },
        ]}
      >
        {bill && (
          <AppText
            variant="bodyStrong"
            style={{
              marginBottom: spacing.sm,
            }}
          >
            To Pay {formatPaise(bill.totalPaise)}
          </AppText>
        )}

        {step === "review" ? (
          <Button
            label={
              paymentMethod === PaymentMethod.COD
                ? "Place Order"
                : "Continue to Payment"
            }
            onPress={() => void placeOrder()}
            // Disabled the instant it is pressed. A double-tap on 3G is
            // routine, and the idempotency key catches what this misses.
            loading={placing}
            disabled={placing || !bill || !addressId}
          />
        ) : (
          <Button
            label="Continue"
            onPress={() => setStep(step === "address" ? "payment" : "review")}
            disabled={
              step === "address"
                ? !addressId || !quote.data?.serviceability.serviceable
                : false
            }
          />
        )}
      </View>
    </Screen>
  );
}

function PaymentOption({
  label,
  hint,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[
        styles.paymentOption,
        selected && {
          borderColor: colors.primary,
          backgroundColor: colors.primarySurface,
        },
        disabled && {
          opacity: 0.55,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{label}</AppText>

        <AppText
          variant="caption"
          color={disabled ? colors.danger : colors.textSecondary}
        >
          {hint}
        </AppText>
      </View>

      <View
        style={[
          styles.radio,
          selected && {
            borderColor: colors.primary,
          },
        ]}
      >
        {selected && <View style={styles.radioDot} />}
      </View>
    </Pressable>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <AppText variant="body" color={colors.textSecondary}>
        {label}
      </AppText>

      <AppText variant="body">{value}</AppText>
    </View>
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

  stepper: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: spacing.base,
    backgroundColor: colors.surface,
  },

  stepItem: {
    alignItems: "center",
    gap: spacing.xs,
  },

  stepDot: {
    width: 28,
    height: 28,
    borderRadius: radius.circle,
    backgroundColor: colors.surfaceSunken,
    alignItems: "center",
    justifyContent: "center",
  },

  addressCard: {
    marginTop: spacing.md,
    padding: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },

  paymentOption: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    padding: spacing.base,
    minHeight: 64,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },

  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.circle,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radius.circle,
    backgroundColor: colors.primary,
  },

  row: {
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
