// Neon Surge v0.2.3 — Node smoke tests for physics.js (no DOM, no Canvas).
// Covers sector validity, movement (screen-space asserted — Drift M2
// lesson), polarity swap, absorb/charge, hull damage, nova, enemy types,
// sector clear/lose, saves, and the anti-slop gates on sector 1 (the full
// 12-sector bot gate lives in tests/bot.js). Exit 0 when all pass.
// Usage: node tests/smoke.js
import {
  VERSION, ARENA_W, ARENA_H, DT, PLAYER_R, PLAYER_SPEED, PLAYER_ACCEL,
  SWAP_COOLDOWN, HULL_MAX, CHARGE_MAX, NOVA_COST, NOVA_DAMAGE,
  ABSORB_CHARGE, ABSORB_SCORE, ABSORB_RADIUS, BULLET_R,
  HIT_DAMAGE, HIT_INVULN, CONTACT_DAMAGE, KILL_SCORE,
  ENEMY_TYPES, SPINNER_RING_COUNT, WEAVER_SPREAD_COUNT, SNIPER_TELEGRAPH, SURGE_WINDOW,
  FEEDBACK, FEEDBACK_TIERS, FEEDBACK_LAYERS,
  SECTORS, sectorById, createRun, stepRun, drainEvents, cloneRun,
  simulateRun, createDecisionBot, createNoSwapBot, createSitStillBot, createRandomBot,
  defaultSave, serializeSave, parseSave, recordBest, isSectorUnlocked, bestFor,
  SAVE_VERSION, mulberry32, clamp, worldToScreen,
} from '../physics.js';

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

console.log('smoke: version + sectors');
check('physics version is 0.2.3', VERSION === '0.2.3');
check('12 sectors defined', SECTORS.length === 12);
check('sector ids are 1..12 in order', SECTORS.every((s, i) => s.id === i + 1));
check('every sector has a name, hint, par and accent', SECTORS.every((s) => s.name && s.hint && s.par > 0 && s.accent));
check('sector names are distinct', new Set(SECTORS.map((s) => s.name)).size === SECTORS.length);
check('sector accents are distinct', new Set(SECTORS.map((s) => s.accent)).size === SECTORS.length);
check('sectorById finds sector 2', sectorById(2) && sectorById(2).name === 'Crossfire');
check('sectorById returns null for 99', sectorById(99) === null);
check('bullet speed rises across all 12 sectors', SECTORS.every((s, i) => i === 0 || s.bulletSpeed > SECTORS[i - 1].bulletSpeed));
check('par times rise across all 12 sectors', SECTORS.every((s, i) => i === 0 || s.par > SECTORS[i - 1].par));

