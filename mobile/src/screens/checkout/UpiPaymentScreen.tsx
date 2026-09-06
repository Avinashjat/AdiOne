import { useEffect, useState } from "react";
import {
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { OrderStatus, type CreatePaymentResponse } from "@shared";

import { formatPaise } from "@shared/money";
import { colors, radius, spacing } from "@shared/theme";
import { api, ApiRequestError } from "@/lib/api";

import {
  AppText,
  Button,
  Card,
  Input,
  Loading,
  NoticeStrip,
  Screen,
} from "@/components/ui";

type Stage = "ready" | "opened" | "claimed";

const NO_UPI_APP =
  "No compatible UPI app found. Please install Google Pay, PhonePe, Paytm, BHIM or another UPI app.";

export default function UpiPaymentScreen({
  orderId,
  onPaid,
  onCancel,
}: {
  orderId: string;
  onPaid: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();

  const [stage, setStage] = useState<Stage>("ready");
  const [utr, setUtr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [claimIdempotencyKey] = useState(() => Crypto.randomUUID());

  /*
   * One idempotency key for this payment-intent creation attempt.
   * Retrying the request must not create multiple payment records.
   */
  const [paymentIdempotencyKey] = useState(() => Crypto.randomUUID());

  /*
   * The backend creates the UPI intent.
   *
   * IMPORTANT:
   * The amount displayed on this screen comes ONLY from
   * intent.data.amountPaise returned by the server.
   *
   * Never calculate or hardcode the payment amount on the client.
   */
  const intent = useQuery({
    queryKey: ["payment-intent", orderId],
    queryFn: () =>
      api.post<CreatePaymentResponse>(
        "/payments/create",
        { orderId },
        paymentIdempotencyKey,
      ),
    staleTime: Infinity,
    retry: false,
  });

  /*
   * Payment status is checked only after the customer explicitly
   * claims that they have paid.
   *
   * Returning from a UPI application is NOT payment success.
   */
  const order = useQuery({
    queryKey: ["order-payment-status", orderId],
    queryFn: () =>
      api.get<{
        status: OrderStatus;
        paymentStatus: string;
      }>(`/payments/${orderId}/status`),
    enabled: stage === "claimed",
    refetchInterval: stage === "claimed" ? 10_000 : false,
  });

  /*
   * Only the backend-confirmed order state can finish this screen.
   *
   * The customer claiming payment does NOT directly mark payment as paid.
   */
  useEffect(() => {
    if (order.data && order.data.status !== OrderStatus.PENDING_PAYMENT) {
      onPaid();
    }
  }, [order.data, onPaid]);

  /*
   * Returning from the UPI app is NOT payment success.
   *
   * It only means the customer has returned to AdiOne.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && stage === "opened") {
        setError(null);
      }
    });

    return () => subscription.remove();
  }, [stage]);

  async function openUpiPayment(): Promise<void> {
    const url = intent.data?.upiIntentUrl;

    if (!url) {
      setError("UPI payment is currently unavailable. Please try again.");
      return;
    }

    setError(null);

    try {
      /*
       * expo-linking is enough for Android to hand the
       * upi://pay URI to an installed UPI application.
       *
       * No additional payment SDK is required.
       */
      const Linking = await import("expo-linking");

      await Linking.openURL(url);

      /*
       * IMPORTANT:
       * Opening the UPI app is NOT payment confirmation.
       */
      setStage("opened");
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Could not open a compatible UPI app. Please try again.",
      );
    }
  }

  async function claimPaid(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      await api.post(
        "/payments/claim",
        {
          orderId,
          utr: utr.trim().length === 12 ? utr.trim() : null,
        },
        claimIdempotencyKey,
      );

      /*
       * This only tells the backend:
       * "Customer says they paid."
       *
       * It does NOT mark the payment as paid.
       */
      setStage("claimed");
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Could not submit the payment information.",
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmLeave(): void {
    Alert.alert(
      "Leave payment?",
      "Your payment will remain pending. If you paid successfully, the store can verify it from the merchant account.",
      [
        {
          text: "Stay",
          style: "cancel",
        },
        {
          text: "Go back",
          onPress: onPaid,
        },
      ],
    );
  }

  if (intent.isLoading) {
    return <Loading label="Preparing UPI payment…" />;
  }

  if (intent.isError || !intent.data || !intent.data.upiIntentUrl) {
    return (
      <Screen
        style={{
          padding: spacing.base,
          paddingTop: insets.top + spacing.xxl,
        }}
      >
        <NoticeStrip
          message={
            intent.error instanceof ApiRequestError
              ? intent.error.message
              : "Could not prepare the UPI payment. Please try again."
          }
        />

        <Button
          label="Go back"
          variant="secondary"
          onPress={onPaid}
          style={{ marginTop: spacing.base }}
        />
      </Screen>
    );
  }

  /*
   * TASK 22:
   *
   * The amount is ALWAYS taken from the backend-created payment intent.
   *
   * Example:
   *   amountPaise = 25300
   *   formatPaise(...) = "₹253"
   *
   * Therefore the button becomes:
   *   "Pay ₹253 via UPI"
   *
   * Never hardcode an amount such as ₹499 here.
   */
  const amount = formatPaise(intent.data.amountPaise);

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
        <Pressable onPress={confirmLeave} hitSlop={12} style={styles.back}>
          <AppText variant="h2">←</AppText>
        </Pressable>

        <AppText variant="h3">Pay with UPI</AppText>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.base,
          paddingBottom: 180,
          gap: spacing.base,
        }}
      >
        {error && <NoticeStrip message={error} />}

        <Card
          style={{
            alignItems: "center",
            backgroundColor: colors.primarySurface,
          }}
        >
          <AppText variant="body" color={colors.textSecondary}>
            Amount to pay
          </AppText>

          <AppText variant="displayLarge" color={colors.primary}>
            {amount}
          </AppText>

          <AppText variant="caption" color={colors.textSecondary}>
            to {intent.data.upiVpa}
          </AppText>
        </Card>

        {stage === "claimed" ? (
          <Card>
            <AppText variant="h3">Payment verification pending</AppText>

            <AppText
              variant="body"
              color={colors.textSecondary}
              style={{ marginTop: spacing.sm }}
            >
              Your payment has not been automatically marked as successful. The
              store will verify the payment against its merchant UPI account.
            </AppText>

            <AppText
              variant="body"
              color={colors.textSecondary}
              style={{ marginTop: spacing.sm }}
            >
              Payment status: Pending
            </AppText>

            <Button
              label="View my order"
              variant="secondary"
              onPress={onPaid}
              style={{ marginTop: spacing.lg }}
            />
          </Card>
        ) : (
          <>
            <Card>
              <AppText variant="h3">Pay securely using UPI</AppText>

              <AppText
                variant="body"
                color={colors.textSecondary}
                style={{ marginTop: spacing.sm }}
              >
                Tap the button below. Your phone will open an installed UPI
                application with the merchant and amount already filled in.
              </AppText>

              <AppText
                variant="body"
                color={colors.textSecondary}
                style={{ marginTop: spacing.sm }}
              >
                Complete the payment inside your UPI app and return to AdiOne.
              </AppText>
            </Card>

            {/*
             * TASK 22:
             *
             * This is the ACTUAL payment button.
             *
             * The amount is dynamic and comes from:
             *
             *   intent.data.amountPaise
             *
             * Never replace this with a hardcoded value.
             */}
            <Button
              label={`Pay ${amount} via UPI`}
              onPress={() => void openUpiPayment()}
            />

            {stage === "opened" && (
              <Card>
                <AppText variant="h3">Did you complete the payment?</AppText>

                <AppText
                  variant="body"
                  color={colors.textSecondary}
                  style={{
                    marginTop: spacing.sm,
                    marginBottom: spacing.md,
                  }}
                >
                  If your payment was successful, enter the 12-digit UPI
                  reference number from your receipt. This helps the store
                  verify your payment.
                </AppText>

                <Input
                  value={utr}
                  onChangeText={(value) => setUtr(value.replace(/\D/g, ""))}
                  placeholder="UPI reference / UTR (optional)"
                  keyboardType="number-pad"
                  maxLength={12}
                />

                <Button
                  label="I have paid"
                  onPress={() => void claimPaid()}
                  loading={busy}
                  style={{ marginTop: spacing.base }}
                />
              </Card>
            )}

            <AppText variant="caption" color={colors.textSecondary}>
              Returning from the UPI app does not automatically confirm your
              payment. The store verifies the transaction before processing your
              order.
            </AppText>
          </>
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
});
