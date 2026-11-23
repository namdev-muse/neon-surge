// Neon Surge v0.2.3 — size sweep screenshots.
// Serves the game dir over local HTTP and captures the menu + gameplay at
// 1280x720, 2560x1080 and 1080x2340 (portrait). Inspect every shot by eye:
// no clipped or overlapping elements, no cut-off text, HUD fits. The
// 1280x720 menu + gameplay shots are also copied to docs/screenshots/ for
// the README.
//
// Run: node tests/screenshots.js (Firefox by default; PW_BROWSER=chromium
// for the headless shell). Firefox is the default because its screenshots
// are far faster in this VM and the Chromium headless shell throttles rAF
// on long-idle pages (the game sim collapses to ~0.1x, so the "12s of
// gameplay" wait becomes ~1s of sim and the shot catches an empty arena);
// see tests/render-check.js for the probe evidence (2026-11-24).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(os.tmpdir(), 'neon-surge-size-sweep');
const DOCS_DIR = path.join(GAME_DIR, 'docs', 'screenshots');
const SIZES = [
  // deviceScaleFactor 0.5 on the two big sizes: a 2560x1080 readback
  // (2.7M px) timed out at 300s under SwiftShader, and the compositor
  // presents frames seconds stale. CSS layout is identical at 0.5x —
  // only the image is less sharp — so the layout sweep is unchanged.
  { name: '1280x720', width: 1280, height: 720, deviceScaleFactor: 1 },
  { name: '2560x1080', width: 2560, height: 1080, deviceScaleFactor: 0.5 },
  { name: '1080x2340', width: 1080, height: 2340, deviceScaleFactor: 0.5 },
];

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json',
};
function findHeadlessShell() {
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    for (const entry of fs.readdirSync(base)) {
      const candidate = path.join(base, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* cache dir missing */ }
  return null;
}
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [
    '../node_modules/playwright-core',
    '../../neon-hexfall/node_modules/playwright-core',
  ];
  for (const c of candidates) {
    try { return require(fileURLToPath(new URL(c, import.meta.url))); } catch { /* try next */ }
  }
  throw new Error('playwright-core not found (looked in neon-surge/node_modules and neon-hexfall/node_modules)');
}
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(GAME_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(GAME_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const { chromium, firefox } = loadPlaywright();
const PW_BROWSER = process.env.PW_BROWSER || 'firefox';
const errors = [];
let browser;
try {
  if (PW_BROWSER === 'firefox') {
    browser = await firefox.launch({ args: ['--no-sandbox'] });
  } else {
    const executablePath = findHeadlessShell();
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
    });
  }
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  for (const size of SIZES) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.deviceScaleFactor,
      timezoneId: 'Asia/Bangkok',
    });
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`${size.name} console: ${msg.text()}`); });
    page.on('pageerror', (err) => errors.push(`${size.name} pageerror: ${String(err)}`));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__surge, null, { timeout: 30000 });
    // 5s, not 1.5s: the demo needs a few seconds before the arena is busy,
    // and SwiftShader presents frames seconds stale — a 1.5s shot catches
    // an empty arena.
    await page.waitForTimeout(5000); // menu pop-in + demo running
    await page.screenshot({ timeout: 300000, path: path.join(SHOTS_DIR, `menu-${size.name}.png`) });
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__surge.state.phase === 'playing', null, { timeout: 5000 });
    // Autopilot on: an idle player dies during a 60-180s SwiftShader
    // capture, and a dead run makes the shot useless.
    await page.evaluate(() => window.__surge.autopilot(true));
    // 12s, not 6s: same staleness — a 6s shot can catch the arena at ~1s.
    await page.waitForTimeout(12000); // let enemies spawn and bullets fly
    await page.screenshot({ timeout: 300000, path: path.join(SHOTS_DIR, `gameplay-${size.name}.png`) });
    // Sector select at this size too (the grid is the layout risk).
    await page.keyboard.press('p');
    await page.waitForFunction(() => window.__surge.state.phase === 'pause', null, { timeout: 5000 });
    await page.click('#btn-quit');
    await page.waitForFunction(() => window.__surge.state.phase === 'menu', null, { timeout: 5000 });
    await page.click('#btn-sectors');
    await page.waitForFunction(() => !document.getElementById('sectors').classList.contains('hidden'), null, { timeout: 5000 });
    // 2500ms, not 600ms: the cards pop in with a stagger, and under
    // SwiftShader the compositor presents frames ~0.5s stale, so a
    // 600ms wait captured the panel mid-pop-in (empty) — the cards were
    // fine in the DOM, the shot was early (Flux lesson, 2026-11-22).
    await page.waitForTimeout(2500);
    await page.screenshot({ timeout: 300000, path: path.join(SHOTS_DIR, `sectors-${size.name}.png`) });
    console.log(`size-sweep: ${size.name} captured (menu, gameplay, sectors)`);
    await context.close();
  }
  // Docs copies: the 1280x720 menu + gameplay shots illustrate the README.
  for (const name of ['menu-1280x720.png', 'gameplay-1280x720.png']) {
    fs.copyFileSync(path.join(SHOTS_DIR, name), path.join(DOCS_DIR, name));
  }
  console.log(`size-sweep: docs copies written to ${DOCS_DIR}`);
  if (errors.length > 0) {
    console.error('size-sweep: console/page errors:');
    for (const e of errors) console.error('  ' + e);
    throw new Error(`${errors.length} console/page error(s)`);
  }
  console.log(`size-sweep: PASS — shots in ${SHOTS_DIR} — INSPECT BY EYE at all 3 sizes (no clipped/overlapping elements)`);
} catch (err) {
  console.error('size-sweep: FAIL —', err.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
}
