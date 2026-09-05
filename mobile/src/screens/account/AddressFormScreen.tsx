/**
 * Add / Edit Address (Task 14.13), matching the approved mockup.
 *
 * ON THE PINCODE "CHECK" BUTTON — worth being precise about, because it is
 * easy to build something that looks right and lies:
 *
 * Serviceability is decided by DISTANCE FROM THE STORE, using coordinates.
 * An Indian PIN code routinely spans 10+ km, so a pincode alone cannot answer
 * "do we deliver here". Check therefore validates the pincode's format and
 * runs the real serviceability call against the customer's detected
 * coordinates, reporting distance and the configured radius. If no location
 * has been detected it says so rather than inventing an answer — and the
 * server re-checks at checkout regardless, so this is guidance, never
 * permission.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AddressDto, ServiceabilityResult } from '@shared';
import { isValidPincode, normalizeIndianMobile } from '@shared/phone';
import { formatDistance } from '@shared/distance';
import { colors, radius, spacing } from '@shared/theme';
import { api, ApiRequestError } from '@/lib/api';
import { useLocation } from '@/lib/store';
import { AppText, Button, Input, NoticeStrip, Screen } from '@/components/ui';

/** Address Type chips from the mockup. Stored in `label`. */
const ADDRESS_TYPES = ['Home', 'Work', 'Other'] as const;
type AddressType = (typeof ADDRESS_TYPES)[number];

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal',
];

interface CheckResult {
  ok: boolean;
  message: string;
}

