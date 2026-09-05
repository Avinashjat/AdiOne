/**
 * UPI payment (Task 14.10, payment step).
 *
 * Direct UPI has NO callback — nothing tells the server the money moved. So
 * this screen is built around that honestly rather than pretending a gateway
 * exists:
 *
 *   1. The customer taps the UPI app they actually use; it opens with the
 *      amount already filled in.
 *   2. When they come back, they tap "I have paid" and may enter the UTR.
 *   3. The screen then says, plainly, that the shop is checking — because that
 *      is what happens. A fake progress spinner would be a lie, and the
 *      customer would sit staring at it.
 *
 * The screen polls the order so that when the shop confirms, it moves on by
 * itself.
 *
 * WHY A GRID AND NOT ONE BUTTON. A bare upi:// link opens the system chooser —
 * a list of grey rows. Showing the apps that are actually on this phone, by
 * name and brand colour, is what makes this legible to someone paying online
 * for the first time. Detection is best-effort (see `@/lib/upi-apps`), so
 * "Other UPI app" is always offered underneath and opens the system chooser.
 *
 * The payment link itself is built by the server from backend env — the amount
 * and the shop's VPA are never assembled here.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { OrderStatus, type CreatePaymentResponse } from '@shared';
import { formatPaise } from '@shared/money';
import { colors, radius, spacing } from '@shared/theme';
import { api, ApiRequestError } from '@/lib/api';
import {
  detectInstalledUpiApps,
  hasAnyUpiApp,
  openUpiApp,
  openUpiChooser,
  type UpiApp,
} from '@/lib/upi-apps';
import { AppText, Button, Card, Input, Loading, NoticeStrip, Screen } from '@/components/ui';

type Stage = 'ready' | 'opened' | 'claimed';

const NO_UPI_APP =
  'No UPI app found on this phone. Install PhonePe, Google Pay or Paytm, or choose Cash on Delivery.';

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
  const [stage, setStage] = useState<Stage>('ready');
  const [utr, setUtr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** null while probing — the grid and the intent request load in parallel. */
  const [apps, setApps] = useState<UpiApp[] | null>(null);

  const intent = useQuery({
    queryKey: ['payment-intent', orderId],
    queryFn: () => api.post<CreatePaymentResponse>('/payments/create', { orderId }),
    // One intent per order; refetching would mint a new provider reference.
    staleTime: Infinity,
    retry: false,
  });

  // Once the claim is in, the shop's confirmation is the only thing that moves
  // this forward — so poll for it rather than making the customer refresh.
  const order = useQuery({
    queryKey: ['order-payment-status', orderId],
    queryFn: () =>
      api.get<{ status: OrderStatus; paymentStatus: string }>(`/payments/${orderId}/status`),
    refetchInterval: stage === 'claimed' ? 10_000 : false,
    enabled: stage === 'claimed',
  });

  useEffect(() => {
    if (order.data && order.data.status !== OrderStatus.PENDING_PAYMENT) onPaid();
  }, [order.data, onPaid]);

  // Starts on mount rather than on tap, so the apps are already on screen by
  // the time the customer looks for them.
  useEffect(() => {
    let cancelled = false;
    detectInstalledUpiApps()
      .then((found) => {
        if (!cancelled) setApps(found);
      })
      .catch(() => {
        // Detection failing is not a payment failure — fall through to the
        // chooser, which needs no probing at all.
        if (!cancelled) setApps([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function payWith(app: UpiApp): Promise<void> {
    const url = intent.data?.upiIntentUrl;
    if (!url) return;

    setError(null);
    try {
      await openUpiApp(app, url);
      setStage('opened');
    } catch {
      setError(`Could not open ${app.name}. Try another app, or “Other UPI app”.`);
    }
  }

  async function payWithChooser(): Promise<void> {
    const url = intent.data?.upiIntentUrl;
    if (!url) return;

    setError(null);
    try {
      if (!(await hasAnyUpiApp(url))) {
        // Telling them to install one is more useful than a generic failure.
        setError(NO_UPI_APP);
        return;
      }
      await openUpiChooser(url);
      setStage('opened');
    } catch {
      setError('Could not open your UPI app. Please try again.');
    }
  }

  async function claimPaid(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.post('/payments/claim', {
        orderId,
        utr: utr.trim().length === 12 ? utr.trim() : null,
      });
      setStage('claimed');
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Could not record your payment.',
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmLeave(): void {
    Alert.alert(
      'Leave without paying?',
      'Your order will be cancelled if payment is not received shortly.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: onCancel },
      ],
    );
  }

  if (intent.isLoading) return <Loading label="Preparing payment…" />;

  // No upiIntentUrl means the server is not in direct-UPI mode, so there is no
  // link to hand to any app. Bail out with a message rather than rendering a
  // grid whose tiles would silently do nothing when tapped.
  if (intent.isError || !intent.data || !intent.data.upiIntentUrl) {
    return (
      <Screen style={{ padding: spacing.base, paddingTop: insets.top + spacing.xxl }}>
        <NoticeStrip
          message={
            intent.error instanceof ApiRequestError
              ? intent.error.message
              : 'Could not start the UPI payment. Please go back and choose Cash on Delivery, or try again.'
          }
        />
        <Button label="Go back" variant="secondary" onPress={onCancel} />
      </Screen>
    );
  }

  const amount = formatPaise(intent.data.amountPaise);
  const hasGrid = apps !== null && apps.length > 0;

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={confirmLeave} hitSlop={12} style={styles.back}>
          <AppText variant="h2">←</AppText>
        </Pressable>
        <AppText variant="h3">Pay with UPI</AppText>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.base, gap: spacing.base }}>
        {error && <NoticeStrip message={error} />}

        <Card style={{ alignItems: 'center', backgroundColor: colors.primarySurface }}>
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

        {stage === 'claimed' ? (
          <Card>
            <AppText variant="h3">Checking your payment</AppText>
            <AppText
              variant="body"
              color={colors.textSecondary}
              style={{ marginTop: spacing.sm }}
            >
              The store is confirming your payment against its records. This usually takes a few
              minutes during shop hours, and your items are held for you meanwhile.
            </AppText>
            <AppText
              variant="body"
              color={colors.textSecondary}
              style={{ marginTop: spacing.sm }}
            >
              You can close the app — we will notify you as soon as it is confirmed.
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
              <AppText variant="bodyStrong">How to pay</AppText>
              <Step n={1} text="Tap your UPI app below — it opens with the amount filled in." />
              <Step n={2} text="Complete the payment there." />
              <Step n={3} text="Come back and tap “I have paid”." />
            </Card>

            <View style={{ gap: spacing.md }}>
              <AppText variant="bodyStrong">Choose your UPI app</AppText>

              {apps === null ? (
                <View style={styles.probing}>
                  <ActivityIndicator color={colors.primary} />
                  <AppText variant="body" color={colors.textSecondary}>
                    Looking for UPI apps on your phone…
                  </AppText>
                </View>
              ) : hasGrid ? (
                <View style={styles.grid}>
                  {apps.map((app) => (
                    <UpiAppTile key={app.id} app={app} onPress={() => void payWith(app)} />
                  ))}
                </View>
              ) : (
                <AppText variant="body" color={colors.textSecondary}>
                  We could not spot a UPI app automatically. Tap below and your phone will show
                  you every UPI app it has, including your bank’s.
                </AppText>
              )}

              {/* Always offered: detection can miss an app, and bank apps are
                  only ever reachable through the system chooser. */}
              <Button
                label={hasGrid ? 'Other UPI app' : `Pay ${amount} with UPI`}
                variant={hasGrid ? 'secondary' : 'primary'}
                onPress={() => void payWithChooser()}
              />
            </View>

            {stage === 'opened' && (
              <Card>
                <AppText variant="bodyStrong">Have you completed the payment?</AppText>
                <AppText
                  variant="body"
                  color={colors.textSecondary}
                  style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
                >
                  Enter the 12-digit reference number from your payment receipt if you have it —
                  it helps the store find your payment faster.
                </AppText>

                <Input
                  value={utr}
                  onChangeText={(value) => setUtr(value.replace(/\D/g, ''))}
                  placeholder="UPI reference number (optional)"
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

            {/* Said plainly and up front, not buried after payment. */}
            <AppText variant="caption" color={colors.textSecondary}>
              Payments made by UPI go straight to the store’s account, so the store confirms
              each one before preparing your order.
            </AppText>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function UpiAppTile({ app, onPress }: { app: UpiApp; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Pay with ${app.name}`}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.tileMark, { backgroundColor: app.tint }]}>
        <AppText variant="bodyStrong" color={colors.onPrimary}>
          {app.initials}
        </AppText>
      </View>
      <AppText
        variant="caption"
        color={colors.textPrimary}
        numberOfLines={2}
        style={styles.tileLabel}
      >
        {app.name}
      </AppText>
    </Pressable>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepDot}>
        <AppText variant="caption" color={colors.onPrimary}>
          {n}
        </AppText>
      </View>
      <AppText variant="body" color={colors.textSecondary} style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  back: { width: 40, height: 40, justifyContent: 'center' },
  probing: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // 30% (not 33%) so three tiles plus two gaps always fit — at 33% a narrow
  // phone wraps to two per row and the grid looks broken.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { width: '30%', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  tileMark: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { textAlign: 'center' },
  step: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, alignItems: 'flex-start' },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: radius.circle,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
