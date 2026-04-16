/**
 * Vite-конфиг фронтенда.
 *
 * Важно:
 * - в dev проксируем `/api` на локальный backend (Fastify).
 * - в проде этот прокси не используется: фронт будет дергать реальный домен API.
 */

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001'
    }
  }
});

