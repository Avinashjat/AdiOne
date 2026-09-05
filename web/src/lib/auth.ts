import { create } from "zustand";

import type { AuthResponse, UserDto } from "@shared";

import {
  api,
  clearTokensIfCurrent,
  getStoredRefreshToken,
  loadStoredRefreshToken,
  refreshSession,
  setTokens,
} from "./api";

interface AuthState {
  user: UserDto | null;

  status: "loading" | "authenticated" | "anonymous";

  login: (email: string, password: string) => Promise<void>;

  logout: () => Promise<void>;

  restore: () => Promise<void>;

  clear: () => void;
}

/**
 * Single-flight session restoration inside the current page.
 *
 * This protects against React StrictMode and multiple components
 * accidentally calling restore().
 */
let restoreInFlight: Promise<void> | null = null;

export const useAuth = create<AuthState>((set) => ({
  user: null,

  status: "loading",

  /**
   * ---------------------------------------------------------
   * LOGIN
   * ---------------------------------------------------------
   */
  async login(email, password) {
    const result = await api.post<AuthResponse>("/auth/admin/login", {
      email,
      password,
    });

    setTokens(result.tokens.accessToken, result.tokens.refreshToken);

    set({
      user: result.user,
      status: "authenticated",
    });
  },

  /**
   * ---------------------------------------------------------
   * LOGOUT
   * ---------------------------------------------------------
   */
  async logout() {
    const refreshToken = getStoredRefreshToken();

    /**
     * Server-side revocation.
     */
    if (refreshToken) {
      await api
        .post("/auth/logout", {
          refreshToken,
        })
        .catch(() => undefined);
    }

    setTokens(null, null);

    set({
      user: null,
      status: "anonymous",
    });
  },

  /**
   * ---------------------------------------------------------
   * RESTORE SESSION
   * ---------------------------------------------------------
   *
   * Called after browser refresh.
   */
  async restore() {
    /**
     * Same page already restoring.
     */
    if (restoreInFlight) {
      return restoreInFlight;
    }

    restoreInFlight = (async () => {
      const originalToken = loadStoredRefreshToken();

      /**
       * No session exists.
       */
      if (!originalToken) {
        set({
          user: null,
          status: "anonymous",
        });

        return;
      }

      try {
        /**
         * Restore tokens.
         *
         * refreshSession handles:
         * - duplicate requests
         * - token rotation
         * - rapid browser refresh race
         */
        let refreshed = await refreshSession();

        /**
         * If refresh failed, another browser page may have stored a
         * replacement token during our request.
         */
        if (!refreshed) {
          const latestToken = getStoredRefreshToken();

          if (latestToken && latestToken !== originalToken) {
            refreshed = await refreshSession();
          }
        }

        if (!refreshed) {
          /**
           * Very important:
           *
           * Only remove the token if localStorage still contains
           * the same token that failed.
           *
           * If another page stored a new refresh token, preserve it.
           */
          const cleared = clearTokensIfCurrent(originalToken);

          if (cleared) {
            set({
              user: null,
              status: "anonymous",
            });
          } else {
            /**
             * Another page replaced the token.
             *
             * Try to recover one final time.
             */
            const recovered = await refreshSession();

            if (recovered) {
              const user = await api.get<UserDto>("/auth/me");

              set({
                user,
                status: "authenticated",
              });

              return;
            }

            set({
              user: null,
              status: "anonymous",
            });
          }

          return;
        }

        /**
         * We now have an access token.
         *
         * Fetch the authenticated admin.
         */
        const user = await api.get<UserDto>("/auth/me");

        set({
          user,
          status: "authenticated",
        });
      } catch (error) {
        console.error("[AdiOne] Failed to restore admin session:", error);

        /**
         * Another page may already have replaced the refresh token.
         */
        const latestToken = getStoredRefreshToken();

        if (latestToken && latestToken !== originalToken) {
          try {
            const recovered = await refreshSession();

            if (recovered) {
              const user = await api.get<UserDto>("/auth/me");

              set({
                user,
                status: "authenticated",
              });

              return;
            }
          } catch {
            // Fall through.
          }
        }

        /**
         * Only delete the session if the failed token is still current.
         */
        clearTokensIfCurrent(originalToken);

        set({
          user: null,
          status: "anonymous",
        });
      } finally {
        restoreInFlight = null;
      }
    })();

    return restoreInFlight;
  },

  /**
   * ---------------------------------------------------------
   * CLEAR SESSION
   * ---------------------------------------------------------
   */
  clear() {
    setTokens(null, null);

    set({
      user: null,
      status: "anonymous",
    });
  },
}));
