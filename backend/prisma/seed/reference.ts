/**
 * Reference seed — runs in EVERY environment, including production.
 *
 * Idempotent by construction: every write is an upsert keyed on a natural key,
 * so re-running never duplicates and never clobbers a value an admin has since
 * changed through the panel (except where noted).
 *
 * Contains: business configuration, the store, its opening hours, the category
 * tree, and the bootstrap admin login.
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import {
  CONFIG_DEFAULTS,
  CONFIG_DESCRIPTIONS,
  ConfigKey,
  PUBLIC_CONFIG_KEYS,
  CatalogVertical,
  UserRole,
} from '../../src/shared';
import { slugify } from '../../src/shared/text';
import { hashPassword } from '../../src/common/crypto';

/**
 * V1 store. Coordinates and contact details are PLACEHOLDERS taken from the
 * mockups (Sikar, Rajasthan 332001) and are expected to be replaced with the
 * real shop's values from the admin Configuration screen — no redeploy needed.
 */
export const STORE = {
  code: 'ADIONE-SIKAR-01',
  name: 'AdiOne Store — Sikar',
  addressLine: 'Main Road, Near Shiv Mandir',
  city: 'Sikar',
  state: 'Rajasthan',
  pincode: '332001',
  latitude: 27.6094,
  longitude: 75.1399,
  phone: '9876543210',
  timezone: 'Asia/Kolkata',
} as const;

/** 8 AM – 10 PM daily, matching the Store Closed mockup. */
const STORE_HOURS = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  opensAt: '08:00',
  closesAt: '22:00',
  isClosed: false,
}));

/**
 * Category tree.
 *
 * depth 0 = the Home category row. depth 1 = the category-screen sidebar,
 * matching the mockup exactly.
 *
 * Only GROCERY is seeded for V1. Vegetables, Fruits, Dairy and later verticals
 * are added as data when their phase arrives — no schema change, no code change
 * (see docs/02-decisions.md D2).
 */
const CATEGORY_TREE: {
  name: string;
  nameHi: string;
  vertical: CatalogVertical;
  children: { name: string; nameHi: string }[];
}[] = [
  {
    name: 'Grocery',
    nameHi: 'किराना',
    vertical: CatalogVertical.GROCERY,
    children: [
      { name: 'Atta, Rice & Dal', nameHi: 'आटा, चावल और दाल' },
      { name: 'Oil & Ghee', nameHi: 'तेल और घी' },
      { name: 'Masala & Spices', nameHi: 'मसाले' },
      { name: 'Tea, Coffee & Drinks', nameHi: 'चाय, कॉफी और पेय' },
      { name: 'Biscuits & Snacks', nameHi: 'बिस्किट और नाश्ता' },
      { name: 'Milk & Dairy', nameHi: 'दूध और डेयरी' },
      { name: 'Noodles & Pasta', nameHi: 'नूडल्स और पास्ता' },
      { name: 'Sauces & Spreads', nameHi: 'सॉस और स्प्रेड' },
      { name: 'Sweeteners', nameHi: 'चीनी और मिठास' },
      { name: 'Packaged Food', nameHi: 'पैकेज्ड फूड' },
      { name: 'Household Care', nameHi: 'घरेलू सामान' },
      { name: 'Personal Care', nameHi: 'व्यक्तिगत देखभाल' },
      { name: 'Baby Care', nameHi: 'शिशु देखभाल' },
    ],
  },
];

/**
 * Writes a GLOBAL configuration row (store_id IS NULL).
 *
 * Find-then-write rather than `upsert`, because Prisma cannot target a
 * compound unique that contains a NULL. Uniqueness is still guaranteed by the
 * partial index `configurations_global_key_unique` — see the
 * null_scope_unique migration.
 *
 * Existing rows keep their VALUE: re-running the seed must never revert a
 * radius or a delivery fee the owner has since tuned in the admin panel. Only
 * the description and visibility flag are refreshed.
 */
async function upsertGlobalConfig(
  prisma: PrismaClient,
  key: ConfigKey,
  value: unknown,
  options: { fillIfBlank?: boolean } = {},
): Promise<void> {
  const isPublic = (PUBLIC_CONFIG_KEYS as readonly string[]).includes(key);
  const description = CONFIG_DESCRIPTIONS[key];

  const existing = await prisma.configuration.findFirst({
    where: { key, storeId: null },
    select: { id: true, value: true },
  });

  if (existing) {
    // `fillIfBlank` covers keys that are seeded twice: CONFIG_DEFAULTS writes a
    // deliberately empty placeholder (SUPPORT_PHONE has no sensible default),
    // and the store seed then supplies the real value. Without this, the empty
    // string would win and Help & Support would show no contact number.
    // A value the owner has actually set is still never overwritten.
    const isBlank = existing.value === null || existing.value === '';
    const shouldFill = options.fillIfBlank === true && isBlank;

    await prisma.configuration.update({
      where: { id: existing.id },
      data: {
        description,
        isPublic,
        ...(shouldFill ? { value: value as Prisma.InputJsonValue } : {}),
      },
    });
    return;
  }

  await prisma.configuration.create({
    data: {
      key,
      storeId: null,
      value: value as Prisma.InputJsonValue,
      description,
      isPublic,
    },
  });
}

