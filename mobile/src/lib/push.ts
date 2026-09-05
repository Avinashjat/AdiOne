/**
 * Push registration.
 *
 * Without this the whole notification pipeline is inert: the server queues
 * every order update correctly, but with no device token on file there is
 * nowhere to send them.
 *
 * Registration is best-effort. A customer who declines notifications must
 * still be able to shop, so nothing here throws into the caller.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { api } from "./api";

/** Banner + sound while the app is open, so a live order update is noticed. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registeredToken: string | null = null;

export async function registerForPush(): Promise<void> {
  try {
    // A simulator has no push service; asking would only produce an error.
    if (!Constants.isDevice) return;

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;

    // Only prompt if we have not been answered before — re-asking someone who
    // already said no is the fastest way to be uninstalled.
    if (status === "undetermined") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return;

    if (Platform.OS === "android") {
      // Android 8+ ignores notifications without a channel.
      await Notifications.setNotificationChannelAsync("orders", {
        name: "Order updates",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const projectId = Constants.expoConfig?.extra?.["eas"]?.["projectId"] as
      | string
      | undefined;
    const token = (
      await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      )
    ).data;

    // Re-posting the same token on every launch is wasted traffic on a
    // connection where every request costs the customer.
    if (token === registeredToken) return;

    await api.post("/devices", {
      token,
      platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
      appVersion: Constants.expoConfig?.version ?? "1.0.0",
    });

    registeredToken = token;
  } catch {
    // Silent: notifications are a convenience, not a requirement to shop.
  }
}

export function forgetPushRegistration(): void {
  registeredToken = null;
}
