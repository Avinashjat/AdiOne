/**
 * Demo seed — development and staging ONLY. Never runs in production.
 *
 * Sample catalogue matching the mockups (Aashirvaad Atta 5 kg at ₹249, Tata
 * Salt 1 kg at ₹20, and so on) so the app has real-looking data to render
 * from the first screen onwards.
 *
 * Prices are in PAISE. ₹249 -> 24900.
 *
 * `searchKeywords` carries local and colloquial names — "cheeni", "namak",
 * "doodh", "atta". In this market a customer is far more likely to type those
 * than the English product name, and it costs nothing to index them
 * (docs/02-decisions.md D11).
 */

import { PrismaClient } from '@prisma/client';
import {
  CodPolicy,
  CouponType,
  ProductStatus,
  UnitType,
} from '../../src/shared';
import { slugify } from '../../src/shared/text';

interface VariantSeed {
  variantName: string;
  unit: UnitType;
  unitValue: number;
  mrpPaise: number;
  pricePaise: number;
  stockQty: number;
  isDefault?: boolean;
  maxQtyPerOrder?: number;
}

interface ProductSeed {
  name: string;
  nameHi: string;
  brand: string | null;
  category: string;
  description: string;
  keywords: string[];
  /** GST in basis points. Most staple grocery is 0% or 5% in India. */
  taxRateBp: number;
  isDailyEssential?: boolean;
  popularityScore?: number;
  attributes?: Record<string, string | number | boolean>;
  variants: VariantSeed[];
}

const BRANDS = [
  'Aashirvaad',
  'Tata Sampann',
  'India Gate',
  'Fortune',
  'Tata',
  'Nescafe',
  'Parle',
  'Amul',
  'Everest',
  'Maggi',
  'Surf Excel',
  'Dettol',
  'Colgate',
  "Johnson's",
  'Madhur',
];

