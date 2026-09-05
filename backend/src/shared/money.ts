/**
 * Money helpers.
 *
 * INVARIANT: every monetary amount in this system is an integer number of
 * paise. ₹290.00 is `29000`. Floating-point rupees never exist — not in the
 * database, not on the wire, not in a variable.
 *
 * Rounding is applied at exactly one point: wherever a percentage is taken.
 * Everything else is integer arithmetic and therefore exact.
 */

/** ₹1 = 100 paise. */
export const PAISE_PER_RUPEE = 100;

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * PAISE_PER_RUPEE);
}

export function paiseToRupees(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

/**
 * Half-up rounding. JavaScript's `Math.round` rounds -0.5 to -0, which is the
 * wrong behaviour for money; amounts here are non-negative but this stays
 * explicit so the rule is auditable.
 */
export function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** `percent` is a plain percentage (15 means 15%). Result in paise. */
export function percentOfPaise(amountPaise: number, percent: number): number {
  return roundHalfUp((amountPaise * percent) / 100);
}

/**
 * Formats paise as Indian currency: 29000 -> "₹290".
 * Paise are shown only when the amount is not a whole rupee, which matches how
 * prices are displayed on Indian retail packaging.
 */
export function formatPaise(paise: number, opts?: { alwaysShowDecimals?: boolean }): string {
  const rupees = paiseToRupees(paise);
  const hasFraction = paise % PAISE_PER_RUPEE !== 0;
  const showDecimals = opts?.alwaysShowDecimals ?? hasFraction;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(rupees);
}

/** Formats without the currency symbol: 29000 -> "290". */
export function formatPaiseNumber(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(paiseToRupees(paise));
}

/**
 * Discount percentage shown on product cards ("12% OFF").
 * Floored, so we never advertise a discount larger than the one given.
 */
export function discountPercent(mrpPaise: number, pricePaise: number): number {
  if (mrpPaise <= 0 || pricePaise >= mrpPaise) return 0;
  return Math.floor(((mrpPaise - pricePaise) / mrpPaise) * 100);
}

/**
 * Extracts the tax already contained in a tax-inclusive amount.
 *
 * Indian retail prices are inclusive of GST ("MRP incl. of all taxes"), so tax
 * is DERIVED for display, never ADDED at checkout. Adding it on top would
 * double-charge the customer — see PRD §2.1 C10.
 *
 * @param rateBasisPoints GST rate in basis points (5% = 500, 18% = 1800).
 */
export function extractInclusiveTaxPaise(
  inclusiveAmountPaise: number,
  rateBasisPoints: number,
): number {
  if (rateBasisPoints <= 0) return 0;
  return roundHalfUp((inclusiveAmountPaise * rateBasisPoints) / (10000 + rateBasisPoints));
}

/** The pre-tax portion of a tax-inclusive amount. */
export function taxableBasePaise(
  inclusiveAmountPaise: number,
  rateBasisPoints: number,
): number {
  return inclusiveAmountPaise - extractInclusiveTaxPaise(inclusiveAmountPaise, rateBasisPoints);
}

/** Clamps to a non-negative integer — a defensive guard for computed money. */
export function toPositivePaise(value: number): number {
  return Math.max(0, Math.trunc(value));
}
