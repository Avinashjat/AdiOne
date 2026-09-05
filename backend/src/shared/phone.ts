/**
 * Indian mobile number handling.
 *
 * Canonical storage form is 10 digits with no country code, no spaces and no
 * punctuation. Users paste numbers in every conceivable format, so everything
 * is normalised on the way in and formatted on the way out.
 */

/** Indian mobile numbers are 10 digits and start with 6, 7, 8 or 9. */
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

/**
 * Strips spaces, dashes, brackets, a leading +91 / 91 / 0, and returns the
 * bare 10 digits. Returns null when the input cannot be a valid number.
 */
export function normalizeIndianMobile(input: string): string | null {
  if (!input) return null;
  let digits = input.replace(/\D/g, '');

  if (digits.length > 10) {
    if (digits.startsWith('91')) digits = digits.slice(2);
    else if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  }
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);

  return INDIAN_MOBILE_REGEX.test(digits) ? digits : null;
}

export function isValidIndianMobile(input: string): boolean {
  return normalizeIndianMobile(input) !== null;
}

/** E.164 form for SMS providers: "919876543210". */
export function toE164(mobile10: string, countryCode = '91'): string {
  return `${countryCode}${mobile10}`;
}

/** Display form matching the mockups: "+91 98765 43210". */
export function formatIndianMobile(mobile10: string): string {
  if (mobile10.length !== 10) return mobile10;
  return `+91 ${mobile10.slice(0, 5)} ${mobile10.slice(5)}`;
}

/**
 * Masked form for logs and support screens: "98765****10".
 * The logger redacts mobile numbers using this — a phone number is PII and
 * must never appear in full in a log line.
 */
export function maskMobile(mobile10: string): string {
  if (mobile10.length !== 10) return '**********';
  return `${mobile10.slice(0, 5)}****${mobile10.slice(8)}`;
}

/** Indian PIN codes are 6 digits and never start with 0. */
const PINCODE_REGEX = /^[1-9]\d{5}$/;

export function isValidPincode(pincode: string): boolean {
  return PINCODE_REGEX.test(pincode.trim());
}
