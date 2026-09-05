/**
 * SearchProvider port.
 *
 * V1 uses PostgreSQL full-text search plus trigram fuzzy matching. The
 * interface exists so Meilisearch or Elasticsearch can be swapped in later
 * (PRD §18.2) without touching the catalog module — but running another
 * container to search a few thousand SKUs would be pure overhead today.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../../config/env';
import { moduleLogger } from '../../common/logger';

const log = moduleLogger('search');

export interface SearchQuery {
  term: string;
  storeId: string;
  limit: number;
  /** Product id to resume after, for cursor pagination. */
  afterRank?: number | null;
  inStockOnly?: boolean;
}

export interface SearchHit {
  productId: string;
  rank: number;
}

export interface SearchProvider {
  readonly name: string;
  search(query: SearchQuery): Promise<SearchHit[]>;
}

/**
 * Word-similarity threshold for the trigram fallback.
 *
 * The default (0.6) rejects real misspellings: measured on seed data,
 * "colgat" scores 0.86 and "maggie" 0.71, but heavier slips fall below.
 * 0.45 catches those without dragging in unrelated products — the value was
 * chosen by measuring, not guessed (docs/02-decisions.md D11a).
 */
const WORD_SIMILARITY_THRESHOLD = 0.45;

class PostgresSearchProvider implements SearchProvider {
  readonly name = 'postgres';

  /**
   * Two strategies combined, ranked:
   *
   *   1. Full-text over name + Hindi name + local keywords + description.
   *      `search_keywords` is what makes "cheeni" find Sugar and "doodh" find
   *      Milk — in this market that matters more than English relevance
   *      tuning ever will.
   *   2. Trigram word-similarity as a fallback for typos, using `<%`
   *      (word_similarity) rather than `%` (whole-string similarity), which
   *      scores a short query against a long product name far too low to match.
   *
   * Both are index-backed: GIN on the tsvector, GIN trgm on name and brand.
   */
  async search(query: SearchQuery): Promise<SearchHit[]> {
    const term = query.term.trim();
    if (term.length === 0) return [];

    const rows = await prisma.$queryRaw<{ product_id: string; rank: number }[]>`
      WITH matches AS (
        SELECT
          p.id AS product_id,
          GREATEST(
            ts_rank(p.search_vector, plainto_tsquery('simple', ${term})) * 10,
            word_similarity(${term}, p.name),
            COALESCE(word_similarity(${term}, b.name), 0) * 0.9
          ) AS rank
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id
        WHERE p.status = 'ACTIVE'
          AND p.deleted_at IS NULL
          AND (
            p.search_vector @@ plainto_tsquery('simple', ${term})
            OR ${term} <% p.name
            OR ${term} <% COALESCE(b.name, '')
          )
      )
      SELECT m.product_id, m.rank
      FROM matches m
      WHERE EXISTS (
        SELECT 1
        FROM product_variants v
        JOIN store_variants sv ON sv.variant_id = v.id AND sv.store_id = ${Prisma.sql`${query.storeId}`}::uuid
        WHERE v.product_id = m.product_id
          AND v.status = 'ACTIVE'
          AND v.deleted_at IS NULL
          ${
            query.inStockOnly
              ? Prisma.sql`AND sv.is_available AND (sv.stock_qty - sv.reserved_qty) > 0`
              : Prisma.empty
          }
      )
      ${query.afterRank != null ? Prisma.sql`AND m.rank < ${query.afterRank}` : Prisma.empty}
      ORDER BY m.rank DESC, m.product_id ASC
      LIMIT ${query.limit}`;

    return rows.map((row) => ({ productId: row.product_id, rank: Number(row.rank) }));
  }
}

/** Applied per connection; cheap and idempotent. */
export async function configureSearchThresholds(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `SET pg_trgm.word_similarity_threshold = ${WORD_SIMILARITY_THRESHOLD}`,
    );
  } catch (error) {
    log.warn({ err: error }, 'could not set trigram threshold — using the default');
  }
}

export const search: SearchProvider = new PostgresSearchProvider();

log.info({ provider: env.SEARCH_PROVIDER }, 'search provider initialised');
