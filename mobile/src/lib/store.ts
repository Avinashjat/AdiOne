/**
 * Client state (Zustand).
 *
 * ONLY client state lives here — tokens, the chosen address, serviceability.
 * Server state (products, cart, orders) belongs to TanStack Query, because
 * caching, retries and stale-while-revalidate on a bad network are the hard
 * part and are exactly what it exists to solve.
 */

import { create } from 'zustand';
import type { AuthResponse, ServiceabilityResult, UserDto } from '@shared';
import { api, readRefreshToken, saveRefreshToken, setAccessToken } from './api';
import { connectSocket, disconnectSocket } from './socket';
import { forgetPushRegistration, registerForPush } from './push';

/* -------------------------------------------------------------------------- */
/* Auth                                                                       */
/* -------------------------------------------------------------------------- */

interface AuthState {
  user: UserDto | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  setSession: (result: AuthResponse) => Promise<void>;
  restore: () => Promise<void>;
  logout: () => Promise<void>;
  clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: 'loading',

  async setSession(result) {
    setAccessToken(result.tokens.accessToken);
    await saveRefreshToken(result.tokens.refreshToken);
    // The socket authenticates with the access token, so it can only be
    // opened once a session exists — and must be reopened after a refresh.
    connectSocket(result.tokens.accessToken);
    // Registers the push token. Without this the server queues every order
    // update correctly and has nowhere to deliver it.
    void registerForPush();
    set({ user: result.user, status: 'authenticated' });
  },

  /** Silent re-login on cold start, so the customer is not asked for an OTP daily. */
  async restore() {
    const refreshToken = await readRefreshToken();
    if (!refreshToken) {
      set({ status: 'anonymous' });
      return;
    }
    try {
      const result = await api.post<AuthResponse>('/auth/refresh', { refreshToken });
      setAccessToken(result.tokens.accessToken);
      await saveRefreshToken(result.tokens.refreshToken);
      connectSocket(result.tokens.accessToken);
      void registerForPush();
      set({ user: result.user, status: 'authenticated' });
    } catch {
      setAccessToken(null);
      await saveRefreshToken(null);
      disconnectSocket();
      set({ user: null, status: 'anonymous' });
    }
  },

  async logout() {
    const refreshToken = await readRefreshToken();
    // Revoked server-side — clearing the device alone leaves the session live.
    await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    setAccessToken(null);
    await saveRefreshToken(null);
    disconnectSocket();
    // A shared phone must not keep pushing the previous customer's order
    // updates to whoever logs in next.
    forgetPushRegistration();
    set({ user: null, status: 'anonymous' });
  },

  clear() {
    setAccessToken(null);
    void saveRefreshToken(null);
    disconnectSocket();
    // A shared phone must not keep pushing the previous customer's order
    // updates to whoever logs in next.
    forgetPushRegistration();
    set({ user: null, status: 'anonymous' });
  },
}));

/* -------------------------------------------------------------------------- */
/* Location & serviceability                                                  */
/* -------------------------------------------------------------------------- */

export interface ChosenLocation {
  latitude: number;
  longitude: number;
  label: string;
}

interface LocationState {
  location: ChosenLocation | null;
  serviceability: ServiceabilityResult | null;
  /** Which saved address the customer is ordering to. */
  selectedAddressId: string | null;
  checking: boolean;
  error: string | null;
  setLocation: (location: ChosenLocation) => Promise<void>;
  selectAddress: (addressId: string | null) => void;
  refresh: () => Promise<void>;
}

export const useLocation = create<LocationState>((set, get) => ({
  location: null,
  serviceability: null,
  selectedAddressId: null,
  checking: false,
  error: null,

  async setLocation(location) {
    set({ location, checking: true, error: null });
    try {
      // THE SERVER DECIDES. The app only displays the answer — it never
      // computes serviceability itself and never acts on a cached verdict.
      const result = await api.get<ServiceabilityResult>(
        `/store/serviceability?lat=${location.latitude}&lng=${location.longitude}`,
      );
      set({ serviceability: result, checking: false });
    } catch (error) {
      set({
        checking: false,
        error: error instanceof Error ? error.message : 'Could not check your location.',
      });
    }
  },

  selectAddress(addressId) {
    set({ selectedAddressId: addressId });
  },

  async refresh() {
    const { location } = get();
    if (location) await get().setLocation(location);
  },
}));

/* -------------------------------------------------------------------------- */
/* App preferences                                                            */
/* -------------------------------------------------------------------------- */

interface PreferenceState {
  language: 'en' | 'hi';
  hasSeenOnboarding: boolean;
  setLanguage: (language: 'en' | 'hi') => void;
  completeOnboarding: () => void;
}

export const usePreferences = create<PreferenceState>((set) => ({
  language: 'en',
  hasSeenOnboarding: false,
  setLanguage: (language) => set({ language }),
  completeOnboarding: () => set({ hasSeenOnboarding: true }),
}));
