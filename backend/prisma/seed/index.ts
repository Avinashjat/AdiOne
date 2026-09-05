/**
 * Seed entry point.
 *
 *   npm run db:seed
 *
 * Two tiers:
 *   REFERENCE — configuration, store, hours, categories, admin login.
 *               Runs in every environment, including production. Idempotent.
 *   DEMO      — sample products, coupons, delivery agents.
 *               Skipped in production; a real shop's catalogue is entered
 *               through the admin panel, not shipped in a seed file.
 */

import { PrismaClient } from '@prisma/client';
import * as path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

import {
  seedAdminUser,
  seedCategories,
  seedConfiguration,
  seedStore,
} from './reference';
import { seedDemoCatalog } from './demo';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const isProduction = nodeEnv === 'production';

  console.log(`\nAdiOne seed — environment: ${nodeEnv}\n`);

  console.log('Reference data');
  await seedConfiguration(prisma);
  const storeId = await seedStore(prisma);
  const categoryIds = await seedCategories(prisma);
  await seedAdminUser(prisma, {
    email: process.env['ADMIN_EMAIL'] ?? 'owner@adione.in',
    password: process.env['ADMIN_PASSWORD'] ?? 'ChangeMe@123',
    name: process.env['ADMIN_NAME'] ?? 'Store Owner',
  });

  if (isProduction) {
    console.log('\nDemo data skipped (NODE_ENV=production).');
  } else {
    console.log('\nDemo data');
    await seedDemoCatalog(prisma, storeId, categoryIds);
  }

  console.log('\nSeed complete.\n');
}

main()
  .catch((error) => {
    console.error('\nSeed failed:\n', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