// --- sector validity ---
for (const def of SECTORS) {
  check(`sector ${def.id} "${def.name}" has 12+ spawns`, def.spawns.length >= 12, `${def.spawns.length} spawns`);
  check(`sector ${def.id} spawns are sorted by time`, def.spawns.every((s, i) => i === 0 || s.t >= def.spawns[i - 1].t));
  check(`sector ${def.id} spawn types are all valid`, def.spawns.every((s) => ENEMY_TYPES[s.type]));
  check(`sector ${def.id} spawn polarities are cyan/magenta`, def.spawns.every((s) => s.pol === 'cyan' || s.pol === 'magenta'));
  check(`sector ${def.id} hover points are inside the arena`, def.spawns.every((s) => s.hx >= 60 && s.hx <= ARENA_W - 60 && s.hy >= 50 && s.hy <= ARENA_H - 50));
  const types = new Set(def.spawns.map((s) => s.type));
  check(`sector ${def.id} uses all 4 enemy types`, types.size === 4, [...types].join(','));
  const pols = def.spawns.reduce((a, s) => { a[s.pol] = (a[s.pol] || 0) + 1; return a; }, {});
  check(`sector ${def.id} mixes both polarities`, (pols.cyan || 0) >= 4 && (pols.magenta || 0) >= 4, JSON.stringify(pols));
  check(`sector ${def.id} has at least one spinner`, def.spawns.some((s) => s.type === 'spinner'));
  check(`sector ${def.id} has at least one sniper`, def.spawns.some((s) => s.type === 'sniper'));
  check(`sector ${def.id} last spawn is before its par`, def.spawns[def.spawns.length - 1].t < def.par);
  // No dead space: consecutive waves are never more than 4s apart, so the
  // arena never goes quiet between spawns (the nova pull-forward in
  // physics.js covers the post-nova case).
  check(`sector ${def.id} has no spawn gap over 4s`, def.spawns.every((s, i) => i === 0 || s.t - def.spawns[i - 1].t <= 4.0));
}
// Sector 1 teaches: slow, single-colour opening, first swap telegraphed.
{
  const s1 = SECTORS[0];
  check('sector 1 first 4 spawns are all cyan (single-colour opening)', s1.spawns.slice(0, 4).every((s) => s.pol === 'cyan'));
  check('sector 1 first spawn is at t=1.0 (no instant pressure)', s1.spawns[0].t === 1.0);
  check('sector 1 first enemy is a drifter (the simplest type)', s1.spawns[0].type === 'drifter');
  const firstMagenta = s1.spawns.find((s) => s.pol === 'magenta');
  check('sector 1 first magenta spawn carries a swap telegraph', !!firstMagenta && !!firstMagenta.telegraph);
  check('sector 1 first magenta arrives after t=10 (time to learn absorb first)', firstMagenta && firstMagenta.t >= 10);
  check('sector 1 telegraph names the swap key', firstMagenta.telegraph.includes('SPACE'));
  check('sector 1 has the slowest bullets', s1.bulletSpeed < SECTORS[1].bulletSpeed);
}
// Sector 2 is magenta-heavy (the no-swap gate's pressure), sector 12
// densest (the finale), sector 3 still denser than sectors 1-2.
{
  const s2 = SECTORS[1], s3 = SECTORS[2], s12 = SECTORS[11];
  const mag2 = s2.spawns.filter((s) => s.pol === 'magenta').length;
  check('sector 2 is magenta-heavy', mag2 > s2.spawns.length / 2, `${mag2}/${s2.spawns.length} magenta`);
  check('sector 3 is denser than sectors 1-2', s3.spawns.length > s2.spawns.length && s3.spawns.length > SECTORS[0].spawns.length);
  check('sector 3 has 3+ spinners (ring pressure)', s3.spawns.filter((s) => s.type === 'spinner').length >= 3);
  check('sector 12 has the most spawns', s12.spawns.length >= Math.max(...SECTORS.map((s) => s.spawns.length)), `${s12.spawns.length} spawns`);
  check('sector 12 has the fastest bullets', s12.bulletSpeed === Math.max(...SECTORS.map((s) => s.bulletSpeed)));
  // M2: sector 2's opening is softened by spacing, not count cuts — the
  // two opening weavers are staggered and the drifters arrive one at a time.
  check('sector 2 opening weavers are staggered (no mixed fire at t=0)', s2.spawns[0].t < s2.spawns[1].t);
  check('sector 2 opening drifters are staggered', s2.spawns[2].t < s2.spawns[3].t);
  check('sector 2 keeps its full 22 spawns (no count cuts)', s2.spawns.length === 22);
  // M2 playtest fixes: sector 5 keeps its magenta pressure (17) but
  // feeds the absorb economy early — 5 cyan spawns in the first 11s so
  // charge can build before the sniper flood; sector 12's opening is
  // staggered like sector 2's.
  const s5 = SECTORS[4];
  check('sector 5 keeps 17 magenta spawns (no-swap pressure intact)', s5.spawns.filter((s) => s.pol === 'magenta').length === 17,
    `${s5.spawns.filter((s) => s.pol === 'magenta').length} magenta`);
  check('sector 5 has cyan food in the opening (5 cyan spawns by t=11)', s5.spawns.filter((s) => s.t <= 11 && s.pol === 'cyan').length >= 5,
    `${s5.spawns.filter((s) => s.t <= 11 && s.pol === 'cyan').length} cyan by t=11`);
  check('sniper telegraph is 0.85s (readable in a bullet storm)', SNIPER_TELEGRAPH === 0.85);
  check('sector 12 opening is staggered (spinner alone at t=1.0)', s12.spawns[0].t < s12.spawns[1].t);
  check('sector 12 second spinner is staggered (t=6.0, not 4.5)', s12.spawns.filter((s) => s.type === 'spinner').map((s) => s.t).includes(6.0));
}

// --- enemy type table ---
check('drifter hp 40, weaver 60, sniper 50, spinner 100', ENEMY_TYPES.drifter.hp === 40 && ENEMY_TYPES.weaver.hp === 60 && ENEMY_TYPES.sniper.hp === 50 && ENEMY_TYPES.spinner.hp === 100);
check('nova damage 100 one-shots every enemy type', NOVA_DAMAGE >= Math.max(...Object.values(ENEMY_TYPES).map((t) => t.hp)));
check('kill scores rise with threat (spinner worth most)', KILL_SCORE.spinner > KILL_SCORE.weaver && KILL_SCORE.weaver >= KILL_SCORE.drifter);
check('spinner ring has 14 bullets', SPINNER_RING_COUNT === 14);
check('weaver spread has 5 bullets', WEAVER_SPREAD_COUNT === 5);