const PRODUCTS: ProductSeed[] = [
  {
    name: 'Aashirvaad Shudh Chakki Atta',
    nameHi: 'आशीर्वाद शुद्ध चक्की आटा',
    brand: 'Aashirvaad',
    category: 'Atta, Rice & Dal',
    description: 'Whole wheat flour milled from 100% MP wheat. Soft rotis every time.',
    keywords: ['atta', 'aata', 'gehu', 'wheat flour', 'chakki'],
    taxRateBp: 0,
    isDailyEssential: true,
    popularityScore: 980,
    attributes: { shelfLife: '4 months', storage: 'Cool and dry place', countryOfOrigin: 'India' },
    variants: [
      { variantName: '5 kg', unit: UnitType.KG, unitValue: 5, mrpPaise: 28500, pricePaise: 24900, stockQty: 40, isDefault: true },
      { variantName: '10 kg', unit: UnitType.KG, unitValue: 10, mrpPaise: 55000, pricePaise: 48500, stockQty: 18, maxQtyPerOrder: 3 },
    ],
  },
  {
    name: 'Tata Sampann Basmati Rice',
    nameHi: 'टाटा संपन्न बासमती चावल',
    brand: 'Tata Sampann',
    category: 'Atta, Rice & Dal',
    description: 'Long-grain aged basmati rice. Fluffy, aromatic, non-sticky.',
    keywords: ['rice', 'chawal', 'basmati', 'chaval'],
    taxRateBp: 500,
    isDailyEssential: true,
    popularityScore: 910,
    attributes: { shelfLife: '12 months', countryOfOrigin: 'India' },
    variants: [
      { variantName: '1 kg', unit: UnitType.KG, unitValue: 1, mrpPaise: 13500, pricePaise: 12000, stockQty: 55, isDefault: true },
      { variantName: '5 kg', unit: UnitType.KG, unitValue: 5, mrpPaise: 64000, pricePaise: 57500, stockQty: 12 },
    ],
  },
  {
    name: 'India Gate Classic Basmati Rice',
    nameHi: 'इंडिया गेट क्लासिक बासमती चावल',
    brand: 'India Gate',
    category: 'Atta, Rice & Dal',
    description: 'Premium aged basmati, ideal for biryani and pulao.',
    keywords: ['rice', 'chawal', 'basmati', 'biryani rice'],
    taxRateBp: 500,
    popularityScore: 840,
    variants: [
      { variantName: '5 kg', unit: UnitType.KG, unitValue: 5, mrpPaise: 48500, pricePaise: 44500, stockQty: 15, isDefault: true },
    ],
  },
  {
    name: 'Toor Dal (Arhar)',
    nameHi: 'तूर दाल (अरहर)',
    brand: 'Tata Sampann',
    category: 'Atta, Rice & Dal',
    description: 'Unpolished toor dal, rich in protein.',
    keywords: ['dal', 'daal', 'toor', 'arhar', 'pulses', 'tur'],
    taxRateBp: 0,
    isDailyEssential: true,
    popularityScore: 760,
    variants: [
      { variantName: '1 kg', unit: UnitType.KG, unitValue: 1, mrpPaise: 18000, pricePaise: 16500, stockQty: 30, isDefault: true },
      { variantName: '500 g', unit: UnitType.G, unitValue: 500, mrpPaise: 9500, pricePaise: 8800, stockQty: 42 },
    ],
  },
  {
    name: 'Fortune Sunlite Refined Sunflower Oil',
    nameHi: 'फॉर्च्यून सनलाइट रिफाइंड सनफ्लावर तेल',
    brand: 'Fortune',
    category: 'Oil & Ghee',
    description: 'Light, healthy refined sunflower oil for everyday cooking.',
    keywords: ['oil', 'tel', 'sunflower', 'refined', 'cooking oil'],
    taxRateBp: 500,
    isDailyEssential: true,
    popularityScore: 950,
    variants: [
      { variantName: '1 L', unit: UnitType.L, unitValue: 1, mrpPaise: 16000, pricePaise: 14500, stockQty: 60, isDefault: true },
      { variantName: '5 L', unit: UnitType.L, unitValue: 5, mrpPaise: 78000, pricePaise: 70500, stockQty: 10, maxQtyPerOrder: 2 },
    ],
  },
  {
    name: 'Tata Salt',
    nameHi: 'टाटा नमक',
    brand: 'Tata',
    category: 'Masala & Spices',
    description: 'Vacuum-evaporated iodised salt. Desh ka namak.',
    keywords: ['salt', 'namak', 'iodised', 'nimak'],
    taxRateBp: 0,
    isDailyEssential: true,
    popularityScore: 990,
    variants: [
      { variantName: '1 kg', unit: UnitType.KG, unitValue: 1, mrpPaise: 2400, pricePaise: 2000, stockQty: 120, isDefault: true },
    ],
  },
  {
    name: 'Everest Turmeric Powder',
    nameHi: 'एवरेस्ट हल्दी पाउडर',
    brand: 'Everest',
    category: 'Masala & Spices',
    description: 'Pure ground turmeric with rich colour and aroma.',
    keywords: ['haldi', 'turmeric', 'masala', 'spice'],
    taxRateBp: 500,
    popularityScore: 700,
    variants: [
      { variantName: '100 g', unit: UnitType.G, unitValue: 100, mrpPaise: 4200, pricePaise: 3800, stockQty: 48, isDefault: true },
      { variantName: '200 g', unit: UnitType.G, unitValue: 200, mrpPaise: 8000, pricePaise: 7200, stockQty: 25 },
    ],
  },
  {
    name: 'Madhur Sugar',
    nameHi: 'मधुर चीनी',
    brand: 'Madhur',
    category: 'Sweeteners',
    description: 'Refined sulphur-free sugar crystals.',
    keywords: ['sugar', 'cheeni', 'chini', 'shakkar'],
    taxRateBp: 500,
    isDailyEssential: true,
    popularityScore: 880,
    variants: [
      { variantName: '1 kg', unit: UnitType.KG, unitValue: 1, mrpPaise: 5500, pricePaise: 4900, stockQty: 70, isDefault: true },
      { variantName: '5 kg', unit: UnitType.KG, unitValue: 5, mrpPaise: 26500, pricePaise: 23500, stockQty: 14 },
    ],
  },
  {
    name: 'Tata Tea Premium',
    nameHi: 'टाटा टी प्रीमियम',
    brand: 'Tata',
    category: 'Tea, Coffee & Drinks',
    description: 'Rich, full-bodied Assam tea blend for a strong cup.',
    keywords: ['tea', 'chai', 'chai patti', 'assam'],
    taxRateBp: 500,
    isDailyEssential: true,
    popularityScore: 930,
    variants: [
      { variantName: '250 g', unit: UnitType.G, unitValue: 250, mrpPaise: 17500, pricePaise: 16000, stockQty: 50, isDefault: true },
      { variantName: '500 g', unit: UnitType.G, unitValue: 500, mrpPaise: 34000, pricePaise: 31000, stockQty: 22 },
    ],
  },
  {
    name: 'Nescafe Classic Instant Coffee',
    nameHi: 'नेस्कैफे क्लासिक इंस्टेंट कॉफी',
    brand: 'Nescafe',
    category: 'Tea, Coffee & Drinks',
    description: '100% pure instant coffee. Rich aroma, smooth taste.',
    keywords: ['coffee', 'kaafi', 'nescafe', 'instant coffee'],
    taxRateBp: 1800,
    popularityScore: 820,
    variants: [
      { variantName: '50 g', unit: UnitType.G, unitValue: 50, mrpPaise: 13500, pricePaise: 12000, stockQty: 35, isDefault: true },
    ],
  },
  {
    name: 'Parle-G Original Glucose Biscuits',
    nameHi: 'पारले-जी ओरिजिनल ग्लूकोज बिस्कुट',
    brand: 'Parle',
    category: 'Biscuits & Snacks',
    description: 'The classic glucose biscuit. Perfect with chai.',
    keywords: ['biscuit', 'biscuits', 'parle g', 'glucose', 'bikkis'],
    taxRateBp: 1800,
    isDailyEssential: true,
    popularityScore: 970,
    variants: [
      { variantName: '200 g', unit: UnitType.G, unitValue: 200, mrpPaise: 2200, pricePaise: 2000, stockQty: 150, isDefault: true },
      { variantName: '800 g Family Pack', unit: UnitType.G, unitValue: 800, mrpPaise: 8500, pricePaise: 8000, stockQty: 30 },
    ],
  },
  {
    name: 'Amul Taaza Toned Milk',
    nameHi: 'अमूल ताज़ा टोंड दूध',
    brand: 'Amul',
    category: 'Milk & Dairy',
    description: 'Homogenised toned milk, UHT treated. No refrigeration until opened.',
    keywords: ['milk', 'doodh', 'dudh', 'amul', 'taaza'],
    taxRateBp: 0,
    isDailyEssential: true,
    popularityScore: 985,
    attributes: { shelfLife: '90 days unopened', storage: 'Refrigerate after opening' },
    variants: [
      { variantName: '1 L', unit: UnitType.L, unitValue: 1, mrpPaise: 6600, pricePaise: 6000, stockQty: 80, isDefault: true },
      { variantName: '500 ml', unit: UnitType.ML, unitValue: 500, mrpPaise: 3400, pricePaise: 3100, stockQty: 95 },
    ],
  },
  {
    name: 'Maggi 2-Minute Masala Noodles',
    nameHi: 'मैगी 2-मिनट मसाला नूडल्स',
    brand: 'Maggi',
    category: 'Noodles & Pasta',
    description: 'Instant masala noodles ready in two minutes.',
    keywords: ['maggi', 'noodles', 'instant noodles', 'magi'],
    taxRateBp: 1200,
    popularityScore: 960,
    variants: [
      { variantName: '70 g', unit: UnitType.G, unitValue: 70, mrpPaise: 1400, pricePaise: 1400, stockQty: 200, isDefault: true },
      { variantName: 'Pack of 4', unit: UnitType.PACK, unitValue: 4, mrpPaise: 5600, pricePaise: 5200, stockQty: 60 },
    ],
  },
  {
    name: 'Surf Excel Easy Wash Detergent Powder',
    nameHi: 'सर्फ एक्सेल ईज़ी वॉश डिटर्जेंट पाउडर',
    brand: 'Surf Excel',
    category: 'Household Care',
    description: 'Removes tough stains in one wash. Suitable for hand and machine wash.',
    keywords: ['detergent', 'surf', 'washing powder', 'kapde dhone ka powder', 'sabun'],
    taxRateBp: 1800,
    popularityScore: 720,
    variants: [
      { variantName: '1 kg', unit: UnitType.KG, unitValue: 1, mrpPaise: 13500, pricePaise: 12000, stockQty: 40, isDefault: true },
      { variantName: '500 g', unit: UnitType.G, unitValue: 500, mrpPaise: 7000, pricePaise: 6400, stockQty: 55 },
    ],
  },
  {
    name: 'Dettol Original Liquid Handwash',
    nameHi: 'डेटॉल ओरिजिनल लिक्विड हैंडवॉश',
    brand: 'Dettol',
    category: 'Personal Care',
    description: 'Kills 99.9% of germs. Refill pouch available.',
    keywords: ['handwash', 'dettol', 'soap', 'hand wash', 'sabun'],
    taxRateBp: 1800,
    popularityScore: 640,
    variants: [
      { variantName: '200 ml', unit: UnitType.ML, unitValue: 200, mrpPaise: 9900, pricePaise: 8500, stockQty: 45, isDefault: true },
    ],
  },
  {
    name: 'Colgate Strong Teeth Toothpaste',
    nameHi: 'कोलगेट स्ट्रॉन्ग टीथ टूथपेस्ट',
    brand: 'Colgate',
    category: 'Personal Care',
    description: 'Calcium-boost formula for stronger teeth.',
    keywords: ['toothpaste', 'colgate', 'manjan', 'paste', 'dant'],
    taxRateBp: 1800,
    popularityScore: 750,
    variants: [
      { variantName: '100 g', unit: UnitType.G, unitValue: 100, mrpPaise: 5500, pricePaise: 4900, stockQty: 65, isDefault: true },
      { variantName: '200 g', unit: UnitType.G, unitValue: 200, mrpPaise: 10500, pricePaise: 9400, stockQty: 28 },
    ],
  },
  {
    name: "Johnson's Baby Soap",
    nameHi: 'जॉनसन बेबी साबुन',
    brand: "Johnson's",
    category: 'Baby Care',
    description: 'Gentle cleansing soap enriched with milk protein.',
    keywords: ['baby soap', 'johnson', 'sabun', 'baccha'],
    taxRateBp: 1800,
    popularityScore: 520,
    variants: [
      { variantName: '75 g', unit: UnitType.G, unitValue: 75, mrpPaise: 6500, pricePaise: 5900, stockQty: 38, isDefault: true },
    ],
  },
];