export default function AddressFormScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const location = useLocation((state) => state.location);

  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [pincode, setPincode] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [addressType, setAddressType] = useState<AddressType>('Home');
  const [isDefault, setIsDefault] = useState(true);

  const [statePickerOpen, setStatePickerOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkPincode(): Promise<void> {
    setCheckResult(null);

    if (!isValidPincode(pincode)) {
      setCheckResult({ ok: false, message: 'Enter a valid 6-digit PIN code.' });
      return;
    }

    if (!location) {
      // Honest rather than optimistic: without coordinates there is nothing to
      // measure, and claiming "we deliver here" would be a guess.
      setCheckResult({
        ok: false,
        message: 'Turn on location to check delivery for this address.',
      });
      return;
    }

    setChecking(true);
    try {
      const result = await api.get<ServiceabilityResult>(
        `/store/serviceability?lat=${location.latitude}&lng=${location.longitude}`,
      );
      setCheckResult(
        result.serviceable
          ? {
              ok: true,
              message: `We deliver here — about ${formatDistance(result.distanceKm)} from our store.`,
            }
          : {
              ok: false,
              message: `Sorry, this looks ${formatDistance(result.distanceKm)} away. We deliver up to ${result.maxRadiusKm} km.`,
            },
      );
    } catch (err) {
      setCheckResult({
        ok: false,
        message: err instanceof ApiRequestError ? err.message : 'Could not check right now.',
      });
    } finally {
      setChecking(false);
    }
  }

  const save = useMutation({
    mutationFn: () =>
      api.post<AddressDto>('/addresses', {
        label: addressType,
        fullName: fullName.trim(),
        mobile,
        // The mockup's two address lines map onto the API's structured fields:
        // line 1 is house/building/street, line 2 is area and landmark. `area`
        // is required server-side because in this market it is often the only
        // part of an address that exists.
        houseNo: addressLine1.trim() || null,
        street: null,
        area: addressLine2.trim() || addressLine1.trim(),
        landmark: addressLine2.trim() || null,
        city: city.trim(),
        state,
        pincode,
        // Coordinates decide serviceability, so the detected fix is carried
        // through rather than derived from the typed text.
        latitude: location?.latitude ?? 0,
        longitude: location?.longitude ?? 0,
        isDefault,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['addresses'] });
      onBack();
    },
    onError: (err: Error) =>
      setError(err instanceof ApiRequestError ? err.message : 'Could not save the address.'),
  });

  const complete =
    fullName.trim().length >= 2 &&
    normalizeIndianMobile(mobile) !== null &&
    isValidPincode(pincode) &&
    addressLine1.trim().length > 0 &&
    city.trim().length > 0 &&
    state.length > 0;

  return (
    <Screen>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
          <AppText variant="h2">←</AppText>
        </Pressable>
        <View>
          <AppText variant="h3">Add New Address</AppText>
          <AppText variant="caption" color={colors.textSecondary}>
            Enter your address details
          </AppText>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.base,
          paddingBottom: insets.bottom + spacing.xxl,
          gap: spacing.base,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {error && <NoticeStrip message={error} />}

        <Field label="Full Name">
          <Input value={fullName} onChangeText={setFullName} placeholder="Enter full name" />
        </Field>

        <Field label="Phone Number">
          <Input
            value={mobile}
            onChangeText={setMobile}
            placeholder="Enter phone number"
            keyboardType="phone-pad"
            maxLength={15}
          />
        </Field>

        <Field label="Pincode">
          <View style={styles.pincodeRow}>
            <View style={{ flex: 1 }}>
              <Input
                value={pincode}
                onChangeText={(value) => {
                  setPincode(value.replace(/\D/g, ''));
                  setCheckResult(null);
                }}
                placeholder="Enter pincode"
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>
            <Pressable onPress={() => void checkPincode()} disabled={checking} style={styles.check}>
              <AppText variant="bodyStrong" color={colors.primary}>
                {checking ? 'Checking…' : 'Check'}
              </AppText>
            </Pressable>
          </View>

          {checkResult && (
            <AppText
              variant="caption"
              color={checkResult.ok ? colors.primary : colors.danger}
              style={{ marginTop: spacing.xs }}
            >
              {checkResult.message}
            </AppText>
          )}
        </Field>

        <Field label="Address Line 1">
          <Input
            value={addressLine1}
            onChangeText={setAddressLine1}
            placeholder="House / Building / Street"
          />
        </Field>

        <Field label="Address Line 2" hint="Optional">
          <Input
            value={addressLine2}
            onChangeText={setAddressLine2}
            placeholder="Area, Locality, Landmark"
          />
        </Field>

        <Field label="City">
          <Input value={city} onChangeText={setCity} placeholder="Enter city" />
        </Field>

        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field label="State">
              <Pressable onPress={() => setStatePickerOpen(!statePickerOpen)} style={styles.select}>
                <AppText variant="body" color={state ? colors.textPrimary : colors.textMuted}>
                  {state || 'Select state'}
                </AppText>
                <AppText variant="body" color={colors.textSecondary}>
                  ⌄
                </AppText>
              </Pressable>
            </Field>
          </View>

          <View style={{ flex: 1 }}>
            <Field label="Country">
              {/* Fixed: the store serves one town, and a country picker would
                  only offer a choice that cannot be honoured. */}
              <View style={[styles.select, { backgroundColor: colors.surfaceSunken }]}>
                <AppText variant="body">India</AppText>
              </View>
            </Field>
          </View>
        </View>

        {statePickerOpen && (
          // A plain View clipped the list at maxHeight with no way to reach the
          // states below Goa. It has to be a ScrollView, and on Android a
          // same-axis scroller nested in the form's ScrollView only receives
          // drag gestures with nestedScrollEnabled set.
          <ScrollView
            style={styles.stateList}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {INDIAN_STATES.map((item) => (
              <Pressable
                key={item}
                onPress={() => {
                  setState(item);
                  setStatePickerOpen(false);
                }}
                style={styles.stateItem}
              >
                <AppText variant="body" color={item === state ? colors.primary : colors.textPrimary}>
                  {item}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <Field label="Address Type">
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            {ADDRESS_TYPES.map((type) => {
              const active = type === addressType;
              return (
                <Pressable
                  key={type}
                  onPress={() => setAddressType(type)}
                  style={[
                    styles.typeChip,
                    active && { borderColor: colors.primary, backgroundColor: colors.primarySurface },
                  ]}
                >
                  <AppText
                    variant="bodyStrong"
                    color={active ? colors.primary : colors.textSecondary}
                  >
                    {type}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Pressable onPress={() => setIsDefault(!isDefault)} style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">Make it Default Address</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              This address will be used as default
            </AppText>
          </View>
          <View style={[styles.toggle, isDefault && { backgroundColor: colors.primary }]}>
            <View style={[styles.toggleKnob, isDefault && { alignSelf: 'flex-end' }]} />
          </View>
        </Pressable>

        <Button
          label="Save Address"
          onPress={() => save.mutate()}
          loading={save.isPending}
          disabled={!complete}
        />
      </ScrollView>
    </Screen>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <AppText variant="bodyStrong" style={{ marginBottom: spacing.xs }}>
        {label}
        {hint && (
          <AppText variant="body" color={colors.textSecondary}>
            {' '}
            ({hint})
          </AppText>
        )}
      </AppText>
      {children}
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
  pincodeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  check: {
    minHeight: 48,
    paddingHorizontal: spacing.base,
    justifyContent: 'center',
  },
  select: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  stateList: {
    maxHeight: 260,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  stateItem: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  typeChip: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
    minHeight: 56,
  },
  toggle: {
    width: 52,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    padding: 3,
    justifyContent: 'center',
  },
  toggleKnob: {
    width: 24,
    height: 24,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
  },
});
