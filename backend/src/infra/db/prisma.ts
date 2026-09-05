/**
 * Prisma client singleton + transaction helpers.
 *
 * The helpers here are where the project's transactional guarantees live, so
 * that no module has to remember the isolation level or the lock ordering.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { env, isProduction, isTest } from '../../config/env';
import { moduleLogger } from '../../common/logger';

const log = moduleLogger('db');

function createClient(): PrismaClient {
  const client = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: isProduction
      ? [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }]
      : [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ],
  });

  client.$on('error' as never, (event: Prisma.LogEvent) => {
    log.error({ target: event.target, message: event.message }, 'prisma error');
  });
  client.$on('warn' as never, (event: Prisma.LogEvent) => {
    log.warn({ target: event.target, message: event.message }, 'prisma warning');
  });

  if (!isProduction && !isTest) {
    client.$on('query' as never, (event: Prisma.QueryEvent) => {
      // Slow-query visibility during development. Params are NOT logged: they
      // routinely contain mobile numbers and addresses.
      if (event.duration >= 200) {
        log.warn({ durationMs: event.duration, query: event.query }, 'slow query');
      } else {
        log.debug({ durationMs: event.duration, query: event.query }, 'query');
      }
    });
  }

  return client;
}

/**
 * `tsx watch` re-executes modules on every save; without this guard each
 * reload would open a fresh connection pool until Postgres refuses new
 * connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (!isProduction) globalForPrisma.prisma = prisma;

/** The transaction-scoped client type, for repository signatures. */
export type Tx = Prisma.TransactionClient;

/** Anything that can run a query: the base client or a transaction. */
export type DbClient = PrismaClient | Tx;

export interface TransactionOptions {
  /** Time the transaction may run before Prisma rolls it back. */
  timeoutMs?: number;
  /** Time to wait for a connection from the pool. */
  maxWaitMs?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Runs `fn` inside a database transaction.
 *
 * READ COMMITTED is the default and is correct for this system: correctness of
 * the critical path (order creation) comes from explicit `SELECT … FOR UPDATE`
 * row locks taken in a deterministic order, not from a higher isolation level.
 * SERIALIZABLE would add retry-on-conflict handling everywhere for no gain.
 *
 * Timeout is 10s rather than Prisma's 5s default because order creation locks
 * several inventory rows and we would rather wait than fail a paying customer.
 *
 * RULE: never perform network I/O (payment provider, SMS, push, socket emit)
 * inside `fn`. Third-party latency must not hold row locks.
 */
export async function runInTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return prisma.$transaction(fn, {
    timeout: options.timeoutMs ?? 10_000,
    maxWait: options.maxWaitMs ?? 5_000,
    isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    log.error({ err: error }, 'database health check failed');
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export { Prisma };
