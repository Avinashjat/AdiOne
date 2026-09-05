/**
 * Per-test-file setup. Must run before anything imports `src/config/env`.
 */

import { resolve } from 'node:path';
import dotenv from 'dotenv';

process.env['NODE_ENV'] = 'test';
dotenv.config({ path: resolve(__dirname, '..', '.env'), override: true });
dotenv.config({ path: resolve(__dirname, '..', '.env.test'), override: true });
