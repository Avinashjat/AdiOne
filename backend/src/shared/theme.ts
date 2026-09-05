/**
 * AdiOne design tokens.
 *
 * Derived from the approved mockups: a confident green on white, generous
 * rounding, pill buttons, and large readable type. The palette is the same for
 * mobile and admin so an order status pill looks identical to the store owner
 * and the customer.
 *
 * Design constraints carried from the brief:
 *   - large, readable text (first-time smartphone users)
 *   - high contrast (screens used outdoors, cheap panels)
 *   - obvious primary actions
 *   - no decorative animation
 */

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */

export const palette = {
  /** Brand green — the "One" in the logo, primary buttons, active tabs. */
  green50: '#F1F9F3',
  green100: '#DCF0E1',
  green200: '#B6E1C1',
  green300: '#84CC97',
  green400: '#4FB06C',
  green500: '#1E8E3E', // primary
  green600: '#17762F',
  green700: '#125C25',
  green800: '#0E441C', // logo "Adi" / darkest brand ink
  green900: '#0A2F14',

  /** Neutrals. */
  white: '#FFFFFF',
  grey50: '#F8FAF9',
  grey100: '#F1F3F2',
  grey200: '#E4E7E5',
  grey300: '#CBD1CD',
  grey400: '#9BA5A0',
  grey500: '#6B7671',
  grey600: '#4E5854',
  grey700: '#3A423E',
  grey800: '#252B28',
  grey900: '#141816',
  black: '#000000',

  /** Semantic accents. */
  red50: '#FEF2F2',
  red100: '#FDE3E4',
  red500: '#E5484D', // cancelled, destructive, out-of-service
  red600: '#C93B40',

  amber50: '#FFF8EB',
  amber100: '#FDECC8',
  amber500: '#F59E0B', // offers, warnings, "price changed"

  blue50: '#EFF6FF',
  blue100: '#DBEAFE',
  blue500: '#3B82F6', // informational ("Plan Ahead!")

  purple50: '#F5F3FF',
  purple500: '#8B5CF6', // secondary offer tiles
} as const;

/** Semantic colour roles — components reference these, never raw palette. */
export const colors = {
  primary: palette.green500,
  primaryDark: palette.green600,
  primaryDarker: palette.green700,
  primaryLight: palette.green100,
  primarySurface: palette.green50,
  onPrimary: palette.white,

  background: palette.white,
  surface: palette.white,
  surfaceMuted: palette.grey50,
  surfaceSunken: palette.grey100,

  border: palette.grey200,
  borderStrong: palette.grey300,
  divider: palette.grey100,

  textPrimary: palette.grey900,
  textSecondary: palette.grey500,
  textMuted: palette.grey400,
  textOnPrimary: palette.white,
  textLink: palette.green500,

  success: palette.green500,
  successSurface: palette.green50,
  danger: palette.red500,
  dangerSurface: palette.red50,
  warning: palette.amber500,
  warningSurface: palette.amber50,
  info: palette.blue500,
  infoSurface: palette.blue50,

  /** Discount badge on product cards ("12% OFF"). */
  discountBadge: palette.red500,
  discountBadgeText: palette.white,

  disabled: palette.grey200,
  disabledText: palette.grey400,

  overlay: 'rgba(20, 24, 22, 0.45)',
  skeleton: palette.grey100,
} as const;

/** Order-status colours, shared by the app badge and the admin pill. */
export const statusColors = {
  PENDING_PAYMENT: { bg: palette.amber50, fg: palette.amber500 },
  PAYMENT_CONFIRMED: { bg: palette.green50, fg: palette.green600 },
  ORDER_PLACED: { bg: palette.blue50, fg: palette.blue500 },
  STORE_ACCEPTED: { bg: palette.green50, fg: palette.green600 },
  PREPARING: { bg: palette.amber50, fg: palette.amber500 },
  READY_FOR_PICKUP: { bg: palette.green100, fg: palette.green700 },
  OUT_FOR_DELIVERY: { bg: palette.green100, fg: palette.green600 },
  DELIVERED: { bg: palette.green50, fg: palette.green600 },
  CANCELLED: { bg: palette.red50, fg: palette.red500 },
  PAYMENT_FAILED: { bg: palette.red50, fg: palette.red500 },
  REJECTED: { bg: palette.red50, fg: palette.red500 },
  REFUNDED: { bg: palette.grey100, fg: palette.grey600 },
} as const;

