import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [VitePWA({
    registerType: 'prompt',
    includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
    manifest: {
      name: 'Neon Maze', short_name: 'Neon Maze', lang: 'en',
      description: 'An original neon maze arcade. Find your flow. Outrun the echoes.',
      theme_color: '#090e17', background_color: '#090e17', display: 'standalone',
      start_url: '/', scope: '/',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      navigateFallback: '/index.html',
      // Only the application shell is cached. Auth and private API responses never are.
      cleanupOutdatedCaches: true,
    },
  })],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
