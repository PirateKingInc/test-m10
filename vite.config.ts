import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Poki serves builds from a sub-path
  build: {
    target: 'es2019',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    reportCompressedSize: true,
  },
  server: { host: true },
});