// --- movement ---
{
  const run = createRun(1);
  const p = run.player;
  check('player starts centered near the bottom', approx(p.x, ARENA_W / 2) && p.y === ARENA_H - 90);
  check('player starts cyan, full hull, empty charge', p.pol === 'cyan' && p.hull === HULL_MAX && p.charge === 0);
  check('run starts playing with score 0', run.phase === 'playing' && run.score === 0);
  // Hold right: accelerates to max speed (45 steps: far from the wall).
  for (let i = 0; i < 45; i++) stepRun(run, { mx: 1, my: 0 });
  check('holding right reaches max speed', approx(Math.hypot(p.vx, p.vy), PLAYER_SPEED, 1), `speed=${Math.hypot(p.vx, p.vy).toFixed(1)}`);
  check('holding right moves the player right', p.x > ARENA_W / 2 + 200, `x=${p.x.toFixed(1)}`);
  // Hold left from center: moves left.
  const lrun = createRun(1);
  for (let i = 0; i < 90; i++) stepRun(lrun, { mx: -1, my: 0 });
  check('holding left moves the player left', lrun.player.x < ARENA_W / 2 - 200, `x=${lrun.player.x.toFixed(1)}`);
  // Friction stops the player with no input.
  const frun = createRun(1);
  for (let i = 0; i < 30; i++) stepRun(frun, { mx: 1, my: 0 });
  const vxBefore = frun.player.vx;
  for (let i = 0; i < 120; i++) stepRun(frun, { mx: 0, my: 0 });
  check('no input brings the player to a stop', approx(frun.player.vx, 0, 0.01) && approx(frun.player.vy, 0, 0.01), `vx=${frun.player.vx.toFixed(2)}`);
  check('player had real velocity before friction stopped it', vxBefore > 100, `vx=${vxBefore.toFixed(1)}`);
  // Diagonal movement is normalized (no diagonal speed exploit).
  // 15 steps: up to speed but short of the bottom wall, where the clamp
  // zeroes vy and the diagonal input's wasted y-component holds vx at
  // 338.7 (correct physics — the wall eats the y push).
  const drun = createRun(1);
  for (let i = 0; i < 15; i++) stepRun(drun, { mx: 1, my: 1 });
  check('diagonal speed is capped at max speed', approx(Math.hypot(drun.player.vx, drun.player.vy), PLAYER_SPEED, 0.5), `speed=${Math.hypot(drun.player.vx, drun.player.vy).toFixed(1)}`);
  // Arena clamp.
  const crun = createRun(1);
  for (let i = 0; i < 600; i++) stepRun(crun, { mx: -1, my: -1 });
  check('player clamps to the arena corner', crun.player.x === PLAYER_R && crun.player.y === PLAYER_R);
  check('player never leaves the arena', crun.player.x >= PLAYER_R && crun.player.x <= ARENA_W - PLAYER_R && crun.player.y >= PLAYER_R && crun.player.y <= ARENA_H - PLAYER_R);
}

// --- screen space (Drift M2 lesson): input direction == screen direction ---
{
  const viewW = 1280, viewH = 720;
  const run = createRun(1);
  const before = worldToScreen(run.player.x, run.player.y, viewW, viewH);
  for (let i = 0; i < 30; i++) stepRun(run, { mx: -1, my: 0 });
  const afterLeft = worldToScreen(run.player.x, run.player.y, viewW, viewH);
  check('screen space: holding left moves the wisp left ON SCREEN', afterLeft.x < before.x, `${before.x.toFixed(1)} -> ${afterLeft.x.toFixed(1)}`);
  const run2 = createRun(1);
  const b2 = worldToScreen(run2.player.x, run2.player.y, viewW, viewH);
  for (let i = 0; i < 30; i++) stepRun(run2, { mx: 1, my: 0 });
  const afterRight = worldToScreen(run2.player.x, run2.player.y, viewW, viewH);
  check('screen space: holding right moves the wisp right ON SCREEN', afterRight.x > b2.x);
  const run3 = createRun(1);
  const b3 = worldToScreen(run3.player.x, run3.player.y, viewW, viewH);
  for (let i = 0; i < 30; i++) stepRun(run3, { mx: 0, my: -1 });
  const afterUp = worldToScreen(run3.player.x, run3.player.y, viewW, viewH);
  check('screen space: holding up moves the wisp up ON SCREEN', afterUp.y < b3.y);
  const run4 = createRun(1);
  const b4 = worldToScreen(run4.player.x, run4.player.y, viewW, viewH);
  for (let i = 0; i < 30; i++) stepRun(run4, { mx: 0, my: 1 });
  const afterDown = worldToScreen(run4.player.x, run4.player.y, viewW, viewH);
  check('screen space: holding down moves the wisp down ON SCREEN', afterDown.y > b4.y);
  // Letterbox: portrait viewport centers the arena with bars.
  const portrait = worldToScreen(ARENA_W / 2, ARENA_H / 2, 1080, 2340);
  check('screen space: portrait viewport centers the arena horizontally', approx(portrait.x, 540, 1), `x=${portrait.x.toFixed(1)}`);
  check('screen space: portrait viewport letterboxes vertically', portrait.y > 700, `y=${portrait.y.toFixed(1)}`);
  const wide = worldToScreen(0, 0, 2560, 1080);
  check('screen space: ultrawide viewport letterboxes horizontally', wide.x > 300, `x=${wide.x.toFixed(1)}`);
  check('worldToScreen is the identity direction (no mirror)', worldToScreen(100, 100, 960, 600).x < worldToScreen(200, 100, 960, 600).x);
}

