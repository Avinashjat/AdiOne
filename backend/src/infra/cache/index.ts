/**
 * CacheStore factory. The rest of the application imports `cache` and never
 * knows which driver is behind it.
 */

import { env } from '../../config/env';
import { moduleLogger } from '../../common/logger';
import { MemoryCacheStore } from './memory.store';
import { RedisCacheStore } from './redis.store';
import type { CacheStore } from './types';

const log = moduleLogger('cache');

function createCacheStore(): CacheStore {
  if (env.REDIS) {
    log.info({ driver: 'redis' }, 'cache store initialised');
    // REDIS_URL is guaranteed present by the env validator when REDIS=true.
    return new RedisCacheStore(env.REDIS_URL as string);
  }

  // Warn rather than stay silent: it is worth seeing in the log that OTP and
  // rate-limit state will not survive a restart.
  log.warn(
    { driver: 'node-cache' },
    'REDIS=false — using the in-process cache; OTP and rate-limit state is lost on restart and is not shared between instances',
  );
  return new MemoryCacheStore();
}

export const cache: CacheStore = createCacheStore();

export { CacheKey } from './types';
export type { CacheStore } from './types';
