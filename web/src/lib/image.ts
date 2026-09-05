/**
 * Image URLs for the browser.
 *
 * The API stores absolute image URLs built from STORAGE_PUBLIC_BASE_URL, which
 * points at whatever host serves the API. That is right for the mobile app,
 * but wrong for this panel in two ways:
 *
 *   1. An <img> tag cannot send custom headers, so it cannot send
 *      `ngrok-skip-browser-warning`. Behind a free ngrok tunnel the browser
 *      therefore receives the HTML interstitial instead of the image, and
 *      Chrome blocks it with ERR_BLOCKED_BY_ORB — a confusing error that
 *      looks like a storage problem but is a tunnelling one.
 *   2. A panel served over https loading images over http is mixed content.
 *
 * Both go away if the browser fetches images from its own origin, so the
 * absolute URL is rewritten to the bare `/static/...` path and whatever serves
 * the panel proxies it: the Vite dev server (see vite.config.ts) or Nginx in
 * production.
 */

/** Marker that identifies a URL as one of our stored images. */
const STATIC_SEGMENT = '/static/';

export function imageSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined;

  const index = url.indexOf(STATIC_SEGMENT);
  // Not one of ours (an external CDN URL, say) — leave it alone.
  if (index === -1) return url;

  return url.slice(index);
}