// --- polarity swap ---
{
  const run = createRun(1);
  const p = run.player;
  stepRun(run, { swap: true });
  check('swap flips polarity instantly', p.pol === 'magenta');
  check('swap emits a swap event naming the new polarity', drainEvents(run).some((e) => e.type === 'swap' && e.pol === 'magenta'));
  check('swap starts a short cooldown', p.swapCd > 0 && p.swapCd <= SWAP_COOLDOWN);
  stepRun(run, { swap: true });
  check('swap during cooldown does nothing', p.pol === 'magenta');
  for (let i = 0; i < Math.ceil(SWAP_COOLDOWN / DT) + 1; i++) stepRun(run, {});
  stepRun(run, { swap: true });
  check('swap works again after the cooldown', p.pol === 'cyan');
  // No auto-swap: polarity never changes without input.
  const nrun = createRun(1);
  nrun.spawnQueue = [{ t: 999, type: 'drifter', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 150 }];
  for (let i = 0; i < 600; i++) stepRun(nrun, { mx: 0.3, my: -0.2 });
  check('polarity never changes without a swap input (no auto-swap)', nrun.player.pol === 'cyan');
}

// --- absorb ---
{
  const run = createRun(1);
  run.spawnQueue = [{ t: 999, type: 'drifter', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 150 }];
  const p = run.player;
  run.bullets.push({ x: p.x + 10, y: p.y, vx: 0, vy: 0, pol: 'cyan', r: BULLET_R, age: 0 });
  const chargeBefore = p.charge, scoreBefore = run.score;
  stepRun(run, {});
  check('same-polarity bullet is absorbed (removed)', run.bullets.length === 0);
  check('absorb builds charge', p.charge === chargeBefore + ABSORB_CHARGE, `charge=${p.charge}`);
  check('absorb scores points', run.score === scoreBefore + ABSORB_SCORE);
  check('absorb increments the absorb count', run.absorbs === 1);
  check('absorb emits an absorb event with polarity + charge', drainEvents(run).some((e) => e.type === 'absorb' && e.pol === 'cyan' && e.charge === p.charge));
  // Absorb radius is generous but not infinite.
  run.bullets.push({ x: p.x + ABSORB_RADIUS + 30, y: p.y, vx: 0, vy: 0, pol: 'cyan', r: BULLET_R, age: 0 });
  stepRun(run, {});
  check('a bullet outside absorb range is not absorbed', run.bullets.length === 1);
  // Charge caps at 100.
  p.charge = CHARGE_MAX - 2;
  run.bullets.push({ x: p.x, y: p.y, vx: 0, vy: 0, pol: 'cyan', r: BULLET_R, age: 0 });
  stepRun(run, {});
  check('charge caps at the maximum', p.charge === CHARGE_MAX);
  // Absorb chains a combo.
  check('absorbs chain a combo', run.combo >= 1 && run.maxCombo >= 1);
}

