import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Development also uses the authenticated host. No key or token is bundled here.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: process.env.TEKES_HOST_URL
      ? {
          '/api': {
            target: process.env.TEKES_HOST_URL,
            changeOrigin: true,
            configure(proxy) {
              proxy.on('proxyReq', (request) => request.removeHeader('origin'));
            },
          },
        }
      : undefined,
  },
  build: { sourcemap: false, assetsInlineLimit: 0 },
});