const COUPONS = [
  {
    code: 'ADIFIRST',
    description: '15% off your first order, up to ₹75',
    type: CouponType.PERCENT,
    discountValue: 15,
    maxDiscountPaise: 7500,
    minOrderPaise: 19900,
    usageLimitPerUser: 1,
  },
  {
    code: 'SAVE50',
    description: '₹50 off orders above ₹499',
    type: CouponType.FLAT,
    discountValue: 5000,
    maxDiscountPaise: null,
    minOrderPaise: 49900,
    usageLimitPerUser: 3,
  },
  {
    code: 'FREESHIP',
    description: 'Free delivery on orders above ₹199',
    type: CouponType.FREE_DELIVERY,
    discountValue: 0,
    maxDiscountPaise: null,
    minOrderPaise: 19900,
    usageLimitPerUser: 5,
  },
];

export async function seedDemoCatalog(
  prisma: PrismaClient,
  storeId: string,
  categoryIds: Map<string, string>,
): Promise<void> {
  // --- brands --------------------------------------------------------------
  const brandIds = new Map<string, string>();
  for (const name of BRANDS) {
    const brand = await prisma.brand.upsert({
      where: { slug: slugify(name) },
      update: {},
      create: { name, slug: slugify(name) },
    });
    brandIds.set(name, brand.id);
  }
  console.log(`  ✓ brands: ${BRANDS.length}`);

  // --- products, variants, store offers ------------------------------------
  let productCount = 0;
  let variantCount = 0;

  for (const seed of PRODUCTS) {
    const categoryId = categoryIds.get(seed.category);
    if (!categoryId) {
      console.warn(`  ! skipping "${seed.name}" — unknown category "${seed.category}"`);
      continue;
    }

    const slug = slugify(seed.name);

    // Brand name goes into the keyword list as well, so a search for "amul"
    // matches through the product's own search vector without a join.
    const keywords = seed.brand
      ? [...seed.keywords, seed.brand.toLowerCase()]
      : seed.keywords;

    const existing = await prisma.product.findFirst({ where: { slug } });

    const product = existing
      ? await prisma.product.update({
          where: { id: existing.id },
          data: { status: ProductStatus.ACTIVE },
        })
      : await prisma.product.create({
          data: {
            name: seed.name,
            nameHi: seed.nameHi,
            slug,
            description: seed.description,
            categoryId,
            brandId: seed.brand ? (brandIds.get(seed.brand) ?? null) : null,
            searchKeywords: keywords,
            taxRateBp: seed.taxRateBp,
            status: ProductStatus.ACTIVE,
            allowCod: CodPolicy.INHERIT,
            attributes: seed.attributes ?? {},
            isDailyEssential: seed.isDailyEssential ?? false,
            popularityScore: seed.popularityScore ?? 0,
          },
        });
    productCount += 1;

    for (const [index, variantSeed] of seed.variants.entries()) {
      // SKU is derived so re-running the seed is idempotent.
      const sku = `${slugify(seed.brand ?? 'adione')}-${slug}-${slugify(variantSeed.variantName)}`
        .toUpperCase()
        .slice(0, 60);

      const variant = await prisma.productVariant.upsert({
        where: { productId_variantName: { productId: product.id, variantName: variantSeed.variantName } },
        update: {},
        create: {
          productId: product.id,
          sku,
          variantName: variantSeed.variantName,
          unit: variantSeed.unit,
          unitValue: variantSeed.unitValue,
          isDefault: variantSeed.isDefault ?? index === 0,
          displayOrder: index,
          status: ProductStatus.ACTIVE,
          allowCod: CodPolicy.INHERIT,
        },
      });
      variantCount += 1;

      // The sellable offer: this variant, in this store, at this price, with
      // this much stock.
      await prisma.storeVariant.upsert({
        where: { storeId_variantId: { storeId, variantId: variant.id } },
        update: {},
        create: {
          storeId,
          variantId: variant.id,
          mrpPaise: variantSeed.mrpPaise,
          pricePaise: variantSeed.pricePaise,
          stockQty: variantSeed.stockQty,
          reservedQty: 0,
          maxQtyPerOrder: variantSeed.maxQtyPerOrder ?? 10,
          lowStockThreshold: 5,
          isAvailable: true,
          allowCod: CodPolicy.INHERIT,
        },
      });
    }
  }

  console.log(`  ✓ products: ${productCount}`);
  console.log(`  ✓ variants + store offers: ${variantCount}`);

  // --- coupons -------------------------------------------------------------
  for (const coupon of COUPONS) {
    await prisma.coupon.upsert({
      where: { code: coupon.code },
      update: {},
      create: {
        code: coupon.code,
        description: coupon.description,
        type: coupon.type,
        discountValue: coupon.discountValue,
        maxDiscountPaise: coupon.maxDiscountPaise,
        minOrderPaise: coupon.minOrderPaise,
        usageLimitPerUser: coupon.usageLimitPerUser,
        isActive: true,
      },
    });
  }
  console.log(`  ✓ coupons: ${COUPONS.length}`);

  // --- delivery agents -----------------------------------------------------
  const agents = [
    { name: 'Ramesh Kumar', mobile: '9876500001', vehicleNumber: 'RJ23 AB 1234' },
    { name: 'Suresh Meena', mobile: '9876500002', vehicleNumber: 'RJ23 CD 5678' },
  ];
  for (const agent of agents) {
    await prisma.deliveryAgent.upsert({
      where: { mobile: agent.mobile },
      update: {},
      create: { ...agent, storeId, isActive: true, isAvailable: true },
    });
  }
  console.log(`  ✓ delivery agents: ${agents.length}`);
}