// --- hull damage ---
{
  const run = createRun(1);
  run.spawnQueue = [{ t: 999, type: 'drifter', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 150 }];
  const p = run.player;
  run.bullets.push({ x: p.x, y: p.y, vx: 0, vy: 0, pol: 'magenta', r: BULLET_R, age: 0 });
  stepRun(run, {});
  check('opposite-polarity bullet damages hull', p.hull === HULL_MAX - HIT_DAMAGE, `hull=${p.hull}`);
  check('hit increments the hit count', run.hits === 1);
  check('hit starts invulnerability', p.invuln > 0 && p.invuln <= HIT_INVULN);
  check('hit emits a hit event with the bullet polarity', drainEvents(run).some((e) => e.type === 'hit' && e.pol === 'magenta'));
  check('hit resets the absorb combo', run.combo === 0);
  run.bullets.push({ x: p.x, y: p.y, vx: 0, vy: 0, pol: 'magenta', r: BULLET_R, age: 0 });
  const hullBefore = p.hull;
  stepRun(run, {});
  check('a second bullet during invulnerability does not damage', p.hull === hullBefore);
  // Enemy contact damages too.
  const crun = createRun(1);
  crun.spawnQueue = [{ t: 999, type: 'drifter', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 150 }];
  crun.enemies.push({ id: 999, type: 'drifter', x: crun.player.x, y: crun.player.y, hx: crun.player.x, hy: crun.player.y, pol: 'cyan', hp: 40, maxHp: 40, r: 16, fireT: 99, age: 0, angle: 0, entering: false, telegraphT: 0, swayPhase: 0 });
  stepRun(crun, {});
  check('touching an enemy damages hull', crun.player.hull === HULL_MAX - CONTACT_DAMAGE, `hull=${crun.player.hull}`);
  // Hull at 0 loses the sector.
  const lrun = createRun(1);
  lrun.spawnQueue = [{ t: 999, type: 'drifter', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 150 }];
  lrun.player.hull = 1;
  lrun.bullets.push({ x: lrun.player.x, y: lrun.player.y, vx: 0, vy: 0, pol: 'magenta', r: BULLET_R, age: 0 });
  stepRun(lrun, {});
  check('hull at 0 loses the sector', lrun.phase === 'lost');
  check('loss emits a lost event', drainEvents(lrun).some((e) => e.type === 'lost'));
}

// --- nova ---
{
  const run = createRun(1);
  run.spawnQueue = [];
  const p = run.player;
  p.charge = NOVA_COST - 1;
  run.bullets.push({ x: 100, y: 100, vx: 0, vy: 0, pol: 'magenta', r: BULLET_R, age: 0 });
  run.enemies.push({ id: 1, type: 'drifter', x: 200, y: 200, hx: 200, hy: 200, pol: 'cyan', hp: 40, maxHp: 40, r: 16, fireT: 99, age: 0, angle: 0, entering: false, telegraphT: 0, swayPhase: 0 });
  stepRun(run, { nova: true });
  check('nova without full charge does nothing', run.bullets.length === 1 && run.enemies.length === 1 && p.charge === NOVA_COST - 1);
  p.charge = NOVA_COST;
  stepRun(run, { nova: true });
  check('nova spends exactly its cost', p.charge === 0, `charge=${p.charge}`);
  check('nova clears every bullet on screen', run.bullets.length === 0);
  check('nova kills the enemy (100 damage)', run.enemies.length === 0);
  check('nova counts kills and score', run.kills === 1 && run.score >= KILL_SCORE.drifter);
  check('nova increments the nova count', run.novas === 1);
  check('nova emits a nova event with clears + kills', drainEvents(run).some((e) => e.type === 'nova' && e.cleared === 1 && e.kills === 1));
  check('nova grants brief invulnerability', p.invuln > 0);
  // Nova on a full field: spinner (100 hp) dies, ring bullets vanish.
  const run2 = createRun(3);
  run2.spawnQueue = [];
  run2.player.charge = CHARGE_MAX;
  run2.enemies.push({ id: 2, type: 'spinner', x: 480, y: 200, hx: 480, hy: 200, pol: 'magenta', hp: 100, maxHp: 100, r: 22, fireT: 99, age: 0, angle: 0, entering: false, telegraphT: 0, swayPhase: 0 });
  for (let i = 0; i < 20; i++) run2.bullets.push({ x: 100 + i * 10, y: 100, vx: 0, vy: 0, pol: i % 2 ? 'cyan' : 'magenta', r: BULLET_R, age: 0 });
  stepRun(run2, { nova: true });
  check('nova one-shots a spinner', run2.enemies.length === 0);
  check('nova clears a 20-bullet field', run2.bullets.length === 0);
  // M2 post-nova lull fix: after a nova, the next wave arrives within
  // ~1.0s instead of leaving a ~5s near-empty arena. Sector 1's next
  // wave after t=1.0 sits at t=4.5 — a nova at ~t=1.1 must pull it to
  // ~t=2.1, keeping the remaining spawns' relative spacing.
  const run3 = createRun(1);
  while (run3.time < 1.05) stepRun(run3, {});
  run3.player.charge = CHARGE_MAX;
  const nextBefore = run3.spawnQueue[0].t;
  const secondBefore = run3.spawnQueue[1].t;
  stepRun(run3, { nova: true });
  check('nova pulls the next wave forward (no post-nova lull)', run3.spawnQueue[0].t <= run3.time + 1.2 && run3.spawnQueue[0].t < nextBefore,
    `next=${run3.spawnQueue[0].t.toFixed(2)} at t=${run3.time.toFixed(2)} (was ${nextBefore})`);
  // v0.2.3: the SECOND wave is compressed to +2.5s too, so 4+ enemies are
  // fighting by ~+3.5s — pulling only the first wave left the arena
  // thin (2 enemies, 1–2 bullets between volleys at +4s). Waves after
  // the second keep their relative spacing.
  check('nova compresses the second wave to +2.5s', run3.spawnQueue[1].t <= run3.time + 2.7 && run3.spawnQueue[1].t < secondBefore,
    `second=${run3.spawnQueue[1].t.toFixed(2)} at t=${run3.time.toFixed(2)} (was ${secondBefore})`);
  const thirdBefore = 11.0; // S1's third wave sits at t=11.0, gap 3.0 after the second
  check('nova keeps later waves in relative order', approx(run3.spawnQueue[2].t - run3.spawnQueue[1].t, thirdBefore - secondBefore, 1e-9),
    `gap=${(run3.spawnQueue[2].t - run3.spawnQueue[1].t).toFixed(2)} (was ${(thirdBefore - secondBefore).toFixed(2)})`);
  // And a nova fired when the next wave is already close does not shift it.
  const run4 = createRun(1);
  while (run4.time < 4.3) stepRun(run4, {});
  run4.player.charge = CHARGE_MAX;
  const next4 = run4.spawnQueue[0].t;
  stepRun(run4, { nova: true });
  check('nova leaves an imminent wave alone', run4.spawnQueue[0].t === next4, `next=${run4.spawnQueue[0].t} (was ${next4})`);
  // M2 post-nova surge: enemies spawned inside the surge window arrive
  // already at their hover point and firing, so the arena rebuilds in
  // ~2s instead of going quiet for ~8s (live playtest 03:55, sector 9).
  const run5 = createRun(1);
  while (run5.time < 1.05) stepRun(run5, {});
  run5.player.charge = CHARGE_MAX;
  stepRun(run5, { nova: true });
  check('nova opens a surge window', run5.surgeT > 0, `surgeT=${run5.surgeT}`);
  const before5 = run5.enemies.length;
  while (run5.enemies.length === before5) stepRun(run5, {});
  const surgeEnemy = run5.enemies[run5.enemies.length - 1];
  // entering=false proves it spawned at the hover point; drifters sway
  // from the first tick, so assert nearness (sway amplitude 46), not
  // exact equality.
  check('surge spawn arrives already at its hover point (no entry glide)', !surgeEnemy.entering && Math.hypot(surgeEnemy.x - surgeEnemy.hx, surgeEnemy.y - surgeEnemy.hy) <= 50,
    `entering=${surgeEnemy.entering} at (${surgeEnemy.x.toFixed(0)},${surgeEnemy.y.toFixed(0)}) hover (${surgeEnemy.hx},${surgeEnemy.hy})`);
  check('surge spawn fires within ~1s', surgeEnemy.fireT <= 0.9, `fireT=${surgeEnemy.fireT.toFixed(2)}`);
  // And a spawn with no surge window glides in normally (fresh runs have
  // surgeT 0 — the surge is strictly a post-nova state).
  const run6 = createRun(1);
  run6.spawnQueue = [{ t: run6.time, type: 'drifter', x: 200, y: -24, pol: 'cyan', hx: 200, hy: 200 }];
  stepRun(run6, {});
  const lateEnemy = run6.enemies[run6.enemies.length - 1];
  check('spawn with no surge window glides in normally', lateEnemy.entering === true && lateEnemy.y < lateEnemy.hy,
    `entering=${lateEnemy.entering} y=${lateEnemy.y} hy=${lateEnemy.hy}`);
}

