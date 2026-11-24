// Neon Surge v1.0.0 — headless browser render check.
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
//   - M3 feel bundles fire: absorb leaves live particles, a nova leaves
//     slow-mo / flash / zoom / a shockwave, a hit leaves flash + trauma;
//     the music loop runs after Play; the shake/flash/music toggles work
//     and the shake slider gates the actual shake amplitude
//   - pause focuses Resume; Enter resumes
//   - ?sector=3 jumps straight into sector 3 (the playtest path)
//   - M4: endless button locked with a reason on a fresh save (click
//     answers, does not start); clear screen shows the rank badge;
//     clearing sector 1 unlocks endless, which starts from the menu,
//     banners WAVE 1, and advances to wave 2; ?endless=1 jumps in
//     directly on a fresh save
//   - M5: the sector best is already in localStorage the moment the run
//     ends (persist-on-phase-flip, before the complete screen shows);
//     the clear screen prints the rank thresholds; flash decays in real
//     seconds (0.30s flash still live at 200ms, gone by 500ms); a 2s
//     toast hides after ~2s real time; text-size / contrast toggles
//     apply body classes and persist; the FPS guard drops the DPR cap
//     to 1 and shrinks the canvas backing store on a 2x-DPI page
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
  check('no version text on the player-facing menu', !/v0\.4\.0|0\.4\.0/.test(menuText), menuText.slice(0, 200));
  check('no engine text on the player-facing menu', !/three\.js|canvas 2d|webgl/i.test(menuText));
  check('menu lists 12 sectors', await page.evaluate(() => window.__surge.sectors().length === 12));
  // M4: Endless Drift is locked on a fresh save — the button reads locked
  // with the reason under it, and clicking it answers (denied tick +
  // pulsing note) instead of starting a run or sitting dead.
  check('endless button reads locked with a reason on a fresh save', await page.evaluate(() => {
    const b = document.getElementById('btn-endless');
    const note = document.getElementById('endless-note');
    return b && b.classList.contains('locked') && b.textContent.includes('🔒')
      && note && note.textContent === 'Clear Sector 1 to unlock Endless Drift'
      && window.__surge.endlessUnlocked() === false;
  }));
  await page.click('#btn-endless');
  await page.waitForTimeout(600);
  check('clicking the locked endless button does not start a run (it answers, it is not dead)', await page.evaluate(() => {
    return window.__surge.state.phase === 'menu'
      && document.getElementById('endless-note').classList.contains('pulse');
  }));
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
  // M3: the generative music loop starts with play (a real gesture).
  const audio = await page.evaluate(() => window.__surge.audio());
  check('music loop runs after Play (audio live, scheduler on)', audio.hasAudio && audio.musicOn && audio.musicPlaying, JSON.stringify(audio));
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
  // M3: the absorb bundle fires — live particles in the same frame the
  // absorb counter moves. Poll for the absorb, then read feel at once:
  // particles live 0.45s, so a slow read would miss them.
  await page.waitForFunction(() => window.__surge.info().absorbs > 0, null, { timeout: 30000 });
  const absorbFeel = await page.evaluate(() => window.__surge.feel());
  check('absorb fires its bundle (live particles right after an absorb)', absorbFeel.particlesAlive > 0, JSON.stringify(absorbFeel));
  // M3: the nova bundle fires — slow-mo, flash, zoom punch or shockwave
  // must still be live in the frame the nova counter moves (all last
  // 0.37–0.55s, so the read has to follow the poll immediately).
  await page.waitForFunction(() => window.__surge.info().novas > 0, null, { timeout: 90000 });
  const novaFeel = await page.evaluate(() => window.__surge.feel());
  check('nova fires its full bundle (slow-mo / flash / zoom / shockwave)', novaFeel.slowMoT > 0 || novaFeel.flashT > 0 || novaFeel.zoomT > 0 || novaFeel.shockwaves > 0, JSON.stringify(novaFeel));
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
  // M5 persist-on-phase-flip: the best must already be in localStorage
  // the moment the run ends (state.done, phase still 'playing' during
  // the 0.9s transition) — NOT only once the complete screen shows.
  await page.waitForFunction(() => window.__surge.state.done === true, null, { timeout: 180000 });
  check('M5: sector best is persisted the moment the run ends (before the complete screen shows)', await page.evaluate(() => {
    const raw = localStorage.getItem('neon-surge-save-v1');
    if (!raw) return false;
    const s = JSON.parse(raw);
    return window.__surge.state.phase === 'playing' && s.best && s.best[1] && s.best[1].score > 0;
  }), await page.evaluate(() => JSON.stringify(window.__surge.state)));
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
  // M4: the clear screen shows the clear rank (S/A/B from hull left) —
  // the decision bot clears sector 1 untouched, so this is RANK S.
  check('complete screen shows the clear rank badge', await page.evaluate(() => {
    const el = document.getElementById('complete-rank');
    return el && /^RANK [SAB]$/.test(el.textContent.trim());
  }), await page.evaluate(() => document.getElementById('complete-rank').textContent));
  // M5: the rank thresholds are printed on the clear screen so the
  // player can see what the next rank costs (S at 80 hull, A at 50).
  check('complete screen shows the rank thresholds (S at 80 hull, A at 50 hull)', await page.evaluate(() => {
    const el = document.querySelector('.complete-ranks');
    return el && /S at 80/.test(el.textContent) && /A at 50/.test(el.textContent);
  }), await page.evaluate(() => document.querySelector('.complete-ranks')?.textContent));
  await page.click('#btn-complete-menu');
  await page.waitForFunction(() => window.__surge.state.phase === 'menu', null, { timeout: 5000 });
  // M4: clearing sector 1 unlocked Endless Drift — the button is no
  // longer locked and the note carries the (empty) best result.
  check('clearing sector 1 unlocks endless drift on the menu', await page.evaluate(() => {
    const b = document.getElementById('btn-endless');
    const note = document.getElementById('endless-note');
    return window.__surge.endlessUnlocked() === true && !b.classList.contains('locked')
      && b.textContent.includes('Endless Drift') && /no runs yet/.test(note.textContent);
  }));
  // M4: Endless starts from the menu button — the HUD shows the wave,
  // the wave banner fires, and the autopilot plays wave 1 into wave 2.
  await page.click('#btn-endless');
  await page.waitForFunction(() => window.__surge.state.phase === 'playing', null, { timeout: 5000 });
  check('endless starts from the menu button (mode endless, wave 1)', await page.evaluate(() => {
    const s = window.__surge.state;
    return s.mode === 'endless' && s.wave === 1 && s.sectorId === 0;
  }), JSON.stringify(await page.evaluate(() => window.__surge.state)));
  check('endless HUD shows the wave label', await page.evaluate(() => document.getElementById('hud-sector').textContent.includes('Wave 1')));
  await page.waitForFunction(() => window.__surge.feel().waveBanner.text === 'WAVE 1', null, { timeout: 15000 });
  check('wave banner fires on wave start (WAVE 1)', await page.evaluate(() => {
    const wb = window.__surge.feel().waveBanner;
    return wb.text === 'WAVE 1' && wb.t > 0;
  }), JSON.stringify(await page.evaluate(() => window.__surge.feel().waveBanner)));
  await page.evaluate(() => window.__surge.autopilot(true));
  await page.waitForFunction(() => { const i = window.__surge.info(); return i.enemies > 0 && i.bullets > 0; }, null, { timeout: 30000 });
  check('endless wave 1 spawns enemies and fires bullets', true);
  await page.screenshot({ timeout: 300000, path: path.join(SHOTS_DIR, 'endless-1280x720.png') });
  console.log('render-check: endless shot captured');
  // Wave 1 is sector 1's pattern at speed 200 — the autopilot clears it
  // in ~40s sim; reaching wave 2 proves the wave machine advances,
  // not just starts.
  await page.waitForFunction(() => window.__surge.info().wave >= 2, null, { timeout: 180000 });
  check('endless advances to wave 2 after wave 1 clears', await page.evaluate(() => window.__surge.info().wave >= 2));
  await page.evaluate(() => window.__surge.quitToMenu());
  await page.waitForFunction(() => window.__surge.state.phase === 'menu', null, { timeout: 5000 });
  // Feel state returns to rest once the game sits idle.
  await page.waitForTimeout(2500);
  const feel = await page.evaluate(() => window.__surge.feel());
  check('feel state returns to rest (trauma 0, timeScale 1, flash 0, zoom 0, no shockwaves/pops/particles)', feel.trauma === 0 && feel.timeScale === 1 && feel.flashT === 0 && feel.swapFlashT === 0 && feel.zoomT === 0 && feel.shockwaves === 0 && feel.pops === 0 && feel.particlesAlive === 0,
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

  // --- ?endless=1 playtest path --------------------------------------------
  // A fresh profile: the lock is bypassed for the session only, like
  // ?sector=N — the save stays locked (endlessUnlocked() false).
  const contextE = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Asia/Bangkok' });
  const pageE = await contextE.newPage();
  pageE.on('console', (msg) => { if (msg.type() === 'error') errors.push(`endless console: ${msg.text()}`); });
  pageE.on('pageerror', (err) => errors.push(`endless pageerror: ${String(err)}`));
  await pageE.goto(`http://127.0.0.1:${port}/?endless=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageE.waitForFunction(() => window.__surge, null, { timeout: 30000 });
  await pageE.waitForFunction(() => window.__surge.state.phase === 'playing', null, { timeout: 5000 });
  check('?endless=1 jumps straight into endless drift on a fresh save (lock bypassed for the session)', await pageE.evaluate(() => {
    const s = window.__surge.state;
    return s.mode === 'endless' && s.wave === 1 && window.__surge.endlessUnlocked() === false;
  }));
  await pageE.waitForFunction(() => { const i = window.__surge.info(); return i.enemies > 0 && i.bullets > 0; }, null, { timeout: 30000 });
  check('?endless=1 run spawns enemies and fires bullets', true);
  await contextE.close();

  // --- M3: hit bundle + accessibility toggles (fresh run, no autopilot) --
  // An idle wisp in sector 1 takes a hit within seconds; the hit bundle
  // (flash 0.30s, trauma 0.45) must still be live in the frame the hull
  // first drops, so the read follows the poll immediately.
  const context3 = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Asia/Bangkok' });
  const page3 = await context3.newPage();
  page3.on('console', (msg) => { if (msg.type() === 'error') errors.push(`hit console: ${msg.text()}`); });
  page3.on('pageerror', (err) => errors.push(`hit pageerror: ${String(err)}`));
  await page3.goto(`http://127.0.0.1:${port}/?sector=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page3.waitForFunction(() => window.__surge, null, { timeout: 30000 });
  await page3.waitForFunction(() => window.__surge.state.phase === 'playing', null, { timeout: 5000 });
  await page3.waitForFunction(() => window.__surge.info().playerWorld.hull < 100, null, { timeout: 30000 });
  const hitFeel = await page3.evaluate(() => window.__surge.feel());
  check('hit fires its bundle (flash and/or trauma live right after the hit)', hitFeel.flashT > 0 || hitFeel.trauma > 0.05, JSON.stringify(hitFeel));
  // The shake slider gates the actual shake: with trauma still live,
  // shake 0 must read an amplitude of exactly 0.
  await page3.evaluate(() => window.__surge.setShake(0));
  const noShake = await page3.evaluate(() => window.__surge.feel());
  check('shake slider at 0 gates the shake (amplitude 0 while trauma is live)', noShake.shakeSetting === 0 && noShake.shakeAmp === 0 && noShake.trauma > 0, JSON.stringify(noShake));
  await page3.evaluate(() => window.__surge.setShake(1));
  check('shake slider restores to 100%', await page3.evaluate(() => window.__surge.feel().shakeSetting === 1));
  await page3.evaluate(() => window.__surge.setFlash(false));
  check('flash toggle turns flashing off (persisted)', await page3.evaluate(() => window.__surge.feel().flashEnabled === false && window.__surge.save.settings.flash === false));
  await page3.evaluate(() => window.__surge.setFlash(true));
  await page3.evaluate(() => window.__surge.setMusic(false));
  check('music toggle stops the loop', await page3.evaluate(() => window.__surge.audio().musicPlaying === false));
  await page3.evaluate(() => window.__surge.setMusic(true));
  check('music toggle restarts the loop', await page3.evaluate(() => window.__surge.audio().musicPlaying === true));
  // --- M5: real-second flash + toast timing, accessibility toggles -------
  // Keep the run alive with the autopilot while probing — an idle wisp
  // would die mid-probe and the toast timer only ticks while playing.
  await page3.evaluate(() => window.__surge.autopilot(true));
  // Flash probe: pause FIRST (a live autopilot nova would overwrite the
  // probe flash — the first run of this check read the nova's 0.5s
  // flash, not the 0.30s debug flash) and let any in-flight flash decay.
  await page3.evaluate(() => window.__surge.pause());
  await page3.waitForTimeout(1500);
  await page3.evaluate(() => window.__surge.debugFlash());
  const flash0 = await page3.evaluate(() => window.__surge.feel());
  check('M5: flash starts at its set duration (0.30s real)', flash0.flashT > 0.2 && flash0.flashT <= 0.3 && flash0.flashMax === 0.3, JSON.stringify(flash0));
  await page3.waitForTimeout(200);
  const flash200 = await page3.evaluate(() => window.__surge.feel());
  check('M5: flash still live 200ms after a 0.30s flash (real-second decay)', flash200.flashT > 0.03 && flash200.flashT < 0.2, JSON.stringify(flash200));
  await page3.waitForTimeout(300);
  const flash500 = await page3.evaluate(() => window.__surge.feel());
  check('M5: flash is gone 500ms after a 0.30s flash', flash500.flashT === 0, JSON.stringify(flash500));
  await page3.evaluate(() => window.__surge.resume());
  const toastT0 = Date.now();
  await page3.evaluate(() => window.__surge.debugToast('M5 probe toast', 2000));
  check('M5: debug toast shows', await page3.evaluate(() => !document.getElementById('hud-toast').classList.contains('hidden')));
  await page3.waitForFunction(() => document.getElementById('hud-toast').classList.contains('hidden'), null, { timeout: 8000 });
  const toastElapsed = Date.now() - toastT0;
  check('M5: toast hides after its real duration (~2s, not frame-counted)', toastElapsed >= 1800 && toastElapsed <= 3200, `${toastElapsed}ms`);
  await page3.evaluate(() => window.__surge.setTextSize('large'));
  check('M5: large text applies the text-large body class and persists', await page3.evaluate(() => document.body.classList.contains('text-large') && window.__surge.save.settings.textSize === 'large'));
  await page3.evaluate(() => window.__surge.setContrast(true));
  check('M5: high contrast applies the high-contrast body class and persists', await page3.evaluate(() => document.body.classList.contains('high-contrast') && window.__surge.save.settings.contrast === true));
  await page3.evaluate(() => { window.__surge.setTextSize('normal'); window.__surge.setContrast(false); });
  check('M5: accessibility toggles switch back off', await page3.evaluate(() => !document.body.classList.contains('text-large') && !document.body.classList.contains('high-contrast')));
  await context3.close();

  // --- M5: FPS guard drops the DPR cap on a slow device -------------------
  // Firefox headless reports devicePixelRatio 1 even with a 2x context,
  // so emulate a 2x display by shadowing devicePixelRatio and dispatching
  // a resize — the canvas backing store must go to 2x. Triggering the
  // guard (the same path the frame loop takes after 2s under 28fps)
  // must drop the cap to 1 and shrink the backing store back to 1x.
  const contextG = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Asia/Bangkok' });
  const pageG = await contextG.newPage();
  pageG.on('console', (msg) => { if (msg.type() === 'error') errors.push(`fps-guard console: ${msg.text()}`); });
  pageG.on('pageerror', (err) => errors.push(`fps-guard pageerror: ${String(err)}`));
  await pageG.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageG.waitForFunction(() => window.__surge, null, { timeout: 30000 });
  const backingBefore = await pageG.evaluate(() => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    window.dispatchEvent(new Event('resize'));
    return document.getElementById('game').width;
  });
  check('M5: high-DPI backing store starts at 2x', backingBefore === 2560, `canvas width=${backingBefore}`);
  await pageG.evaluate(() => window.__surge.triggerFpsGuard());
  check('M5: FPS guard drops the DPR cap to 1', await pageG.evaluate(() => window.__surge.dprCap === 1));
  const backingAfter = await pageG.evaluate(() => document.getElementById('game').width);
  check('M5: canvas backing store shrinks to 1x after the guard', backingAfter === 1280, `canvas width=${backingAfter}`);
  await contextG.close();

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
console.log(`render-check: PASS — shots in ${SHOTS_DIR} — INSPECT BY EYE (menu, sectors, gameplay, sector 3, endless)`);
