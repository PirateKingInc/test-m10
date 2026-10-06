#!/usr/bin/env node
/**
 * npm run thumbnails [-- --sizes 512,1080 --variants a-hero,b-chaos]
 * Renders the promo thumbnails from the real game scene (src/game/thumbnail.ts)
 * into ./thumbnails/<variant>_<size>.png.
 *
 * Browser: uses $CHROME_PATH if set, else the Playwright Chromium if installed
 * (`npx playwright install chromium`), else a local Chrome. Rendering is forced onto
 * SwiftShader so the output is identical on every machine.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const sizes = arg('sizes', '512,1080');
const variants = arg('variants', '');
const outDir = path.resolve(root, arg('out', 'thumbnails'));

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const { port } = server.httpServer.address();

const launchOpts = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
const candidates = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
let browser;
for (const p of candidates) if (!browser && existsSync(p)) browser = await chromium.launch({ ...launchOpts, executablePath: p });
if (!browser) {
  try {
    browser = await chromium.launch(launchOpts);
  } catch {
    browser = await chromium.launch({ ...launchOpts, channel: 'chrome' });
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  const q = new URLSearchParams({ thumb: '1', sizes, analytics: 'off' });
  if (variants) q.set('variants', variants);
  await page.goto(`http://127.0.0.1:${port}/?${q}`);
  const thumbs = await page.waitForFunction(() => window.__thumbs, null, { timeout: 180000 }).then((h) => h.jsonValue());
  mkdirSync(outDir, { recursive: true });
  for (const [id, bySize] of Object.entries(thumbs)) {
    for (const [size, url] of Object.entries(bySize)) {
      const file = path.join(outDir, `${id}_${size}.png`);
      writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
      console.log('wrote', path.relative(root, file));
    }
  }
} finally {
  await browser.close();
  await server.close();
}