// --- enemy fire patterns ---
{
  // Drifter fires a single aimed bullet.
  const run = createRun(1);
  run.spawnQueue = [];
  const e = { id: 1, type: 'drifter', x: 480, y: 150, hx: 480, hy: 150, pol: 'cyan', hp: 40, maxHp: 40, r: 16, fireT: 0.01, age: 0, angle: 0, entering: false, telegraphT: 0, swayPhase: 0 };
  run.enemies.push(e);
  stepRun(run, {});
  check('drifter fires one aimed bullet', run.bullets.length === 1);
  check('drifter bullet flies toward the player', run.bullets[0].vy > 0, `vy=${run.bullets[0].vy.toFixed(1)}`);
  check('drifter bullet carries the enemy polarity', run.bullets[0].pol === 'cyan');
  // Weaver fires a 5-bullet spread.
  const wrun = createRun(1);
  wrun.spawnQueue = [];
  wrun.enemies.push({ id: 2, type: 'weaver', x: 480, y: 150, hx: 480, hy: 150, pol: 'magenta', hp: 60, maxHp: 60, r: 17, fireT: 0.01, age: 0, angle: 0, entering: false, telegraphT: 0, swayPhase: 0 });
  stepRun(wrun, {});
  check('weaver fires a 5-bullet spread', wrun.bullets.length === WEAVER_SPREAD_COUNT, `${wrun.bullets.length} bullets`);
  check('weaver spread bullets share the enemy polarity', wrun.bullets.every((b) => b.pol === 'magenta'));
  // Spinner fires a 14-bullet ring with alternating polarity.
  const srun = createRun(1);
  srun.spawnQueue = [];
  srun.enemies.push({ id: 3, type: 'spinner', x: 480, y: 200, hx: 480, hy: 200, pol: 'cyan', hp: 100, maxHp: 100, r: 22, fireT: 0.01, age: 0, angle: 0, entering: false, telegraphT: 0, swayPhase: 0 });
  stepRun(srun, {});
  check('spinner fires a 14-bullet ring', srun.bullets.length === SPINNER_RING_COUNT, `${srun.bullets.length} bullets`);
  const ringPols = srun.bullets.map((b) => b.pol);
  check('spinner ring alternates polarity (no safe polarity inside it)', ringPols.some((p, i) => i > 0 && p !== ringPols[i - 1]));
  check('spinner ring has both polarities', new Set(ringPols).size === 2);
  check('spinner ring bullets fly outward in all directions', (() => {
    const angs = srun.bullets.map((b) => Math.atan2(b.vy, b.vx));
    return Math.max(...angs) > 2 && Math.min(...angs) < -2;
  })());
  // Sniper telegraphs, then fires one fast bullet.
  const nrun = createRun(1);
  nrun.spawnQueue = [{ t: 999, type: 'drifter', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 150 }];
  nrun.enemies.push({ id: 4, type: 'sniper', x: 480, y: 100, hx: 480, hy: 100, pol: 'magenta', hp: 50, maxHp: 50, r: 15, fireT: 0.01, age: 0, angle: 0, entering: false, telegraphT: 0, swayPhase: 0 });
  stepRun(nrun, {});
  check('sniper telegraphs before firing (no bullet yet)', nrun.bullets.length === 0);
  check('sniper telegraph emits an aim event', drainEvents(nrun).some((e) => e.type === 'sniper-aim'));
  for (let i = 0; i < 60; i++) stepRun(nrun, {});
  check('sniper fires one fast bullet after the telegraph', nrun.bullets.length === 1);
  check('sniper bullet is faster than a drifter bullet', Math.hypot(nrun.bullets[0].vx, nrun.bullets[0].vy) > SECTORS[0].bulletSpeed * 1.2);
  // REGRESSION (2026-11-24): a sniper spawned through the real spawn queue
  // must actually reach its hover point and telegraph — the manual test
  // above builds the sniper with entering:false, so it never caught the
  // entry bug: sniper speed was 0, the entry glide never moved, snipers
  // sat off-screen at y=-24 with entering=true forever and never fired
  // (0 aim events in 12s of sector 5). No sniper may stay entering, and
  // at least one aim event must fire.
  const erun = createRun(1);
  erun.spawnQueue = [{ t: 0.0, type: 'sniper', x: 120, y: -24, pol: 'magenta', hx: 120, hy: 88 }];
  let sawAim = false;
  for (let i = 0; i < 60 * 8; i++) {
    stepRun(erun, {});
    if (drainEvents(erun).some((e) => e.type === 'sniper-aim')) sawAim = true;
  }
  const esniper = erun.enemies.find((e) => e.type === 'sniper');
  check('spawned sniper reaches its hover point (entry glide moves it)', !!esniper && esniper.entering === false && esniper.y === esniper.hy,
    esniper ? `entering=${esniper.entering} y=${esniper.y} hy=${esniper.hy}` : 'no sniper alive');
  check('spawned sniper telegraphs within 8s (it actually fires)', sawAim);
  check('every enemy type has a nonzero entry speed', Object.values(ENEMY_TYPES).every((t) => t.speed > 0),
    JSON.stringify(Object.fromEntries(Object.entries(ENEMY_TYPES).map(([k, v]) => [k, v.speed]))));
  // Bullets despawn off-arena.
  const brun = createRun(1);
  brun.spawnQueue = [{ t: 999, type: 'drifter', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 150 }];
  brun.bullets.push({ x: 10, y: 300, vx: -500, vy: 0, pol: 'cyan', r: BULLET_R, age: 0 });
  for (let i = 0; i < 30; i++) stepRun(brun, {});
  check('bullets despawn after leaving the arena', brun.bullets.length === 0);
}