/* -------------------------------------------------------------------------- */
/* Spacing — 4px base grid                                                    */
/* -------------------------------------------------------------------------- */

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
} as const;

/** Consistent horizontal page padding on mobile. */
export const layout = {
  screenPaddingHorizontal: spacing.base,
  sectionGap: spacing.xl,
  cardGap: spacing.md,
  /** Bottom tab bar height, so scroll views can pad correctly. */
  tabBarHeight: 64,
  /** Sticky cart bar above the tab bar on the category screen. */
  stickyBarHeight: 64,
  /** Minimum touch target — important for the target device class. */
  minTouchTarget: 48,
  maxContentWidth: 1280,
} as const;

/* -------------------------------------------------------------------------- */
/* Radius                                                                     */
/* -------------------------------------------------------------------------- */

export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  xxl: 28,
  /** Pill buttons, as in every primary CTA in the mockups. */
  pill: 999,
  circle: 9999,
} as const;

/* -------------------------------------------------------------------------- */
/* Typography                                                                 */
/* -------------------------------------------------------------------------- */

export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  /** Web fallback stack for the admin panel. */
  webStack:
    "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
} as const;

export const fontSize = {
  xxs: 10,
  xs: 12,
  sm: 14,
  base: 16,
  md: 18,
  lg: 20,
  xl: 24,
  xxl: 28,
  xxxl: 34,
} as const;

export const lineHeight = {
  tight: 1.2,
  snug: 1.35,
  normal: 1.5,
  relaxed: 1.65,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Named text styles. Base body size is 16, not 14 — the brief calls for large
 * readable text for village and small-town users, and 14pt body is the single
 * most common accessibility failure in Indian consumer apps.
 */
export const typography = {
  displayLarge: { fontSize: fontSize.xxxl, fontWeight: fontWeight.bold, lineHeight: lineHeight.tight },
  display: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, lineHeight: lineHeight.tight },
  h1: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, lineHeight: lineHeight.snug },
  h2: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, lineHeight: lineHeight.snug },
  h3: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, lineHeight: lineHeight.snug },
  bodyLarge: { fontSize: fontSize.base, fontWeight: fontWeight.regular, lineHeight: lineHeight.normal },
  body: { fontSize: fontSize.sm, fontWeight: fontWeight.regular, lineHeight: lineHeight.normal },
  bodyStrong: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, lineHeight: lineHeight.normal },
  caption: { fontSize: fontSize.xs, fontWeight: fontWeight.regular, lineHeight: lineHeight.snug },
  overline: { fontSize: fontSize.xxs, fontWeight: fontWeight.semibold, lineHeight: lineHeight.snug },
  button: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, lineHeight: lineHeight.tight },
  price: { fontSize: fontSize.md, fontWeight: fontWeight.bold, lineHeight: lineHeight.tight },
} as const;

/* -------------------------------------------------------------------------- */
/* Elevation                                                                  */
/* -------------------------------------------------------------------------- */

/** Deliberately subtle — the mockups use borders and tints far more than shadow. */
export const shadow = {
  none: { shadowColor: 'transparent', shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  sm: {
    shadowColor: palette.grey900,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowColor: palette.grey900,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: palette.grey900,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
} as const;

/* -------------------------------------------------------------------------- */
/* Motion                                                                     */
/* -------------------------------------------------------------------------- */

/** Short and functional. The brief explicitly asks to avoid animation flourish. */
export const duration = {
  instant: 0,
  fast: 120,
  normal: 200,
  slow: 320,
} as const;

export const theme = {
  palette,
  colors,
  statusColors,
  spacing,
  layout,
  radius,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  typography,
  shadow,
  duration,
} as const;

export type Theme = typeof theme;
