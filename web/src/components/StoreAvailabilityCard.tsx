/**
 * The trading switch and the weekly opening hours.
 *
 * These are the two settings the shopkeeper touches most often and the only
 * ones whose effect on the customer app is immediate: the switch stops the app
 * taking orders right now, and the schedule decides every other hour of the
 * week. Both save on the spot — there is no "publish" step to forget.
 *
 * Turning the switch off does NOT hide the catalog. Customers can still browse
 * and fill a cart; they are told the shop is closed and checkout is refused by
 * the API. A dark app looks broken, a closed one looks shut.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StoreAvailabilityDto, StoreHoursDto } from '@shared';
import { api } from '@/lib/api';
import { Button, ErrorBanner, Icon, Panel, Pill, Spinner, Toggle } from '@/components/ui';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const timeInputClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50 disabled:text-gray-400';

function sameHours(a: StoreHoursDto[], b: StoreHoursDto[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function StoreAvailabilityCard() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<StoreHoursDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const availability = useQuery({
    queryKey: ['store-availability'],
    queryFn: () => api.get<StoreAvailabilityDto>('/admin/store/availability'),
  });

  // Seed the editable copy once. Re-seeding on every fetch would wipe
  // half-entered times the moment a background refetch landed.
  useEffect(() => {
    if (availability.data && draft === null) setDraft(availability.data.hours);
  }, [availability.data, draft]);

  /** Everything that reads the open/closed state has to follow the switch. */
  function adopt(next: StoreAvailabilityDto): void {
    setError(null);
    queryClient.setQueryData(['store-availability'], next);
    setDraft(next.hours);
    void queryClient.invalidateQueries({ queryKey: ['store'] });
  }

  function flash(message: string): void {
    setNote(message);
    window.setTimeout(() => setNote(null), 4000);
  }

  const toggleStatus = useMutation({
    mutationFn: (isActive: boolean) =>
      api.patch<StoreAvailabilityDto>('/admin/store/status', { isActive }),
    onSuccess: (next) => {
      adopt(next);
      flash(
        next.isActive
          ? 'The store is switched on. Customers can order during opening hours.'
          : 'The store is switched off. Customers can browse but cannot place orders.',
      );
    },
    onError: (err: Error) => setError(err.message),
  });

  const saveHours = useMutation({
    mutationFn: (hours: StoreHoursDto[]) =>
      api.patch<StoreAvailabilityDto>('/admin/store/hours', { hours }),
    onSuccess: (next) => {
      adopt(next);
      flash('Opening hours saved. They apply from the next order.');
    },
    onError: (err: Error) => setError(err.message),
  });

  if (availability.isLoading || !availability.data || draft === null) {
    return <Spinner label="Loading store availability…" />;
  }

  const data = availability.data;
  const dirty = !sameHours(draft, data.hours);
  const busy = toggleStatus.isPending || saveHours.isPending;

  function patchDay(dayOfWeek: number, changes: Partial<StoreHoursDto>): void {
    setDraft((current) =>
      (current ?? []).map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...changes } : day)),
    );
  }

  /** The common case for a kirana store: one window, seven days. */
  function applyToAllDays(): void {
    setDraft((current) => {
      if (!current) return current;
      const source = current.find((day) => !day.isClosed) ?? current[0];
      if (!source) return current;
      return current.map((day) => ({
        ...day,
        opensAt: source.opensAt,
        closesAt: source.closesAt,
        isClosed: false,
      }));
    });
  }

  return (
    <Panel
      title="Store availability"
      action={
        data.isActive ? (
          <Pill tone={data.isOpenNow ? 'brand' : 'amber'}>
            {data.isOpenNow ? 'Open now' : 'Closed now'}
          </Pill>
        ) : (
          <Pill tone="red">Switched off</Pill>
        )
      }
    >
      <div className="space-y-4">
        <ErrorBanner message={error} />
        {note && (
          <div className="rounded-xl border border-brand-500/30 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-700">
            {note}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 rounded-xl bg-gray-50 p-3.5">
          <Toggle
            checked={data.isActive}
            disabled={busy}
            label="Accept orders from the app"
            onChange={(next) => toggleStatus.mutate(next)}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">
              {data.isActive ? 'App is taking orders' : 'App is not taking orders'}
            </p>
            <p className="text-sm text-gray-600">
              {data.isActive
                ? 'Customers can order during the opening hours below.'
                : 'Customers can still browse, but checkout is turned off until you switch this back on.'}
            </p>
          </div>
        </div>

        {data.isActive && !data.isOpenNow && data.nextOpenText && (
          <p className="flex items-center gap-2 text-sm text-gray-600">
            <Icon name="clock" className="h-4 w-4 text-gray-400" />
            {data.nextOpenText}.
          </p>
        )}

        <div className={data.isActive ? '' : 'opacity-60'}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Opening hours</h3>
            <Button variant="ghost" onClick={applyToAllDays} disabled={busy}>
              Apply to all days
            </Button>
          </div>

          {!data.isActive && (
            <p className="mb-2 text-sm text-gray-600">
              These hours take effect when the store is switched back on.
            </p>
          )}

          <div className="divide-y divide-gray-100">
            {draft.map((day) => (
              <div
                key={day.dayOfWeek}
                className="flex flex-wrap items-center gap-3 py-2.5 sm:flex-nowrap"
              >
                <span className="w-24 shrink-0 text-sm font-medium text-gray-700">
                  {DAY_NAMES[day.dayOfWeek]}
                </span>

                <input
                  type="time"
                  value={day.opensAt}
                  disabled={day.isClosed || busy}
                  aria-label={`${DAY_NAMES[day.dayOfWeek]} opening time`}
                  onChange={(event) => patchDay(day.dayOfWeek, { opensAt: event.target.value })}
                  className={timeInputClass}
                />
                <span className="text-sm text-gray-400">to</span>
                <input
                  type="time"
                  value={day.closesAt}
                  disabled={day.isClosed || busy}
                  aria-label={`${DAY_NAMES[day.dayOfWeek]} closing time`}
                  onChange={(event) => patchDay(day.dayOfWeek, { closesAt: event.target.value })}
                  className={timeInputClass}
                />

                <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={day.isClosed}
                    disabled={busy}
                    onChange={(event) =>
                      patchDay(day.dayOfWeek, { isClosed: event.target.checked })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                  />
                  Closed
                </label>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => saveHours.mutate(draft)} disabled={!dirty || busy}>
            {saveHours.isPending ? 'Saving…' : 'Save opening hours'}
          </Button>
          {dirty && !saveHours.isPending && (
            <Button variant="ghost" onClick={() => setDraft(data.hours)} disabled={busy}>
              Discard changes
            </Button>
          )}
        </div>

        <p className="text-xs text-gray-500">
          Times are 24-hour, in the store&rsquo;s timezone ({data.timezone}). A closing time
          earlier than the opening time means the shop trades past midnight — 08:00 to 01:00 is a
          17-hour day. Setting both to the same time means open 24 hours.
        </p>
      </div>
    </Panel>
  );
}