// --- sector flow: spawns, clear, score ---
{
  const run = createRun(1);
  check('sector 1 starts with no enemies, spawns queued', run.enemies.length === 0 && run.spawnQueue.length === SECTORS[0].spawns.length);
  for (let i = 0; i < 90; i++) stepRun(run, {});
  check('enemies spawn on schedule (t=1.5s)', run.enemies.length >= 2, `${run.enemies.length} enemies`);
  check('spawn emits a spawn event', drainEvents(run).some((e) => e.type === 'spawn'));
  // A full clear via the decision bot scores time + hull bonuses.
  const smart = simulateRun(1, createDecisionBot, { maxSeconds: 150 });
  check('sector 1: decision bot clears', smart.won);
  check('sector 1: decision bot clears near par time', smart.time < SECTORS[0].par * 1.5, `${smart.time.toFixed(1)}s vs par ${SECTORS[0].par}s`);
  check('sector 1: decision bot takes few hits', smart.hits <= 10, `${smart.hits} hits`);
  check('sector 1: decision bot absorbs to earn its novas', smart.absorbs >= 20, `${smart.absorbs} absorbs`);
  const noswap = simulateRun(1, createNoSwapBot, { maxSeconds: 150 });
  check('sector 1: no-swap bot loses', !noswap.won);
  const still = simulateRun(1, createSitStillBot, { maxSeconds: 60 });
  check('sector 1: sit-still bot loses', !still.won);
  const random = simulateRun(1, () => createRandomBot(7), { maxSeconds: 120 });
  check('sector 1: random bot loses', !random.won);
  // Clear bonus: score grows with hull left.
  const run2 = createRun(1);
  run2.spawnQueue = [];
  run2.player.charge = CHARGE_MAX;
  run2.player.hull = 100;
  stepRun(run2, { nova: true });
  check('clearing with full hull scores time + hull bonuses', run2.phase === 'clear' && run2.clearBonus === 900 + 500, `bonus=${run2.clearBonus}`);
  check('clear emits a clear event with score + time', drainEvents(run2).some((e) => e.type === 'clear' && e.score > 0));
  // cloneRun snapshots without the rng/events.
  const c = cloneRun(createRun(2));
  check('cloneRun copies the run state', c.sectorId === 2 && c.phase === 'playing');
}

