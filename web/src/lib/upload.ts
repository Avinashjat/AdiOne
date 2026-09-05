/**
 * Product image upload.
 *
 * Three steps, because image bytes never travel through the API's JSON body
 * (PRD §42):
 *   1. ask the API for an upload target
 *   2. PUT the raw bytes at it
 *   3. hand the resulting key back to the API to attach to a product
 *
 * Step 2 is the awkward one. With STORAGE_PROVIDER=local the target is our own
 * `/admin/uploads/direct` route, which is behind the admin auth gate and needs
 * the bearer token. With `s3` it is a presigned URL on another host, where
 * sending an Authorization header would break the signature. So the token goes
 * on only when the target is our own API.
 */

import { getAccessToken } from './api';

const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api/v1';

interface PresignedUpload {
  uploadUrl: string;
  key: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/** 5 MB — mirrors MAX_IMAGE_BYTES on the server, so we fail before uploading. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

export function validateImage(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return 'Please choose a JPEG, PNG or WebP image.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'Images must be 5 MB or smaller.';
  }
  return null;
}

/**
 * True when the upload target is our own API rather than object storage.
 *
 * Keyed on the PATH, not the origin. An earlier version compared origins and
 * broke the moment the API handed back a `localhost` upload URL while the panel
 * was pointed at a tunnel: the origins differed, the token was withheld as if
 * this were S3, and every upload 401'd. The route is ours by definition and a
 * presigned S3 URL never carries it, so the path is the reliable signal.
 */
function needsBearerToken(uploadUrl: string): boolean {
  try {
    const target = new URL(uploadUrl, window.location.origin);
    if (target.pathname.includes('/admin/uploads/direct')) return true;
    return target.origin === new URL(API_BASE, window.location.origin).origin;
  } catch {
    return false;
  }
}

/**
 * Uploads one image and returns the storage key.
 *
 * The key is meaningless on its own — call `POST /admin/product-images` with it
 * to attach it to a product, or it is simply orphaned bytes.
 */
export async function uploadProductImage(
  file: File,
  presign: (body: { fileName: string; contentType: string }) => Promise<PresignedUpload>,
): Promise<string> {
  const invalid = validateImage(file);
  if (invalid) throw new Error(invalid);

  const target = await presign({ fileName: file.name, contentType: file.type });

  const headers: Record<string, string> = {
    ...target.headers,
    'ngrok-skip-browser-warning': 'true',
  };
  const token = getAccessToken();
  if (token && needsBearerToken(target.uploadUrl)) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(target.uploadUrl, { method: 'PUT', headers, body: file });
  if (!response.ok) {
    // 401 here almost always means the API's own base URL is misconfigured, so
    // say that rather than "try again" — retrying cannot fix it.
    if (response.status === 401) {
      throw new Error(
        'The upload was rejected as unauthenticated. Check that API_BASE_URL in the ' +
          'backend .env matches the address this panel talks to, then restart the API.',
      );
    }
    throw new Error(`Could not upload the image (${response.status}). Please try again.`);
  }

  return target.key;
}
