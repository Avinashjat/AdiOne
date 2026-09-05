import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Array form with anchored regexes, not the object form: a plain
    // '@shared' key prefix-matches, so '@shared/money' would resolve to
    // 'src/shared/index.ts/money'. The exact-match rule must also come first.
    alias: [
      // The shared contract, mirrored from backend/src/shared by
      // `npm run sync:shared`. Same enums, same error codes, same DTOs.
      { find: /^@shared$/, replacement: resolve(__dirname, 'src/shared/index.ts') },
      { find: /^@shared\//, replacement: `${resolve(__dirname, 'src/shared')}/` },
      { find: /^@\//, replacement: `${resolve(__dirname, 'src')}/` },
    ],
  },
  server: {
    port: 5173,
    // Proxy in dev so the browser sees a same-origin API and CORS never
    // enters the picture during development.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', ws: true },
      // Product images. These MUST be same-origin: an <img> cannot carry the
      // `ngrok-skip-browser-warning` header, so loading them straight from the
      // tunnel gets ngrok's HTML interstitial instead of the file, and Chrome
      // rejects it with ERR_BLOCKED_BY_ORB.
      '/static': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
