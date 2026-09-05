/**
 * Test database helpers.
 */

import { prisma } from '../../src/infra/db/prisma';

/**
 * Empties every table in one statement.
 *
 * TRUNCATE … CASCADE rather than deleting per table: it is far faster, it does
 * not care about foreign-key ordering, and RESTART IDENTITY leaves sequences
 * clean so tests never depend on ids left over from a previous case.
 *
 * `_prisma_migrations` is excluded — wiping it would make Prisma think the
 * database is unmigrated.
 */
/**
 * Last line of defence.
 *
 * Asks the CONNECTION which database it is actually attached to, rather than
 * trusting configuration. Environment loading can go wrong — it did once, and
 * truncated the development database — so this verifies the real target
 * immediately before issuing a destructive statement.
 */
async function assertTestDatabase(): Promise<void> {
  const [row] = await prisma.$queryRaw<{ current_database: string }[]>`
    SELECT current_database()`;
  const name = row?.current_database ?? '';

  if (!name.endsWith('_test')) {
    throw new Error(
      `REFUSING TO TRUNCATE: connected to "${name}", which is not a *_test database. ` +
        'Check backend/.env.test and that NODE_ENV=test.',
    );
  }
}

export async function truncateAll(): Promise<void> {
  await assertTestDatabase();

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;

  if (tables.length === 0) return;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export { prisma };