export async function seedConfiguration(prisma: PrismaClient): Promise<void> {
  const entries = Object.entries(CONFIG_DEFAULTS) as [ConfigKey, unknown][];

  for (const [key, value] of entries) {
    await upsertGlobalConfig(prisma, key, value);
  }

  console.log(`  ✓ configuration: ${entries.length} keys`);
}

export async function seedStore(prisma: PrismaClient): Promise<string> {
  const store = await prisma.store.upsert({
    where: { code: STORE.code },
    update: {},
    create: {
      code: STORE.code,
      name: STORE.name,
      addressLine: STORE.addressLine,
      city: STORE.city,
      state: STORE.state,
      pincode: STORE.pincode,
      latitude: STORE.latitude,
      longitude: STORE.longitude,
      phone: STORE.phone,
      timezone: STORE.timezone,
      isActive: true,
    },
  });

  for (const hours of STORE_HOURS) {
    await prisma.storeHours.upsert({
      where: { storeId_dayOfWeek: { storeId: store.id, dayOfWeek: hours.dayOfWeek } },
      update: {},
      create: { storeId: store.id, ...hours },
    });
  }

  // Store contact details drive the app's Help & Support screen.
  for (const [key, value] of [
    [ConfigKey.SUPPORT_PHONE, STORE.phone],
    [ConfigKey.SUPPORT_WHATSAPP, STORE.phone],
    [ConfigKey.STORE_TIMEZONE, STORE.timezone],
  ] as const) {
    await upsertGlobalConfig(prisma, key, value, { fillIfBlank: true });
  }

  console.log(`  ✓ store: ${store.name} (${STORE.latitude}, ${STORE.longitude})`);
  console.log(`  ✓ store hours: 08:00–22:00, 7 days`);
  return store.id;
}

/** Returns a map of category name -> id, so the catalog seed can attach products. */
export async function seedCategories(prisma: PrismaClient): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  let count = 0;

  for (const [rootIndex, root] of CATEGORY_TREE.entries()) {
    const rootSlug = slugify(root.name);

    // Root categories have parent_id NULL, which a compound unique cannot
    // target in Prisma. Uniqueness is enforced by the partial index
    // `categories_root_slug_unique`.
    const rootCategory =
      (await prisma.category.findFirst({
        where: { parentId: null, slug: rootSlug, deletedAt: null },
      })) ??
      (await prisma.category.create({
        data: {
          name: root.name,
          nameHi: root.nameHi,
          slug: rootSlug,
          path: rootSlug,
          depth: 0,
          parentId: null,
          vertical: root.vertical,
          displayOrder: rootIndex,
          isActive: true,
        },
      }));
    ids.set(root.name, rootCategory.id);
    count += 1;

    for (const [childIndex, child] of root.children.entries()) {
      const childSlug = slugify(child.name);
      const childCategory = await prisma.category.upsert({
        where: { parentId_slug: { parentId: rootCategory.id, slug: childSlug } },
        update: {},
        create: {
          name: child.name,
          nameHi: child.nameHi,
          slug: childSlug,
          // Materialised path: "grocery/atta-rice-dal". Turns "everything under
          // Grocery" into an indexed prefix scan.
          path: `${rootSlug}/${childSlug}`,
          depth: 1,
          parentId: rootCategory.id,
          vertical: root.vertical,
          displayOrder: childIndex,
          isActive: true,
        },
      });
      ids.set(child.name, childCategory.id);
      count += 1;
    }
  }

  console.log(`  ✓ categories: ${count} (1 root + ${count - 1} subcategories)`);
  return ids;
}

export async function seedAdminUser(
  prisma: PrismaClient,
  input: { email: string; password: string; name: string },
): Promise<void> {
  const existing = await prisma.user.findFirst({
    where: { email: input.email.toLowerCase() },
  });

  if (existing) {
    console.log(`  ✓ admin user already present: ${input.email}`);
    return;
  }

  // The admin row still needs a mobile (the column is unique and NOT NULL, as
  // mobile is the identity for every customer). A reserved non-dialable value
  // is used so it can never collide with a real Indian number.
  await prisma.user.create({
    data: {
      mobile: '0000000001',
      email: input.email.toLowerCase(),
      fullName: input.name,
      passwordHash: await hashPassword(input.password),
      role: UserRole.STORE_OWNER,
    },
  });

  console.log(`  ✓ admin user: ${input.email}  (CHANGE THIS PASSWORD AFTER FIRST LOGIN)`);
}
