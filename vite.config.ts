import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: './', // Poki serves builds from a sub-path
  // Poki upload build: compile out the bot, ?debug=1 overlay/fps/stats, config overrides and thumbnail tool
  define: { __STRIP__: JSON.stringify(mode === 'poki') },
  build: {
    target: 'es2019',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    reportCompressedSize: true,
  },
  server: { host: true },
}));
