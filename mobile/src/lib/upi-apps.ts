/**
 * Which UPI apps are on this phone, and how to hand the payment to one.
 *
 * WHY A PICKER AT ALL. A bare `upi://pay?...` opens the system chooser, which
 * on most Indian phones is a list of grey rows the customer has to read. The
 * target user here is often paying online for the first time; showing
 * "PhonePe" as a tappable tile they recognise is the difference between a
 * completed order and an abandoned one.
 *
 * WHY EACH APP'S OWN DEEP LINK, AND NOT A PACKAGE-TARGETED INTENT. Targeting
 * `upi://pay?...` at one Android package needs `Intent.setPackage`, which no
 * Expo API exposes: `expo-intent-launcher` honours `packageName` only when
 * `className` is also supplied, and hardcoding each app's private payment
 * activity would break on every app update. So both platforms take the same
 * route — the app's own `pay` URL carrying the standard UPI query string,
 * verbatim, exactly as the server built it.
 *
 * That is also why this catalogue is short. An app earns a tile only if it
 * publishes a deep link that accepts UPI parameters. WhatsApp, CRED, Amazon
 * Pay and every bank app do not, so they are reached through "Other UPI app",
 * which opens the real system chooser — the same place they work today.
 *
 * DETECTION IS BEST-EFFORT, ON PURPOSE. There is no supported way to ask
 * Android or iOS "is PhonePe installed" — we probe each app's URL scheme
 * instead, and third-party apps rename those between releases. A wrong scheme
 * therefore makes an app UNDETECTED, never broken: it drops off the grid and
 * stays reachable through the chooser.
 *
 * Both probes fail silently without the manifest declarations in
 * `plugins/withUpiQueries.js` — Android 11 package visibility and iOS
 * `LSApplicationQueriesSchemes`. Without them every probe below returns false
 * on a phone with all three major apps installed. The plugin reads the same
 * `upi-apps.json` this file does, so adding an app wires up both platforms.
 */

import { Linking } from 'react-native';
import catalogue from './upi-apps.json';

export interface UpiApp {
  /** Stable key — used as the React list key, never shown. */
  id: string;
  name: string;
  /** Only used to declare package visibility in the Android manifest. */
  androidPackage: string;
  /** URL schemes this app is known to register, tried in order when probing. */
  schemes: string[];
  /** The app's own deep link that accepts UPI parameters, on both platforms. */
  payUrl: string;
  /** Brand colour for the tile, so the grid is scannable by colour. */
  tint: string;
  /** Two-letter mark — avoids shipping (and licensing) app logos. */
  initials: string;
}

export const UPI_APPS: UpiApp[] = catalogue as UpiApp[];

async function isInstalled(app: UpiApp): Promise<boolean> {
  for (const scheme of app.schemes) {
    try {
      if (await Linking.canOpenURL(`${scheme}://`)) return true;
    } catch {
      // iOS throws on a scheme missing from LSApplicationQueriesSchemes rather
      // than returning false. That is a missing plugin entry, not a missing
      // app — try the next scheme.
    }
  }
  return false;
}

/**
 * Probes every catalogue entry in parallel and returns the ones that answered.
 * Never rejects: a phone with no UPI app is a normal outcome, handled by the
 * caller showing the chooser fallback instead of an error.
 */
export async function detectInstalledUpiApps(): Promise<UpiApp[]> {
  const found = await Promise.all(
    UPI_APPS.map(async (app) => ((await isInstalled(app)) ? app : null)),
  );
  return found.filter((app): app is UpiApp => app !== null);
}

/**
 * Opens `upiUrl` in one specific app.
 *
 * `upiUrl` is the server-built link — the amount and the shop's VPA come from
 * backend env and are never assembled here. Only the `upi://pay` prefix is
 * swapped for the app's own; every parameter after `?` is passed through
 * untouched.
 */
export async function openUpiApp(app: UpiApp, upiUrl: string): Promise<void> {
  const separator = upiUrl.indexOf('?');

  // No parameters means no payee and no amount — opening the app on its home
  // screen would look like it worked while paying nobody.
  if (separator === -1) {
    await Linking.openURL(upiUrl);
    return;
  }

  try {
    await Linking.openURL(`${app.payUrl}${upiUrl.slice(separator)}`);
  } catch {
    // The scheme answered the probe but refused this URL — usually a renamed
    // deep link. The chooser still knows how to handle a plain upi:// link, so
    // the customer can pay rather than hitting a dead end.
    await Linking.openURL(upiUrl);
  }
}

/** The system chooser — every UPI app on the phone, including bank apps. */
export async function openUpiChooser(upiUrl: string): Promise<void> {
  await Linking.openURL(upiUrl);
}

/** Whether any app at all can handle a `upi://` link. */
export async function hasAnyUpiApp(upiUrl: string): Promise<boolean> {
  try {
    return await Linking.canOpenURL(upiUrl);
  } catch {
    return false;
  }
}