// --- saves ---
{
  const save = defaultSave();
  check('default save has version 1, no bests, sector 1 unlocked', save.version === SAVE_VERSION && Object.keys(save.best).length === 0 && save.unlocked === 1);
  check('sector 1 unlocked on a fresh save, sector 2 locked', isSectorUnlocked(save, 1) && !isSectorUnlocked(save, 2));
  const better = recordBest(save, 1, 3500, 39.0, 100);
  check('recordBest stores the first clear', better && save.best[1].score === 3500);
  check('clearing sector 1 unlocks sector 2', save.unlocked === 2);
  check('a worse score does not overwrite the best', !recordBest(save, 1, 100, 50, 50) && save.best[1].score === 3500);
  check('a better score overwrites the best', recordBest(save, 1, 4000, 35, 90) && save.best[1].score === 4000);
  check('bestFor returns the stored best', bestFor(save, 1).score === 4000);
  check('bestFor returns null for an uncleared sector', bestFor(save, 3) === null);
  const roundTrip = parseSave(serializeSave(save));
  check('save serializes and parses back', roundTrip.best[1].score === 4000 && roundTrip.unlocked === 2);
  check('corrupt save data falls back to defaults', parseSave('not json').unlocked === 1);
  check('old-version save falls back to defaults', parseSave(JSON.stringify({ version: 99, best: {} })).unlocked === 1);
  check('settings survive a round trip', parseSave(serializeSave({ ...save, settings: { shake: 0.5, flash: false, muted: true } })).settings.shake === 0.5);
}

// --- helpers + feel tiers ---
check('clamp holds bounds', clamp(5, 0, 10) === 5 && clamp(-1, 0, 10) === 0 && clamp(99, 0, 10) === 10);
check('mulberry32 is deterministic for the same seed', mulberry32(42)() === mulberry32(42)());
check('mulberry32 differs across seeds', mulberry32(1)() !== mulberry32(2)());
check('every feedback entry has trauma + hit-stop + layers', Object.values(FEEDBACK).every((f) => typeof f.trauma === 'number' && typeof f.hitStop === 'number' && Array.isArray(f.layers)));
check('nova is the biggest feedback tier', FEEDBACK.nova.trauma >= FEEDBACK.hit.trauma && FEEDBACK.nova.hitStop >= FEEDBACK.hit.hitStop);
check('feedback tiers are ordered small < medium < large', FEEDBACK_TIERS.small.trauma[1] <= FEEDBACK_TIERS.medium.trauma[0] && FEEDBACK_TIERS.medium.trauma[1] <= FEEDBACK_TIERS.large.trauma[0]);
check('all feedback layers are named', FEEDBACK_LAYERS.every((l) => typeof l === 'string' && l.length > 0));
check('DT is 1/60', approx(DT, 1 / 60));

console.log(`smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(`smoke: ${failures.length} failure(s): ${failures.join('; ')}`); process.exit(1); }
console.log('smoke: PASS');
