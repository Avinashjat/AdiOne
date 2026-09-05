/**
 * ⚠️  GENERATED FILE — DO NOT EDIT.
 *
 * Copied from backend/src/shared by `npm run sync:shared`.
 * Edit the canonical file in backend/src/shared and re-run the sync.
 */

/** String, slug and identifier helpers. */

/** URL-safe slug: "Atta, Rice & Dal" -> "atta-rice-dal". */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Ambiguous characters (0/O, 1/I/L) removed — these get read out over a phone. */
const UNAMBIGUOUS_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomFrom(alphabet: string, length: number, random: () => number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet.charAt(Math.floor(random() * alphabet.length));
  }
  return out;
}

/**
 * Order number in the mockup's format: `AD` + YYMMDD + 6 random chars.
 * Random rather than sequential so competitors cannot infer daily volume, and
 * short enough to read aloud to support.
 */
export function generateOrderNumber(now: Date = new Date(), random: () => number = Math.random): string {
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `AD${yy}${mm}${dd}${randomFrom(UNAMBIGUOUS_ALPHABET, 6, random)}`;
}

export function generateReferralCode(random: () => number = Math.random): string {
  return `ADI${randomFrom(UNAMBIGUOUS_ALPHABET, 5, random)}`;
}

/** Numeric OTP of the requested length, using a caller-supplied RNG. */
export function generateNumericOtp(length: number, random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += Math.floor(random() * 10);
  return out;
}

/** "Near Shiv Mandir, Main Road, Sikar, Rajasthan 332001" from address parts. */
export function formatAddressLine(parts: {
  houseNo?: string | null;
  street?: string | null;
  area?: string | null;
  landmark?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}): string {
  const head = [
    parts.landmark ? `Near ${parts.landmark}` : null,
    parts.houseNo,
    parts.street,
    parts.area,
  ]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(', ');

  const tail = [parts.city, parts.state].filter(Boolean).join(', ');
  return [head, tail && parts.pincode ? `${tail} ${parts.pincode}` : tail]
    .filter(Boolean)
    .join(', ');
}

export function truncate(input: string, maxLength: number): string {
  return input.length <= maxLength ? input : `${input.slice(0, maxLength - 1)}…`;
}

/** Pluralises for UI copy: "2 items", "1 item". */
export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
