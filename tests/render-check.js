// Neon Surge v0.2.2 — headless browser render check.
// Serves the game dir over local HTTP, loads it in a headless browser, and
// asserts the M1 core, by hook and by eye:
//   - the menu renders over a LIVE demo (the attract-mode bot actually
//     plays sector 1 behind the menu — the demo player moves), with no
//     version/engine text anywhere the player can see, one clear primary
//     Play action, and 12 sector cards
//   - Play starts sector 1 with the HUD; movement is asserted in SCREEN
//     space (left moves left on screen, right moves right — the Drift M2
//     lesson), and the polarity swap flips the HUD chip + wisp colour
//   - the autopilot (decision bot) absorbs, novas and clears sector 1,
//     the complete screen shows, and the best score is saved
//   - pause focuses Resume; Enter resumes
//   - ?sector=3 jumps straight into sector 3 (the playtest path)
//   - feel state returns to rest (trauma 0, timeScale 1) when idle
//   - zero console errors and zero page errors
//
// Run: node tests/render-check.js (Firefox by default; PW_BROWSER=chromium
// for the headless shell). Firefox is the default because the Chromium
// headless shell throttles rAF on long-idle pages in this VM — the sim
// collapses to ~0.1x after ~25s of wall time (mouse wiggles don't help),
// so the autopilot clear times out even though the game plays correctly.
// Firefox runs the game at a true 60fps with sim time 1:1 (probe
// 2026-11-24: bot cleared sector 1 in 41s wall / 39s sim, matching the
// Node decision bot exactly). Screenshot timeouts are 300s — under
// SwiftShader on this 1.5-CPU VM a single 1280x720 screenshot readback
// takes 60-180s. The timeout is environmental; the assertions themselves
// are unchanged.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(os.tmpdir(), 'neon-surge-render-check');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
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
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const { chromium, firefox } = loadPlaywright();
const PW_BROWSER = process.env.PW_BROWSER || 'firefox';
const errors = [];
const failures = [];
function check(name, cond, extra) {
  if (cond) console.log('  PASS ' + name);
  else { failures.push(name); console.error('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

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

  // --- menu ---------------------------------------------------------------
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Asia/Bangkok' });
  const page = await context.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`menu console: ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`menu pageerror: ${String(err)}`));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__surge, null, { timeout: 30000 });
  await page.waitForTimeout(1500); // menu pop-in + demo running
  const menuText = await page.evaluate(() => document.body.innerText);
  check('menu shows the game title', /NEON\s*SURGE/i.test(menuText));
  check('menu has one clear primary Play action', await page.evaluate(() => {
    const b = document.getElementById('btn-play');
    return b && !b.classList.contains('hidden') && b.textContent.includes('Play');
  }));
  check('no version text on the player-facing menu', !/v0\.2\.0|0\.2\.0/.test(menuText), menuText.slice(0, 200));
  check('no engine text on the player-facing menu', !/three\.js|canvas 2d|webgl/i.test(menuText));
  check('menu lists 12 sectors', await page.evaluate(() => window.__surge.sectors().length === 12));
  // The demo behind the menu is actually playing: its clock advances and
  // the wisp drifts from its spawn point toward the middle of the arena.
  // (A fixed 2s position delta is flaky — the bot idles at the centre
  // between waves — so assert the sim runs + the wisp left its spawn.)
  const demoT1 = await page.evaluate(() => window.__surge.info().time);
  const demoP1 = await page.evaluate(() => window.__surge.info().player);
  await page.waitForTimeout(4000);
  const demoT2 = await page.evaluate(() => window.__surge.info().time);
  const demoP2 = await page.evaluate(() => window.__surge.info().player);
  check('live demo runs behind the menu (its clock advances)', demoT2 > demoT1 + 1, `${demoT1.toFixed(1)}s -> ${demoT2.toFixed(1)}s`);
  check('live demo wisp left its spawn point', Math.hypot(demoP2.x - 640, demoP2.y - 612) > 40,
    `(${demoP1.x.toFixed(0)},${demoP1.y.toFixed(0)}) -> (${demoP2.x.toFixed(0)},${demoP2.y.toFixed(0)})`);
  await page.screenshot({ timeout: 300000, path: path.join(SHOTS_DIR, 'menu-1280x720.png') });
  console.log('render-check: menu shot captured');

  // --- sector select ------------------------------------------------------
  await page.click('#btn-sectors');
  await page.waitForFunction(() => !document.getElementById('sectors').classList.contains('hidden'), null, { timeout: 5000 });
  await page.waitForTimeout(2500); // stagger pop-in (SwiftShader presents stale frames)
  check('sector select shows 12 sector cards', await page.evaluate(() => document.querySelectorAll('#sector-grid .level-card').length === 12));
  check('sector 1 is unlocked, sectors 2-12 locked on a fresh save', await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#sector-grid .level-card')];
    return !cards[0].disabled && cards.slice(1).every((c) => c.disabled);
  }));
  check('sector select focuses the first sector card and starts at the top (no clipped first row)', await page.evaluate(() => {
    const panel = document.querySelector('#sectors .panel');
    return document.activeElement && document.activeElement.classList.contains('level-card') && panel.scrollTop === 0;
  }));
  await page.screenshot({ timeout: 300000, path: path.join(SHOTS_DIR, 'sectors-1280x720.png') });
  await page.click('#btn-sectors-back');
  await page.waitForFunction(() => window.__surge.state.phase === 'menu', null, { timeout: 5000 });

  // --- play: screen-space movement + swap ---------------------------------
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__surge.state.phase === 'playing', null, { timeout: 5000 });
  check('Play starts sector 1', await page.evaluate(() => window.__surge.state.sectorId === 1));
  check('HUD is visible while playing', await page.evaluate(() => !document.getElementById('hud').classList.contains('hidden')));
  await page.waitForTimeout(800);
  // Screen-space movement, polled (not fixed waits — the headless loop
  // runs slower than real time under SwiftShader, so poll until it moves).
  const p0 = await page.evaluate(() => window.__surge.info().player);
  await page.evaluate(() => window.__surge.setMove(-1, 0));
  await page.waitForFunction((x0) => window.__surge.info().player.x < x0 - 20, p0.x, { timeout: 15000 });
  const pLeft = await page.evaluate(() => window.__surge.info().player);
  check('screen space: holding left moves the wisp left ON SCREEN', pLeft.x < p0.x - 20, `${p0.x.toFixed(0)} -> ${pLeft.x.toFixed(0)}`);
  await page.evaluate(() => window.__surge.setMove(1, 0));
  await page.waitForFunction((x0) => window.__surge.info().player.x > x0 + 20, pLeft.x, { timeout: 15000 });
  const pRight = await page.evaluate(() => window.__surge.info().player);
  check('screen space: holding right moves the wisp right ON SCREEN', pRight.x > pLeft.x + 20, `${pLeft.x.toFixed(0)} -> ${pRight.x.toFixed(0)}`);
  await page.evaluate(() => window.__surge.setMove(0, 0));
  const polBefore = await page.evaluate(() => window.__surge.info().playerWorld.pol);
  await page.evaluate(() => window.__surge.swap());
  await page.waitForFunction(() => window.__surge.info().playerWorld.pol === 'magenta', null, { timeout: 5000 });
  const polAfter = await page.evaluate(() => window.__surge.info().playerWorld.pol);
  check('swap flips polarity in the live game', polBefore === 'cyan' && polAfter === 'magenta', `${polBefore} -> ${polAfter}`);
  check('HUD polarity chip follows the swap', await page.evaluate(() => document.getElementById('hud-polarity').textContent.includes('MAGENTA')));
  // Autopilot on BEFORE the long screenshot: an idle player dies during
  // a 60-180s SwiftShader capture, and a dead run makes the shot useless.
  await page.evaluate(() => window.__surge.autopilot(true));
  await page.waitForTimeout(3000);
  await page.screenshot({ timeout: 300000, path: path.join(SHOTS_DIR, 'gameplay-1280x720.png') });
  console.log('render-check: gameplay shot captured');

  // --- pause --------------------------------------------------------------
  await page.evaluate(() => window.__surge.pause());
  await page.waitForFunction(() => window.__surge.state.phase === 'pause', null, { timeout: 5000 });
  check('pause shows the pause screen with Resume focused', await page.evaluate(() => document.activeElement && document.activeElement.id === 'btn-resume'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__surge.state.phase === 'playing', null, { timeout: 5000 });
  check('Enter resumes the run', true);

  // --- autopilot clears sector 1 ------------------------------------------
  // 180s: Firefox clears it in ~40s wall; the headroom covers a slow
  // cold start. (Under the headless shell this used to time out at 240s
  // because rAF throttling stalls the sim — see the header note.)
  await page.waitForFunction(() => window.__surge.state.phase === 'complete', null, { timeout: 180000 });
  const final = await page.evaluate(() => window.__surge.state);
  check('autopilot (decision bot) clears sector 1 in the real browser', final.won === true && final.sectorId === 1, JSON.stringify(final));
  check('complete screen shows the score', await page.evaluate(() => /Score \d/.test(document.getElementById('complete-score').textContent)));
  check('best score is saved after the clear', await page.evaluate(() => {
    const s = window.__surge.save;
    return s.best && s.best[1] && s.best[1].score > 0;
  }));
  check('clearing sector 1 unlocks sector 2', await page.evaluate(() => window.__surge.save.unlocked >= 2));
  await page.click('#btn-complete-menu');
  await page.waitForFunction(() => window.__surge.state.phase === 'menu', null, { timeout: 5000 });
  // Feel state returns to rest once the game sits idle.
  await page.waitForTimeout(2500);
  const feel = await page.evaluate(() => window.__surge.feel());
  check('feel state returns to rest (trauma 0, timeScale 1, no shockwaves)', feel.trauma === 0 && feel.timeScale === 1 && feel.shockwaves === 0,
    JSON.stringify(feel));
  await context.close();

  // --- ?sector=3 playtest path --------------------------------------------
  const context2 = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Asia/Bangkok' });
  const page2 = await context2.newPage();
  page2.on('console', (msg) => { if (msg.type() === 'error') errors.push(`sector3 console: ${msg.text()}`); });
  page2.on('pageerror', (err) => errors.push(`sector3 pageerror: ${String(err)}`));
  await page2.goto(`http://127.0.0.1:${port}/?sector=3`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page2.waitForFunction(() => window.__surge, null, { timeout: 30000 });
  await page2.waitForFunction(() => window.__surge.state.phase === 'playing', null, { timeout: 5000 });
  check('?sector=3 jumps straight into sector 3', await page2.evaluate(() => window.__surge.state.sectorId === 3));
  // Poll, don't fixed-wait: the first spinner takes ~3.4s to enter and
  // ~1.4s more to fire, and a fresh page runs slow at first — the first
  // bullets land around 6s of sim time, later in wall time.
  await page2.waitForFunction(() => { const i = window.__surge.info(); return i.enemies > 0 && i.bullets > 0; }, null, { timeout: 30000 });
  const s3 = await page2.evaluate(() => window.__surge.info());
  check('sector 3 spawns enemies and fires bullets', s3.enemies > 0 && s3.bullets > 0, `enemies=${s3.enemies} bullets=${s3.bullets}`);
  await page2.evaluate(() => window.__surge.autopilot(true));
  await page2.waitForFunction(() => { const i = window.__surge.info(); return i.playerWorld.charge > 0 || i.absorbs > 0; }, null, { timeout: 30000 });
  const s3b = await page2.evaluate(() => window.__surge.info());
  check('sector 3 autopilot absorbs bullets (charge builds)', s3b.playerWorld.charge > 0 || s3b.absorbs > 0, `charge=${s3b.playerWorld.charge} absorbs=${s3b.absorbs}`);
  await page2.screenshot({ timeout: 300000, path: path.join(SHOTS_DIR, 'sector3-1280x720.png') });
  console.log('render-check: sector 3 shot captured');
  await context2.close();

  if (errors.length > 0) {
    console.error('render-check: console/page errors:');
    for (const e of errors) console.error('  ' + e);
    failures.push(`${errors.length} console/page error(s)`);
  }
} catch (err) {
  console.error('render-check: FAIL —', err.message);
  failures.push(err.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
}

if (failures.length > 0) { console.error(`render-check: ${failures.length} failure(s)`); process.exit(1); }
console.log(`render-check: PASS — shots in ${SHOTS_DIR} — INSPECT BY EYE (menu, sectors, gameplay, sector 3)`);
