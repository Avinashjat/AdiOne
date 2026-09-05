/**
 * Store location.
 *
 * The store's coordinates are the origin of every serviceability check, so a
 * seeded placeholder means "We don't deliver to your area yet" for everybody —
 * the single most confusing failure in a fresh install, because nothing is
 * actually broken.
 *
 * The browser can read the operator's real position, which is almost always
 * the shop itself, so the fastest correct fix is one button.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicConfig, StoreDto } from '@shared';
import { calculateDistance } from '@shared/distance';
import { api } from '@/lib/api';
import { Button, ErrorBanner, Field, Icon, Panel, Pill, inputClass } from '@/components/ui';

export default function StoreLocationCard() {
  const queryClient = useQueryClient();
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const store = useQuery({
    queryKey: ['store'],
    queryFn: () => api.get<StoreDto>('/store'),
  });

  const config = useQuery({
    queryKey: ['public-config'],
    queryFn: () => api.get<PublicConfig>('/config/public'),
    staleTime: 5 * 60_000,
  });

  // Seed the inputs once the store loads, without clobbering typing afterwards.
  useEffect(() => {
    if (store.data && lat === '' && lng === '') {
      setLat(String(store.data.latitude));
      setLng(String(store.data.longitude));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.data]);

  const save = useMutation({
    mutationFn: (input: { latitude: number; longitude: number }) =>
      api.patch('/admin/store', input),
    onSuccess: () => {
      setError(null);
      setNote('Store location saved. The app will use it on the next check.');
      void queryClient.invalidateQueries({ queryKey: ['store'] });
      window.setTimeout(() => setNote(null), 4000);
    },
    onError: (err: Error) => setError(err.message),
  });

  function useMyLocation(): void {
    setError(null);
    setNote(null);

    if (!navigator.geolocation) {
      setError('This browser cannot report a location. Enter the coordinates by hand.');
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setLat(position.coords.latitude.toFixed(6));
        setLng(position.coords.longitude.toFixed(6));
        setNote(
          `Picked up your position to about ±${Math.round(position.coords.accuracy)} m. ` +
            'Check it looks right, then save.',
        );
      },
      (err) => {
        setLocating(false);
        // Distinguishing these matters: "denied" is fixed in browser settings,
        // "unavailable" usually means no GPS/wifi fix on a desktop.
        const reason =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied. Allow it for this site, or type the coordinates in.'
            : err.code === err.POSITION_UNAVAILABLE
              ? 'Your position could not be determined. Type the coordinates in instead.'
              : 'Finding your location timed out. Try again, or type the coordinates in.';
        setError(reason);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  const valid =
    Number.isFinite(parsedLat) &&
    Number.isFinite(parsedLng) &&
    Math.abs(parsedLat) <= 90 &&
    Math.abs(parsedLng) <= 180 &&
    !(parsedLat === 0 && parsedLng === 0);

  // How far the entered point is from where the store currently sits — the
  // sanity check that catches a swapped lat/lng or a stray decimal point.
  const movingBy =
    store.data && valid
      ? calculateDistance(store.data.latitude, store.data.longitude, parsedLat, parsedLng)
      : null;

  const radiusKm = config.data?.MAX_SERVICE_RADIUS_KM;

  return (
    <Panel title="Store location">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Everything the app decides about who can order — the delivery area, the ETA, the
          delivery fee — is measured from this point. If customers are told “we don’t deliver to
          your area”, this is usually why.
        </p>

        <ErrorBanner message={error} />
        {note && (
          <div className="rounded-xl border border-brand-500/30 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-700">
            {note}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-50 p-3.5 text-sm">
          <Icon name="pin" className="h-5 w-5 text-gray-400" />
          <span className="text-gray-600">Currently</span>
          <span className="font-semibold text-gray-900">
            {store.data
              ? `${store.data.latitude.toFixed(5)}, ${store.data.longitude.toFixed(5)}`
              : '—'}
          </span>
          {store.data?.city && <Pill tone="gray">{store.data.city}</Pill>}
          {radiusKm != null && <Pill tone="brand">{radiusKm} km radius</Pill>}
        </div>

        <Button variant="secondary" onClick={useMyLocation} disabled={locating}>
          <Icon name="pin" className="h-4 w-4" />
          {locating ? 'Finding you…' : 'Use my current location'}
        </Button>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Latitude" required>
            <input
              value={lat}
              onChange={(event) => setLat(event.target.value)}
              className={inputClass}
              inputMode="decimal"
              placeholder="27.609400"
            />
          </Field>
          <Field label="Longitude" required>
            <input
              value={lng}
              onChange={(event) => setLng(event.target.value)}
              className={inputClass}
              inputMode="decimal"
              placeholder="75.139900"
            />
          </Field>
        </div>

        {movingBy != null && movingBy > 0.05 && (
          <p className="text-sm text-gray-600">
            This moves the store <span className="font-semibold">{movingBy.toFixed(1)} km</span>{' '}
            from where it is now.
            {radiusKm != null && movingBy > radiusKm && (
              <span className="text-warn-500">
                {' '}
                Customers inside the old area may fall outside the new one.
              </span>
            )}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => save.mutate({ latitude: parsedLat, longitude: parsedLng })}
            disabled={!valid || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save store location'}
          </Button>
          {!valid && lat !== '' && (
            <span className="text-sm text-danger-500">Those coordinates are not valid.</span>
          )}
        </div>

        <p className="text-xs text-gray-500">
          Tip: to use the shop’s exact spot, open Google Maps, long-press the shop, and copy the
          two numbers it shows. Latitude comes first.
        </p>
      </div>
    </Panel>
  );
}
