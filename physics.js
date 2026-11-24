// Neon Surge v0.5.0 — pure simulation (no DOM, no Canvas).
// 2D neon polarity bullet-hell arena: pilot a wisp; enemy bullets come in
// two polarities (cyan / magenta). Match your polarity to ABSORB bullets and
// build charge; opposite-polarity bullets damage your hull. Charge powers a
// NOVA that clears all bullets and damages every enemy. Polarity is the
// skill — there is no auto-swap, no assist, no gun. The only way to kill an
// enemy is a well-timed nova, and the only way to earn a nova is to absorb.
//
// M4: Endless Drift — seeded waves built from the 12 sectors' patterns,
// scaling in count and bullet speed; clear ranks (S/A/B from hull left);
// best Endless result saved separately.
//
// Anti-slop gates (tests/bot.js):
//   - decision bot (real swap + nova decisions) clears all 12 sectors
//   - no-swap bot (same movement/nova, never swaps) loses all 12
//   - sit-still bot loses all 12
//   - endless: decision bot reaches wave 4+; no-swap / sit-still die in
//     wave 1-2
// A sector the no-swap bot clears is not done — tighten the bullet mix.

export const VERSION = '0.5.0';
export const ARENA_W = 960;
export const ARENA_H = 600;
export const DT = 1 / 60;
export const SAVE_KEY = 'neon-surge-save-v1';
export const SAVE_VERSION = 1;

// --- player ---
export const PLAYER_R = 13;
export const PLAYER_SPEED = 340;      // px/s top speed
export const PLAYER_ACCEL = 2800;     // px/s^2 toward input direction
export const PLAYER_FRICTION = 2600;  // px/s^2 decel with no input
export const SWAP_COOLDOWN = 0.12;    // s — swap still feels instant
export const HULL_MAX = 100;
export const CHARGE_MAX = 100;
export const NOVA_COST = 65;         // ~11 absorbs per nova — charge is earned, not given
export const NOVA_DAMAGE = 100;
export const NOVA_INVULN = 0.6;       // s of safety after a nova
export const ABSORB_CHARGE = 6;       // charge per absorbed bullet
export const ABSORB_SCORE = 10;
export const ABSORB_RADIUS = 27;      // generous catch radius
export const BULLET_R = 6;
export const HIT_DAMAGE = 16;         // hull lost to an opposite bullet
export const HIT_INVULN = 0.45;       // s of safety after a hit
export const CONTACT_DAMAGE = 15;     // hull lost touching an enemy
export const CONTACT_INVULN = 0.8;
export const KILL_CHARGE = 0;         // charge comes ONLY from absorbing — the core loop
export const NOVA_CLEAR_CHARGE = 0;   // a nova earns nothing by itself; absorbs pay for the next one
export const KILL_SCORE = { drifter: 100, weaver: 150, sniper: 150, spinner: 300 };
export const COMBO_WINDOW = 1.2;      // s — absorbs inside the window chain

// --- enemies ---
// hp / radius / score / base speed / fire interval / bullet-speed factor
// NOTE: speed must be > 0 for EVERY type — it drives the entry glide
// (updateEnemy: step = speed * 2.2 * DT), and an enemy with speed 0 never
// reaches its hover point, stays entering=true forever, and never fires.
// That was the sniper bug (2026-11-24: sniper speed was 0, so no sniper
// in any sector ever telegraphed or fired — the M1/M2 playtests were
// judging a game with a dead enemy type).
export const ENEMY_TYPES = {
  drifter: { hp: 40, r: 16, score: 100, speed: 46, fireInterval: 1.9, bulletFactor: 1.0, fireKind: 'aimed' },
  weaver: { hp: 60, r: 17, score: 150, speed: 72, fireInterval: 2.0, bulletFactor: 1.0, fireKind: 'spread3' },
  sniper: { hp: 50, r: 15, score: 150, speed: 120, fireInterval: 2.6, bulletFactor: 1.75, fireKind: 'aimed' },
  spinner: { hp: 100, r: 22, score: 300, speed: 26, fireInterval: 2.7, bulletFactor: 0.9, fireKind: 'ring' },
};
export const SPINNER_RING_COUNT = 14; // ring bullets, alternating polarity
export const WEAVER_SPREAD_COUNT = 5;
export const WEAVER_SPREAD_ANGLE = 0.2; // rad between spread bullets
export const AIM_LEAD = 0.25;         // s — aimed bullets lead the player
export const SNIPER_TELEGRAPH = 0.85; // s of warning before a sniper fires (M2: 0.65 was too brief to read in a bullet storm)
export const SURGE_WINDOW = 6.0;      // s after a nova during which new spawns arrive already fighting (M2 post-nova lull fix; 4.0s covered only the next wave — the arena still felt empty)

// --- game feel tiers (same recipe as the 3D skill; engine-agnostic) ---
// FEEDBACK is the single source of truth for what each event should feel
// like: trauma (shake = trauma^2), hit-stop, and the layers the renderer
// must fire. game.js honours the whole table — an event whose layers are
// listed here but never rendered is a bug, not a design choice (M3).
// Small tier: 0.10–0.20 trauma, no hit-stop. Medium: 0.30–0.50, 0.04–0.06s
// stop. Large: 0.70–1.00, 0.10–0.15s stop.
export const FEEDBACK = {
  absorb: { trauma: 0.12, hitStop: 0, layers: ['sound', 'particles', 'pop'] },
  swap: { trauma: 0.10, hitStop: 0, layers: ['sound', 'flash-ring'] },
  hit: { trauma: 0.45, hitStop: 0.05, layers: ['sound', 'particles', 'shake', 'flash', 'pop'] },
  kill: { trauma: 0.25, hitStop: 0.03, layers: ['sound', 'particles', 'shake', 'pop', 'flash-ring'] },
  nova: { trauma: 0.85, hitStop: 0.12, layers: ['sound', 'particles', 'shake', 'flash', 'slow-mo', 'shockwave', 'pop'] },
  clear: { trauma: 0.40, hitStop: 0.08, layers: ['sound', 'particles', 'shake', 'flash', 'shockwave', 'pop'] },
  lost: { trauma: 0.70, hitStop: 0.10, layers: ['sound', 'particles', 'shake', 'flash', 'slow-mo', 'pop'] },
  'nova-ready': { trauma: 0.15, hitStop: 0, layers: ['sound', 'particles', 'pop'] },
  'sniper-shot': { trauma: 0, hitStop: 0, layers: ['sound'] },
  'sniper-aim': { trauma: 0, hitStop: 0, layers: ['sound'] },
  ring: { trauma: 0, hitStop: 0, layers: ['sound'] },
  spawn: { trauma: 0, hitStop: 0, layers: ['particles'] },
  telegraph: { trauma: 0, hitStop: 0, layers: ['sound'] },
  // M4 (Endless Drift): a wave starting is a small moment (banner +
  // two-note horn); clearing one is a medium moment (bonus + arpeggio).
  'wave-start': { trauma: 0.10, hitStop: 0, layers: ['sound', 'pop'] },
  'wave-clear': { trauma: 0.25, hitStop: 0, layers: ['sound', 'particles', 'pop'] },
};
// Absorb streaks that earn a milestone pop + chime (game.js): the combo
// itself is the score, the milestone is the celebration.
export const STREAK_MILESTONES = [5, 10, 15, 20, 30, 40, 50];
export const FEEDBACK_TIERS = {
  small: { trauma: [0.10, 0.20], hitStop: 0 },
  medium: { trauma: [0.30, 0.50], hitStop: [0.04, 0.06] },
  large: { trauma: [0.70, 1.00], hitStop: [0.10, 0.15] },
};
export const FEEDBACK_LAYERS = ['sound', 'particles', 'shake', 'flash', 'pop', 'slow-mo', 'shockwave', 'flash-ring'];

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Letterbox fit of the logical arena into a viewport. Screen space is the
// truth for movement tests (Drift M2 lesson): moving left must move the
// wisp left ON SCREEN, not just in world coordinates.
export function worldToScreen(x, y, viewW, viewH) {
  const scale = Math.min(viewW / ARENA_W, viewH / ARENA_H);
  const ox = (viewW - ARENA_W * scale) / 2;
  const oy = (viewH - ARENA_H * scale) / 2;
  return { x: ox + x * scale, y: oy + y * scale, scale, ox, oy };
}

// --- sectors -------------------------------------------------------------
// spawns: { t, type, x, y, pol, hx, hy, telegraph? }
//   x,y = entry point (often just outside the arena); hx,hy = hover/park
//   point the enemy settles at. telegraph = toast text shown when it spawns.
// bulletSpeed = base px/s for this sector's bullets.
export const SECTORS = [
  {
    id: 1, name: 'First Light', accent: '#22d3ee', par: 60,
    hint: 'Slow cyan bullets first. Absorb them — when magenta comes, swap.',
    bulletSpeed: 160,
    spawns: [
      { t: 1.0, type: 'drifter', x: 240, y: -24, pol: 'cyan', hx: 240, hy: 150 },
      { t: 1.0, type: 'drifter', x: 720, y: -24, pol: 'cyan', hx: 720, hy: 150 },
      { t: 4.5, type: 'drifter', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 110 },
      { t: 8.0, type: 'weaver', x: -24, y: 300, pol: 'cyan', hx: 200, hy: 300 },
      { t: 11.0, type: 'drifter', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 185,
        telegraph: 'MAGENTA INCOMING — press SPACE to swap!' },
      { t: 12.0, type: 'drifter', x: 660, y: -24, pol: 'magenta', hx: 660, hy: 185 },
      { t: 15.5, type: 'weaver', x: 984, y: 330, pol: 'magenta', hx: 760, hy: 330 },
      { t: 15.5, type: 'weaver', x: -24, y: 420, pol: 'magenta', hx: 220, hy: 420 },
      { t: 18.5, type: 'weaver', x: -24, y: 200, pol: 'magenta', hx: 220, hy: 200 },
      { t: 21.0, type: 'sniper', x: 120, y: -24, pol: 'magenta', hx: 120, hy: 88 },
      { t: 21.0, type: 'sniper', x: 840, y: -24, pol: 'cyan', hx: 840, hy: 88 },
      { t: 24.0, type: 'spinner', x: 480, y: -30, pol: 'cyan', hx: 480, hy: 175 },
      { t: 27.0, type: 'drifter', x: 200, y: -24, pol: 'magenta', hx: 200, hy: 210 },
      { t: 27.0, type: 'drifter', x: 760, y: -24, pol: 'cyan', hx: 760, hy: 210 },
      { t: 30.0, type: 'weaver', x: -24, y: 420, pol: 'cyan', hx: 240, hy: 420 },
      { t: 33.0, type: 'spinner', x: 660, y: -30, pol: 'magenta', hx: 660, hy: 250 },
      { t: 33.0, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 140 },
    ],
  },
  {
    id: 2, name: 'Crossfire', accent: '#f472b6', par: 80,
    hint: 'Mixed fire from both sides. Swap to the nearest threat, nova when the sky is full.',
    bulletSpeed: 215,
    spawns: [
      // M2: opening softened by spawn spacing/timing, NOT count cuts
      // (Bastion lesson — count cuts starve the charge economy). The
      // magenta weaver used to arrive at t=1.0 alongside the cyan one;
      // it now joins at t=2.5, and the two drifters are staggered.
      { t: 1.0, type: 'weaver', x: -24, y: 260, pol: 'cyan', hx: 210, hy: 260 },
      { t: 2.5, type: 'weaver', x: 984, y: 340, pol: 'magenta', hx: 750, hy: 340 },
      { t: 4.5, type: 'drifter', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 160 },
      { t: 5.5, type: 'drifter', x: 660, y: -24, pol: 'magenta', hx: 660, hy: 160 },
      { t: 6.5, type: 'sniper', x: 840, y: -24, pol: 'magenta', hx: 840, hy: 88 },
      { t: 6.5, type: 'sniper', x: 120, y: -24, pol: 'magenta', hx: 120, hy: 88 },
      { t: 6.5, type: 'weaver', x: -24, y: 480, pol: 'magenta', hx: 210, hy: 480 },
      { t: 10.0, type: 'spinner', x: 480, y: -30, pol: 'magenta', hx: 480, hy: 180 },
      { t: 10.0, type: 'weaver', x: -24, y: 460, pol: 'magenta', hx: 220, hy: 460 },
      { t: 13.5, type: 'weaver', x: -24, y: 200, pol: 'cyan', hx: 210, hy: 200 },
      { t: 13.5, type: 'weaver', x: 984, y: 420, pol: 'magenta', hx: 750, hy: 420 },
      { t: 17.0, type: 'drifter', x: 240, y: -24, pol: 'magenta', hx: 240, hy: 190 },
      { t: 17.0, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 140 },
      { t: 17.0, type: 'drifter', x: 720, y: -24, pol: 'cyan', hx: 720, hy: 190 },
      { t: 21.0, type: 'sniper', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 70 },
      { t: 21.0, type: 'sniper', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 90 },
      { t: 24.5, type: 'spinner', x: 300, y: -30, pol: 'cyan', hx: 300, hy: 205 },
      { t: 24.5, type: 'spinner', x: 660, y: -30, pol: 'magenta', hx: 660, hy: 205 },
      { t: 24.5, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 260 },
      { t: 28.0, type: 'weaver', x: -24, y: 360, pol: 'magenta', hx: 210, hy: 360 },
      { t: 28.0, type: 'weaver', x: 984, y: 240, pol: 'magenta', hx: 750, hy: 240 },
      { t: 31.0, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 230 },
    ],
  },
  {
    id: 3, name: 'Vortex', accent: '#a78bfa', par: 95,
    hint: 'Rings everywhere. Ride the gaps, absorb the stream, nova the spinners.',
    bulletSpeed: 250,
    spawns: [
      { t: 1.0, type: 'spinner', x: 480, y: -30, pol: 'cyan', hx: 480, hy: 165 },
      { t: 3.0, type: 'weaver', x: -24, y: 260, pol: 'magenta', hx: 210, hy: 260 },
      { t: 3.0, type: 'weaver', x: 984, y: 340, pol: 'magenta', hx: 750, hy: 340 },
      { t: 6.0, type: 'sniper', x: 120, y: -24, pol: 'magenta', hx: 120, hy: 82 },
      { t: 6.0, type: 'sniper', x: 840, y: -24, pol: 'cyan', hx: 840, hy: 82 },
      { t: 6.0, type: 'sniper', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 66 },
      { t: 9.5, type: 'drifter', x: 200, y: -24, pol: 'cyan', hx: 200, hy: 170 },
      { t: 9.5, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 130 },
      { t: 9.5, type: 'drifter', x: 760, y: -24, pol: 'magenta', hx: 760, hy: 170 },
      { t: 9.5, type: 'weaver', x: 984, y: 480, pol: 'magenta', hx: 750, hy: 480 },
      { t: 13.0, type: 'spinner', x: 300, y: -30, pol: 'magenta', hx: 300, hy: 220 },
      { t: 13.0, type: 'spinner', x: 660, y: -30, pol: 'cyan', hx: 660, hy: 220 },
      { t: 17.0, type: 'weaver', x: -24, y: 200, pol: 'cyan', hx: 210, hy: 200 },
      { t: 17.0, type: 'weaver', x: 984, y: 420, pol: 'magenta', hx: 750, hy: 420 },
      { t: 17.0, type: 'weaver', x: -24, y: 460, pol: 'magenta', hx: 210, hy: 460 },
      { t: 21.0, type: 'sniper', x: 200, y: -24, pol: 'cyan', hx: 200, hy: 90 },
      { t: 21.0, type: 'sniper', x: 760, y: -24, pol: 'magenta', hx: 760, hy: 90 },
      { t: 25.0, type: 'spinner', x: 480, y: -30, pol: 'magenta', hx: 480, hy: 265 },
      { t: 28.5, type: 'drifter', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 215 },
      { t: 28.5, type: 'drifter', x: 660, y: -24, pol: 'cyan', hx: 660, hy: 215 },
      { t: 28.5, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 250 },
      { t: 28.5, type: 'sniper', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 60 },
      { t: 32.0, type: 'weaver', x: 984, y: 240, pol: 'magenta', hx: 750, hy: 240 },
      { t: 32.0, type: 'weaver', x: -24, y: 360, pol: 'cyan', hx: 210, hy: 360 },
    ],
  },
  {
    id: 4, name: 'Twin Currents', accent: '#38bdf8', par: 105,
    hint: 'Paired streams cross the arena — cyan from the left, magenta from the right. Ride one stream, then the other.',
    bulletSpeed: 260,
    spawns: [
      { t: 1.0, type: 'weaver', x: -24, y: 260, pol: 'cyan', hx: 210, hy: 260 },
      { t: 2.5, type: 'weaver', x: 984, y: 340, pol: 'magenta', hx: 750, hy: 340 },
      { t: 4.5, type: 'drifter', x: 300, y: -24, pol: 'cyan', hx: 300, hy: 160 },
      { t: 4.5, type: 'drifter', x: 660, y: -24, pol: 'magenta', hx: 660, hy: 160 },
      { t: 7.0, type: 'weaver', x: -24, y: 420, pol: 'magenta', hx: 210, hy: 420 },
      { t: 7.0, type: 'weaver', x: 984, y: 200, pol: 'magenta', hx: 750, hy: 200 },
      { t: 10.0, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 140 },
      { t: 10.0, type: 'sniper', x: 120, y: -24, pol: 'cyan', hx: 120, hy: 88 },
      { t: 13.0, type: 'weaver', x: -24, y: 300, pol: 'magenta', hx: 210, hy: 300 },
      { t: 13.0, type: 'weaver', x: 984, y: 360, pol: 'magenta', hx: 750, hy: 360 },
      { t: 16.0, type: 'spinner', x: 480, y: -30, pol: 'cyan', hx: 480, hy: 180 },
      { t: 16.0, type: 'drifter', x: 240, y: -24, pol: 'magenta', hx: 240, hy: 220 },
      { t: 19.5, type: 'sniper', x: 840, y: -24, pol: 'magenta', hx: 840, hy: 88 },
      { t: 19.5, type: 'weaver', x: -24, y: 460, pol: 'cyan', hx: 210, hy: 460 },
      { t: 23.0, type: 'drifter', x: 360, y: -24, pol: 'magenta', hx: 360, hy: 190 },
      { t: 23.0, type: 'drifter', x: 600, y: -24, pol: 'magenta', hx: 600, hy: 190 },
      { t: 23.0, type: 'weaver', x: 984, y: 280, pol: 'magenta', hx: 750, hy: 280 },
      { t: 26.5, type: 'spinner', x: 300, y: -30, pol: 'magenta', hx: 300, hy: 220 },
      { t: 26.5, type: 'spinner', x: 660, y: -30, pol: 'cyan', hx: 660, hy: 220 },
      { t: 30.0, type: 'weaver', x: -24, y: 200, pol: 'magenta', hx: 210, hy: 200 },
      { t: 30.0, type: 'weaver', x: 984, y: 440, pol: 'magenta', hx: 750, hy: 440 },
      { t: 33.5, type: 'sniper', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 70 },
      { t: 33.5, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 250 },
      { t: 37.0, type: 'weaver', x: -24, y: 360, pol: 'magenta', hx: 210, hy: 360 },
      { t: 37.0, type: 'weaver', x: 984, y: 240, pol: 'magenta', hx: 750, hy: 240 },
    ],
  },
  {
    id: 5, name: "Sniper's Gallery", accent: '#fbbf24', par: 110,
    hint: 'Snipers park at the edges and telegraph every shot. Watch the aim lines — dodge, then absorb the drifters between shots.',
    bulletSpeed: 265,
    spawns: [
      { t: 1.0, type: 'drifter', x: 240, y: -24, pol: 'cyan', hx: 240, hy: 150 },
      { t: 1.0, type: 'drifter', x: 720, y: -24, pol: 'magenta', hx: 720, hy: 150 },
      // M2: the live playtest starved here — score 0, absorbed 0, charge 0
      // for the whole run, because cyan food dried up at t=6.5 while the
      // magenta snipers kept coming. Three cyan drifters/weavers added in
      // the opening so the absorb→nova economy can build before the
      // magenta flood; the magenta pressure that the no-swap gate needs
      // is untouched (17 magenta spawns, same as before).
      { t: 2.0, type: 'drifter', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 170 },
      { t: 3.5, type: 'sniper', x: 120, y: -24, pol: 'magenta', hx: 120, hy: 88 },
      { t: 3.5, type: 'sniper', x: 840, y: -24, pol: 'cyan', hx: 840, hy: 88 },
      { t: 6.5, type: 'weaver', x: -24, y: 300, pol: 'magenta', hx: 210, hy: 300 },
      { t: 6.5, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 170 },
      { t: 8.0, type: 'drifter', x: 360, y: -24, pol: 'cyan', hx: 360, hy: 200 },
      { t: 9.5, type: 'sniper', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 66 },
      { t: 9.5, type: 'weaver', x: 984, y: 420, pol: 'magenta', hx: 750, hy: 420 },
      { t: 11.0, type: 'weaver', x: -24, y: 300, pol: 'cyan', hx: 210, hy: 300 },
      { t: 12.5, type: 'drifter', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 200 },
      { t: 12.5, type: 'drifter', x: 660, y: -24, pol: 'magenta', hx: 660, hy: 200 },
      { t: 15.5, type: 'sniper', x: 200, y: -24, pol: 'cyan', hx: 200, hy: 90 },
      { t: 15.5, type: 'sniper', x: 760, y: -24, pol: 'magenta', hx: 760, hy: 90 },
      { t: 18.5, type: 'weaver', x: -24, y: 200, pol: 'magenta', hx: 210, hy: 200 },
      { t: 18.5, type: 'weaver', x: 984, y: 460, pol: 'cyan', hx: 750, hy: 460 },
      { t: 21.5, type: 'spinner', x: 480, y: -30, pol: 'magenta', hx: 480, hy: 190 },
      { t: 21.5, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 140 },
      { t: 25.0, type: 'sniper', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 80 },
      { t: 25.0, type: 'sniper', x: 660, y: -24, pol: 'cyan', hx: 660, hy: 80 },
      { t: 28.0, type: 'weaver', x: -24, y: 360, pol: 'magenta', hx: 210, hy: 360 },
      { t: 28.0, type: 'weaver', x: 984, y: 240, pol: 'magenta', hx: 750, hy: 240 },
      { t: 31.5, type: 'drifter', x: 240, y: -24, pol: 'magenta', hx: 240, hy: 230 },
      { t: 31.5, type: 'drifter', x: 720, y: -24, pol: 'cyan', hx: 720, hy: 230 },
      { t: 35.0, type: 'spinner', x: 480, y: -30, pol: 'cyan', hx: 480, hy: 240 },
      { t: 35.0, type: 'sniper', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 60 },
    ],
  },
  {
    id: 6, name: 'Ring Road', accent: '#34d399', par: 115,
    hint: 'Five spinners, rings everywhere. No single polarity is safe inside a ring — ride the gaps between the circles.',
    bulletSpeed: 275,
    spawns: [
      { t: 1.0, type: 'spinner', x: 480, y: -30, pol: 'cyan', hx: 480, hy: 170 },
      { t: 3.0, type: 'weaver', x: -24, y: 260, pol: 'magenta', hx: 210, hy: 260 },
      { t: 3.0, type: 'weaver', x: 984, y: 340, pol: 'magenta', hx: 750, hy: 340 },
      { t: 6.0, type: 'drifter', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 180 },
      { t: 6.0, type: 'drifter', x: 660, y: -24, pol: 'magenta', hx: 660, hy: 180 },
      { t: 9.0, type: 'spinner', x: 300, y: -30, pol: 'magenta', hx: 300, hy: 220 },
      { t: 9.0, type: 'spinner', x: 660, y: -30, pol: 'cyan', hx: 660, hy: 220 },
      { t: 12.5, type: 'weaver', x: -24, y: 420, pol: 'magenta', hx: 210, hy: 420 },
      { t: 12.5, type: 'weaver', x: 984, y: 200, pol: 'magenta', hx: 750, hy: 200 },
      { t: 15.5, type: 'sniper', x: 120, y: -24, pol: 'magenta', hx: 120, hy: 88 },
      { t: 15.5, type: 'sniper', x: 840, y: -24, pol: 'cyan', hx: 840, hy: 88 },
      { t: 18.5, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 150 },
      { t: 18.5, type: 'drifter', x: 240, y: -24, pol: 'magenta', hx: 240, hy: 230 },
      { t: 18.5, type: 'drifter', x: 720, y: -24, pol: 'magenta', hx: 720, hy: 230 },
      { t: 22.0, type: 'spinner', x: 480, y: -30, pol: 'magenta', hx: 480, hy: 250 },
      { t: 25.0, type: 'weaver', x: -24, y: 300, pol: 'magenta', hx: 210, hy: 300 },
      { t: 25.0, type: 'weaver', x: 984, y: 360, pol: 'magenta', hx: 750, hy: 360 },
      { t: 28.0, type: 'sniper', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 70 },
      { t: 28.0, type: 'drifter', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 210 },
      { t: 31.5, type: 'spinner', x: 300, y: -30, pol: 'cyan', hx: 300, hy: 200 },
      { t: 31.5, type: 'spinner', x: 660, y: -30, pol: 'magenta', hx: 660, hy: 200 },
      { t: 35.0, type: 'weaver', x: -24, y: 240, pol: 'magenta', hx: 210, hy: 240 },
      { t: 35.0, type: 'weaver', x: 984, y: 420, pol: 'magenta', hx: 750, hy: 420 },
      { t: 38.0, type: 'drifter', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 260 },
    ],
  },
  {
    id: 7, name: 'Crosswind', accent: '#fb7185', par: 120,
    hint: 'Weavers pour in from every side at once. Keep moving across the wind — a parked wisp is a dead wisp.',
    bulletSpeed: 285,
    spawns: [
      { t: 1.0, type: 'weaver', x: -24, y: 260, pol: 'cyan', hx: 210, hy: 260 },
      { t: 2.5, type: 'weaver', x: 984, y: 340, pol: 'magenta', hx: 750, hy: 340 },
      { t: 4.5, type: 'weaver', x: -24, y: 460, pol: 'magenta', hx: 210, hy: 460 },
      { t: 4.5, type: 'weaver', x: 984, y: 200, pol: 'magenta', hx: 750, hy: 200 },
      { t: 7.0, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 150 },
      { t: 7.0, type: 'drifter', x: 240, y: -24, pol: 'magenta', hx: 240, hy: 200 },
      { t: 9.5, type: 'weaver', x: -24, y: 360, pol: 'magenta', hx: 210, hy: 360 },
      { t: 9.5, type: 'weaver', x: 984, y: 280, pol: 'magenta', hx: 750, hy: 280 },
      { t: 12.0, type: 'sniper', x: 120, y: -24, pol: 'cyan', hx: 120, hy: 88 },
      { t: 12.0, type: 'sniper', x: 840, y: -24, pol: 'magenta', hx: 840, hy: 88 },
      { t: 15.0, type: 'spinner', x: 480, y: -30, pol: 'cyan', hx: 480, hy: 180 },
      { t: 15.0, type: 'weaver', x: -24, y: 200, pol: 'magenta', hx: 210, hy: 200 },
      { t: 18.0, type: 'weaver', x: 984, y: 440, pol: 'magenta', hx: 750, hy: 440 },
      { t: 18.0, type: 'weaver', x: -24, y: 420, pol: 'magenta', hx: 210, hy: 420 },
      { t: 21.0, type: 'drifter', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 220 },
      { t: 21.0, type: 'drifter', x: 660, y: -24, pol: 'magenta', hx: 660, hy: 220 },
      { t: 24.0, type: 'sniper', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 70 },
      { t: 24.0, type: 'weaver', x: -24, y: 300, pol: 'cyan', hx: 210, hy: 300 },
      { t: 27.0, type: 'spinner', x: 300, y: -30, pol: 'magenta', hx: 300, hy: 230 },
      { t: 27.0, type: 'spinner', x: 660, y: -30, pol: 'cyan', hx: 660, hy: 230 },
      { t: 30.0, type: 'weaver', x: 984, y: 360, pol: 'magenta', hx: 750, hy: 360 },
      { t: 30.0, type: 'weaver', x: -24, y: 240, pol: 'magenta', hx: 210, hy: 240 },
      { t: 33.0, type: 'drifter', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 250 },
      { t: 33.0, type: 'drifter', x: 240, y: -24, pol: 'magenta', hx: 240, hy: 180 },
      { t: 36.0, type: 'weaver', x: -24, y: 460, pol: 'magenta', hx: 210, hy: 460 },
      { t: 36.0, type: 'weaver', x: 984, y: 180, pol: 'magenta', hx: 750, hy: 180 },
    ],
  },
  {
    id: 8, name: 'Magenta Tide', accent: '#e879f9', par: 125,
    hint: 'A magenta flood with cyan seams. Live in magenta, dip into cyan only to feed the nova.',
    bulletSpeed: 295,
    spawns: [
      { t: 1.0, type: 'drifter', x: 240, y: -24, pol: 'magenta', hx: 240, hy: 160 },
      { t: 1.0, type: 'drifter', x: 720, y: -24, pol: 'magenta', hx: 720, hy: 160 },
      { t: 3.0, type: 'weaver', x: -24, y: 300, pol: 'magenta', hx: 210, hy: 300 },
      { t: 3.0, type: 'weaver', x: 984, y: 360, pol: 'cyan', hx: 750, hy: 360 },
      { t: 5.5, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 140 },
      { t: 5.5, type: 'drifter', x: 300, y: -24, pol: 'cyan', hx: 300, hy: 200 },
      { t: 8.0, type: 'sniper', x: 120, y: -24, pol: 'magenta', hx: 120, hy: 88 },
      { t: 8.0, type: 'sniper', x: 840, y: -24, pol: 'magenta', hx: 840, hy: 88 },
      { t: 10.5, type: 'weaver', x: -24, y: 420, pol: 'magenta', hx: 210, hy: 420 },
      { t: 10.5, type: 'weaver', x: 984, y: 200, pol: 'magenta', hx: 750, hy: 200 },
      { t: 13.0, type: 'spinner', x: 480, y: -30, pol: 'magenta', hx: 480, hy: 190 },
      { t: 13.0, type: 'drifter', x: 660, y: -24, pol: 'magenta', hx: 660, hy: 210 },
      { t: 15.5, type: 'drifter', x: 200, y: -24, pol: 'magenta', hx: 200, hy: 230 },
      { t: 15.5, type: 'drifter', x: 760, y: -24, pol: 'magenta', hx: 760, hy: 230 },
      { t: 18.0, type: 'weaver', x: -24, y: 260, pol: 'cyan', hx: 210, hy: 260 },
      { t: 18.0, type: 'weaver', x: 984, y: 340, pol: 'magenta', hx: 750, hy: 340 },
      { t: 20.5, type: 'sniper', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 70 },
      { t: 20.5, type: 'sniper', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 90 },
      { t: 23.0, type: 'spinner', x: 300, y: -30, pol: 'cyan', hx: 300, hy: 220 },
      { t: 23.0, type: 'spinner', x: 660, y: -30, pol: 'magenta', hx: 660, hy: 220 },
      { t: 25.5, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 180 },
      { t: 25.5, type: 'weaver', x: -24, y: 360, pol: 'magenta', hx: 210, hy: 360 },
      { t: 28.0, type: 'weaver', x: 984, y: 440, pol: 'magenta', hx: 750, hy: 440 },
      { t: 28.0, type: 'drifter', x: 720, y: -24, pol: 'magenta', hx: 720, hy: 200 },
      { t: 30.5, type: 'spinner', x: 480, y: -30, pol: 'magenta', hx: 480, hy: 250 },
      { t: 30.5, type: 'sniper', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 60 },
      { t: 33.0, type: 'drifter', x: 240, y: -24, pol: 'cyan', hx: 240, hy: 240 },
      { t: 33.0, type: 'drifter', x: 720, y: -24, pol: 'magenta', hx: 720, hy: 240 },
    ],
  },
  {
    id: 9, name: 'The Spiral', accent: '#2dd4bf', par: 130,
    hint: 'Spinners stack their rings into a spiral. Absorb the streams between the rings and nova the stack.',
    bulletSpeed: 305,
    spawns: [
      { t: 1.0, type: 'spinner', x: 480, y: -30, pol: 'cyan', hx: 480, hy: 170 },
      { t: 2.5, type: 'weaver', x: -24, y: 300, pol: 'magenta', hx: 210, hy: 300 },
      { t: 2.5, type: 'weaver', x: 984, y: 360, pol: 'magenta', hx: 750, hy: 360 },
      { t: 5.0, type: 'spinner', x: 300, y: -30, pol: 'magenta', hx: 300, hy: 220 },
      { t: 5.0, type: 'spinner', x: 660, y: -30, pol: 'cyan', hx: 660, hy: 220 },
      { t: 8.0, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 150 },
      { t: 8.0, type: 'weaver', x: -24, y: 200, pol: 'magenta', hx: 210, hy: 200 },
      { t: 10.5, type: 'sniper', x: 120, y: -24, pol: 'magenta', hx: 120, hy: 88 },
      { t: 10.5, type: 'sniper', x: 840, y: -24, pol: 'cyan', hx: 840, hy: 88 },
      { t: 13.0, type: 'weaver', x: -24, y: 440, pol: 'magenta', hx: 210, hy: 440 },
      { t: 13.0, type: 'weaver', x: 984, y: 240, pol: 'magenta', hx: 750, hy: 240 },
      { t: 15.5, type: 'spinner', x: 480, y: -30, pol: 'magenta', hx: 480, hy: 250 },
      { t: 15.5, type: 'drifter', x: 240, y: -24, pol: 'cyan', hx: 240, hy: 210 },
      { t: 18.0, type: 'weaver', x: -24, y: 360, pol: 'magenta', hx: 210, hy: 360 },
      { t: 18.0, type: 'weaver', x: 984, y: 280, pol: 'magenta', hx: 750, hy: 280 },
      { t: 20.5, type: 'drifter', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 190 },
      { t: 20.5, type: 'drifter', x: 660, y: -24, pol: 'cyan', hx: 660, hy: 190 },
      { t: 23.0, type: 'sniper', x: 200, y: -24, pol: 'cyan', hx: 200, hy: 90 },
      { t: 23.0, type: 'sniper', x: 760, y: -24, pol: 'magenta', hx: 760, hy: 90 },
      { t: 25.5, type: 'spinner', x: 300, y: -30, pol: 'cyan', hx: 300, hy: 200 },
      { t: 25.5, type: 'spinner', x: 660, y: -30, pol: 'magenta', hx: 660, hy: 200 },
      { t: 28.0, type: 'weaver', x: -24, y: 260, pol: 'magenta', hx: 210, hy: 260 },
      { t: 28.0, type: 'weaver', x: 984, y: 420, pol: 'magenta', hx: 750, hy: 420 },
      { t: 30.5, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 230 },
      { t: 30.5, type: 'drifter', x: 240, y: -24, pol: 'cyan', hx: 240, hy: 180 },
      { t: 33.0, type: 'spinner', x: 480, y: -30, pol: 'magenta', hx: 480, hy: 180 },
      { t: 33.0, type: 'weaver', x: -24, y: 460, pol: 'magenta', hx: 210, hy: 460 },
      { t: 36.0, type: 'sniper', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 70 },
      { t: 36.0, type: 'weaver', x: 984, y: 300, pol: 'magenta', hx: 750, hy: 300 },
    ],
  },
  {
    id: 10, name: 'Ambush Alley', accent: '#f97316', par: 135,
    hint: 'Snipers and spinners trade ambushes down the alley. Never sit in one lane — the next shot is already aimed there.',
    bulletSpeed: 315,
    spawns: [
      { t: 1.0, type: 'sniper', x: 120, y: -24, pol: 'magenta', hx: 120, hy: 88 },
      { t: 1.0, type: 'sniper', x: 840, y: -24, pol: 'cyan', hx: 840, hy: 88 },
      { t: 3.0, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 160 },
      { t: 3.0, type: 'weaver', x: -24, y: 300, pol: 'magenta', hx: 210, hy: 300 },
      { t: 5.5, type: 'spinner', x: 480, y: -30, pol: 'cyan', hx: 480, hy: 180 },
      { t: 5.5, type: 'drifter', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 200 },
      { t: 8.0, type: 'sniper', x: 200, y: -24, pol: 'cyan', hx: 200, hy: 90 },
      { t: 8.0, type: 'sniper', x: 760, y: -24, pol: 'magenta', hx: 760, hy: 90 },
      { t: 10.5, type: 'weaver', x: 984, y: 420, pol: 'magenta', hx: 750, hy: 420 },
      { t: 10.5, type: 'weaver', x: -24, y: 200, pol: 'magenta', hx: 210, hy: 200 },
      { t: 13.0, type: 'spinner', x: 300, y: -30, pol: 'magenta', hx: 300, hy: 220 },
      { t: 13.0, type: 'spinner', x: 660, y: -30, pol: 'cyan', hx: 660, hy: 220 },
      { t: 15.5, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 140 },
      { t: 15.5, type: 'drifter', x: 240, y: -24, pol: 'magenta', hx: 240, hy: 230 },
      { t: 18.0, type: 'sniper', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 66 },
      { t: 18.0, type: 'weaver', x: -24, y: 360, pol: 'cyan', hx: 210, hy: 360 },
      { t: 20.5, type: 'weaver', x: 984, y: 280, pol: 'magenta', hx: 750, hy: 280 },
      { t: 20.5, type: 'drifter', x: 660, y: -24, pol: 'magenta', hx: 660, hy: 210 },
      { t: 23.0, type: 'spinner', x: 480, y: -30, pol: 'cyan', hx: 480, hy: 250 },
      { t: 23.0, type: 'sniper', x: 300, y: -24, pol: 'cyan', hx: 300, hy: 80 },
      { t: 25.5, type: 'sniper', x: 660, y: -24, pol: 'magenta', hx: 660, hy: 80 },
      { t: 25.5, type: 'weaver', x: -24, y: 440, pol: 'magenta', hx: 210, hy: 440 },
      { t: 28.0, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 180 },
      { t: 28.0, type: 'weaver', x: 984, y: 240, pol: 'magenta', hx: 750, hy: 240 },
      { t: 30.5, type: 'spinner', x: 300, y: -30, pol: 'magenta', hx: 300, hy: 200 },
      { t: 30.5, type: 'spinner', x: 660, y: -30, pol: 'cyan', hx: 660, hy: 200 },
      { t: 33.0, type: 'sniper', x: 120, y: -24, pol: 'magenta', hx: 120, hy: 88 },
      { t: 33.0, type: 'drifter', x: 720, y: -24, pol: 'cyan', hx: 720, hy: 220 },
      { t: 36.0, type: 'weaver', x: -24, y: 300, pol: 'magenta', hx: 210, hy: 300 },
      { t: 36.0, type: 'weaver', x: 984, y: 380, pol: 'magenta', hx: 750, hy: 380 },
    ],
  },
  {
    id: 11, name: 'Storm Surge', accent: '#4ade80', par: 145,
    hint: 'Everything at once, faster than ever. Three-enemy waves, no safe lane — swap fast, nova often, never stop moving.',
    bulletSpeed: 325,
    spawns: [
      { t: 1.0, type: 'weaver', x: -24, y: 260, pol: 'cyan', hx: 210, hy: 260 },
      { t: 1.0, type: 'weaver', x: 984, y: 340, pol: 'magenta', hx: 750, hy: 340 },
      { t: 3.0, type: 'drifter', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 170 },
      { t: 3.0, type: 'drifter', x: 660, y: -24, pol: 'cyan', hx: 660, hy: 170 },
      { t: 3.0, type: 'sniper', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 70 },
      { t: 5.5, type: 'spinner', x: 480, y: -30, pol: 'cyan', hx: 480, hy: 190 },
      { t: 5.5, type: 'weaver', x: -24, y: 420, pol: 'magenta', hx: 210, hy: 420 },
      { t: 5.5, type: 'weaver', x: 984, y: 200, pol: 'cyan', hx: 750, hy: 200 },
      { t: 8.0, type: 'sniper', x: 120, y: -24, pol: 'cyan', hx: 120, hy: 88 },
      { t: 8.0, type: 'sniper', x: 840, y: -24, pol: 'magenta', hx: 840, hy: 88 },
      { t: 8.0, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 150 },
      { t: 10.5, type: 'weaver', x: -24, y: 300, pol: 'magenta', hx: 210, hy: 300 },
      { t: 10.5, type: 'weaver', x: 984, y: 360, pol: 'cyan', hx: 750, hy: 360 },
      { t: 10.5, type: 'drifter', x: 240, y: -24, pol: 'cyan', hx: 240, hy: 220 },
      { t: 13.0, type: 'spinner', x: 300, y: -30, pol: 'magenta', hx: 300, hy: 230 },
      { t: 13.0, type: 'spinner', x: 660, y: -30, pol: 'cyan', hx: 660, hy: 230 },
      { t: 13.0, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 260 },
      { t: 15.5, type: 'sniper', x: 200, y: -24, pol: 'magenta', hx: 200, hy: 90 },
      { t: 15.5, type: 'sniper', x: 760, y: -24, pol: 'cyan', hx: 760, hy: 90 },
      { t: 15.5, type: 'weaver', x: -24, y: 460, pol: 'cyan', hx: 210, hy: 460 },
      { t: 18.0, type: 'drifter', x: 300, y: -24, pol: 'cyan', hx: 300, hy: 200 },
      { t: 18.0, type: 'drifter', x: 660, y: -24, pol: 'magenta', hx: 660, hy: 200 },
      { t: 18.0, type: 'weaver', x: 984, y: 240, pol: 'magenta', hx: 750, hy: 240 },
      { t: 20.5, type: 'spinner', x: 480, y: -30, pol: 'cyan', hx: 480, hy: 180 },
      { t: 20.5, type: 'weaver', x: -24, y: 360, pol: 'magenta', hx: 210, hy: 360 },
      { t: 23.0, type: 'sniper', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 66 },
      { t: 23.0, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 140 },
      { t: 25.5, type: 'weaver', x: -24, y: 200, pol: 'cyan', hx: 210, hy: 200 },
      { t: 25.5, type: 'weaver', x: 984, y: 440, pol: 'magenta', hx: 750, hy: 440 },
      { t: 25.5, type: 'drifter', x: 720, y: -24, pol: 'cyan', hx: 720, hy: 230 },
      { t: 28.0, type: 'spinner', x: 300, y: -30, pol: 'magenta', hx: 300, hy: 210 },
      { t: 28.0, type: 'spinner', x: 660, y: -30, pol: 'cyan', hx: 660, hy: 210 },
      { t: 30.5, type: 'sniper', x: 120, y: -24, pol: 'magenta', hx: 120, hy: 88 },
      { t: 30.5, type: 'sniper', x: 840, y: -24, pol: 'cyan', hx: 840, hy: 88 },
      { t: 33.0, type: 'drifter', x: 240, y: -24, pol: 'magenta', hx: 240, hy: 240 },
      { t: 33.0, type: 'drifter', x: 720, y: -24, pol: 'cyan', hx: 720, hy: 240 },
      { t: 33.0, type: 'weaver', x: -24, y: 280, pol: 'magenta', hx: 210, hy: 280 },
      { t: 35.5, type: 'spinner', x: 480, y: -30, pol: 'cyan', hx: 480, hy: 250 },
      { t: 35.5, type: 'weaver', x: 984, y: 320, pol: 'cyan', hx: 750, hy: 320 },
      { t: 38.0, type: 'weaver', x: -24, y: 420, pol: 'magenta', hx: 210, hy: 420 },
      { t: 38.0, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 190 },
    ],
  },
  {
    id: 12, name: 'The Heart', accent: '#facc15', par: 155,
    hint: 'The final gauntlet — every enemy, every pattern, at full speed. The Surge itself. Clear this and the arena is yours.',
    bulletSpeed: 335,
    spawns: [
      // M2: opening softened like sector 2's (live playtest 03:55: 4 hits
      // in the first ~5s, the hottest opening in the game). The magenta
      // weaver joins at t=2.5 instead of t=1.0 and the second spinner at
      // t=6.0 instead of t=4.5. Counts unchanged.
      { t: 1.0, type: 'spinner', x: 480, y: -30, pol: 'cyan', hx: 480, hy: 170 },
      { t: 2.5, type: 'weaver', x: -24, y: 300, pol: 'magenta', hx: 210, hy: 300 },
      { t: 2.5, type: 'weaver', x: 984, y: 360, pol: 'cyan', hx: 750, hy: 360 },
      { t: 2.5, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 150 },
      { t: 4.5, type: 'spinner', x: 300, y: -30, pol: 'magenta', hx: 300, hy: 220 },
      { t: 6.0, type: 'spinner', x: 660, y: -30, pol: 'cyan', hx: 660, hy: 220 },
      { t: 7.0, type: 'sniper', x: 120, y: -24, pol: 'magenta', hx: 120, hy: 88 },
      { t: 7.0, type: 'sniper', x: 840, y: -24, pol: 'cyan', hx: 840, hy: 88 },
      { t: 7.0, type: 'weaver', x: -24, y: 420, pol: 'magenta', hx: 210, hy: 420 },
      { t: 9.5, type: 'drifter', x: 300, y: -24, pol: 'cyan', hx: 300, hy: 190 },
      { t: 9.5, type: 'drifter', x: 660, y: -24, pol: 'magenta', hx: 660, hy: 190 },
      { t: 9.5, type: 'weaver', x: 984, y: 240, pol: 'cyan', hx: 750, hy: 240 },
      { t: 12.0, type: 'spinner', x: 480, y: -30, pol: 'magenta', hx: 480, hy: 250 },
      { t: 12.0, type: 'sniper', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 66 },
      { t: 14.5, type: 'weaver', x: -24, y: 260, pol: 'magenta', hx: 210, hy: 260 },
      { t: 14.5, type: 'weaver', x: 984, y: 380, pol: 'cyan', hx: 750, hy: 380 },
      { t: 14.5, type: 'drifter', x: 240, y: -24, pol: 'magenta', hx: 240, hy: 230 },
      { t: 17.0, type: 'sniper', x: 200, y: -24, pol: 'magenta', hx: 200, hy: 90 },
      { t: 17.0, type: 'sniper', x: 760, y: -24, pol: 'cyan', hx: 760, hy: 90 },
      { t: 17.0, type: 'spinner', x: 300, y: -30, pol: 'cyan', hx: 300, hy: 210 },
      { t: 19.5, type: 'weaver', x: -24, y: 440, pol: 'cyan', hx: 210, hy: 440 },
      { t: 19.5, type: 'weaver', x: 984, y: 200, pol: 'magenta', hx: 750, hy: 200 },
      { t: 19.5, type: 'drifter', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 140 },
      { t: 22.0, type: 'spinner', x: 660, y: -30, pol: 'magenta', hx: 660, hy: 230 },
      { t: 22.0, type: 'drifter', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 240 },
      { t: 24.5, type: 'sniper', x: 480, y: -24, pol: 'cyan', hx: 480, hy: 70 },
      { t: 24.5, type: 'weaver', x: -24, y: 300, pol: 'magenta', hx: 210, hy: 300 },
      { t: 27.0, type: 'spinner', x: 480, y: -30, pol: 'cyan', hx: 480, hy: 180 },
      { t: 27.0, type: 'weaver', x: 984, y: 340, pol: 'cyan', hx: 750, hy: 340 },
      { t: 29.5, type: 'drifter', x: 480, y: -24, pol: 'magenta', hx: 480, hy: 180 },
      { t: 29.5, type: 'weaver', x: -24, y: 380, pol: 'magenta', hx: 210, hy: 380 },
      { t: 32.0, type: 'sniper', x: 300, y: -24, pol: 'magenta', hx: 300, hy: 80 },
      { t: 32.0, type: 'sniper', x: 660, y: -24, pol: 'cyan', hx: 660, hy: 80 },
      { t: 32.0, type: 'spinner', x: 480, y: -30, pol: 'magenta', hx: 480, hy: 250 },
      { t: 34.5, type: 'weaver', x: -24, y: 240, pol: 'cyan', hx: 210, hy: 240 },
      { t: 34.5, type: 'weaver', x: 984, y: 420, pol: 'magenta', hx: 750, hy: 420 },
      { t: 37.0, type: 'drifter', x: 240, y: -24, pol: 'cyan', hx: 240, hy: 220 },
      { t: 37.0, type: 'drifter', x: 720, y: -24, pol: 'magenta', hx: 720, hy: 220 },
      { t: 39.5, type: 'spinner', x: 300, y: -30, pol: 'cyan', hx: 300, hy: 200 },
      { t: 39.5, type: 'spinner', x: 660, y: -30, pol: 'magenta', hx: 660, hy: 200 },
      { t: 42.0, type: 'weaver', x: -24, y: 300, pol: 'magenta', hx: 210, hy: 300 },
      { t: 42.0, type: 'weaver', x: 984, y: 380, pol: 'cyan', hx: 750, hy: 380 },
    ],
  },
];

export function sectorById(id) { return SECTORS.find((s) => s.id === id) || null; }

// --- clear ranks + endless drift (M4) ------------------------------------
// Clear rank: the reason to replay a sector for a better result. S means
// the sector was cleared nearly untouched; A means a good clear with real
// damage taken; B means it was scraped through on low hull.
export function rankForHull(hull) {
  if (hull >= 80) return 'S';
  if (hull >= 50) return 'A';
  return 'B';
}

// Endless Drift: waves built from the 12 sectors' hand-crafted patterns,
// seeded so the same (wave, seed) always deals the same wave. Scaling:
// enemy count rises by 1 per wave (capped at 40) and bullet speed rises
// 9 px/s per wave (capped at 430, so the storm stays readable). The
// polarity mix flips wave to wave — odd waves lean magenta, even waves
// lean cyan — and neither polarity ever exceeds 65% of a wave, so no
// single polarity is ever safe to camp on.
export const ENDLESS_BASE_SEED = 20261124;
export const ENDLESS_WAVE_BREATHER = 3.0; // s between waves
export const ENDLESS_WAVE_BONUS = 250;    // score per wave cleared (x wave number)
export const ENDLESS_WAVE_HULL_BONUS = 0; // hull restored per wave cleared — 0 unless bot data says a good run ends absurdly early (M4 rule: only add +8 if the decision bot dies before wave 4)
export const ENDLESS_BULLET_SPEED_BASE = 200;
export const ENDLESS_BULLET_SPEED_STEP = 9;
export const ENDLESS_BULLET_SPEED_CAP = 430;
export const ENDLESS_WAVE_COUNT_BASE = 16;
export const ENDLESS_WAVE_COUNT_CAP = 40;

export function endlessWaveSpec(wave, seed = ENDLESS_BASE_SEED) {
  const rng = mulberry32((seed + wave * 7919) >>> 0);
  const src = SECTORS[(wave - 1) % SECTORS.length];
  const target = Math.min(ENDLESS_WAVE_COUNT_BASE + wave, ENDLESS_WAVE_COUNT_CAP);
  // Start from the source sector's hand-crafted spawn list (telegraphs
  // stripped — they name sector-1 tutorial text, not an endless wave).
  let spawns = src.spawns.map((s) => {
    const { telegraph, ...rest } = s;
    return { ...rest };
  });
  if (spawns.length > target) spawns = spawns.slice(0, target);
  while (spawns.length < target) {
    const { telegraph, ...baseRest } = src.spawns[Math.floor(rng() * src.spawns.length)];
    const last = spawns[spawns.length - 1];
    spawns.push({
      ...baseRest,
      t: last.t + 0.5 + rng() * 2.0,
      hx: clamp(baseRest.hx + (rng() - 0.5) * 120, 60, ARENA_W - 60),
      hy: clamp(baseRest.hy + (rng() - 0.5) * 80, 50, ARENA_H - 50),
    });
  }
  spawns.sort((a, b) => a.t - b.t);
  // Polarity mix: the wave leans one way by parity, but the minority
  // always holds at least 35% — there is always food for the other
  // polarity, and camping one polarity never clears a wave.
  const majority = wave % 2 === 1 ? 'magenta' : 'cyan';
  const minority = majority === 'magenta' ? 'cyan' : 'magenta';
  const countPol = (pol) => spawns.reduce((n, s) => n + (s.pol === pol ? 1 : 0), 0);
  let guard = 0;
  while (countPol(majority) < Math.ceil(spawns.length / 2) && guard++ < 200) {
    const i = spawns.findIndex((s) => s.pol === minority);
    if (i < 0) break;
    spawns[i] = { ...spawns[i], pol: majority };
  }
  guard = 0;
  while (countPol(majority) > Math.floor(spawns.length * 0.65) && guard++ < 200) {
    const idxs = spawns.map((s, i) => (s.pol === majority ? i : -1)).filter((i) => i >= 0);
    const i = idxs[Math.floor(rng() * idxs.length)];
    spawns[i] = { ...spawns[i], pol: minority };
  }
  const bulletSpeed = Math.min(ENDLESS_BULLET_SPEED_BASE + (wave - 1) * ENDLESS_BULLET_SPEED_STEP, ENDLESS_BULLET_SPEED_CAP);
  return { wave, bulletSpeed, spawns, accent: src.accent, sourceSector: src.id };
}

// --- run state -----------------------------------------------------------
let nextEnemyId = 1;

export function createRun(sectorId, opts = {}) {
  const def = sectorById(sectorId);
  if (!def) throw new Error(`no sector ${sectorId}`);
  const rng = mulberry32(opts.seed ?? sectorId * 7919 + 13);
  return {
    mode: 'sector', sectorId, def, rng,
    time: 0, phase: 'playing', // 'playing' | 'clear' | 'lost'
    player: {
      x: ARENA_W / 2, y: ARENA_H - 90, vx: 0, vy: 0,
      pol: 'cyan', hull: HULL_MAX, charge: 0,
      invuln: 0, swapCd: 0, novaCd: 0,
    },
    enemies: [], bullets: [],
    spawnQueue: def.spawns.map((s) => ({ ...s })),
    surgeT: 0, // s left of the post-nova surge window (new spawns arrive fighting)
    score: 0, absorbs: 0, kills: 0, novas: 0, hits: 0,
    combo: 0, comboT: 0, maxCombo: 0,
    events: [], clearTime: null, clearBonus: 0,
  };
}

function pushEvent(run, ev) { run.events.push(ev); }
export function drainEvents(run) { const evs = run.events; run.events = []; return evs; }

// An Endless Drift run: no fixed sector, waves generated on the fly from
// endlessWaveSpec. The run opens with a short breather (the wave banner
// reads "WAVE 1" before the first spawn) and ends only at hull 0.
export function createEndlessRun(opts = {}) {
  const seed = opts.seed ?? ENDLESS_BASE_SEED;
  return {
    mode: 'endless', sectorId: 0, endlessSeed: seed,
    def: { id: 0, name: 'Endless Drift', accent: '#fbbf24', par: 0, bulletSpeed: ENDLESS_BULLET_SPEED_BASE },
    rng: mulberry32(seed),
    time: 0, phase: 'playing', // 'playing' | 'lost' (endless never 'clear')
    player: {
      x: ARENA_W / 2, y: ARENA_H - 90, vx: 0, vy: 0,
      pol: 'cyan', hull: HULL_MAX, charge: 0,
      invuln: 0, swapCd: 0, novaCd: 0,
    },
    enemies: [], bullets: [],
    spawnQueue: [],
    surgeT: 0,
    score: 0, absorbs: 0, kills: 0, novas: 0, hits: 0,
    combo: 0, comboT: 0, maxCombo: 0,
    events: [], clearTime: null, clearBonus: 0,
    wave: 1, wavesCleared: 0, waveState: 'breather', breatherT: 2.0,
  };
}

// Deal the next wave into the spawn queue (times are wave-relative in the
// spec, so offset them from now) and retune the run to the wave's speed
// and accent. Called when a breather ends.
function startEndlessWave(run) {
  const spec = endlessWaveSpec(run.wave, run.endlessSeed);
  run.def.bulletSpeed = spec.bulletSpeed;
  run.def.accent = spec.accent;
  run.def.name = `Endless Drift — Wave ${run.wave}`;
  run.spawnQueue = spec.spawns.map((s) => ({ ...s, t: s.t + run.time + 1.0 }));
  run.waveState = 'fighting';
  pushEvent(run, { type: 'wave-start', wave: run.wave, bulletSpeed: spec.bulletSpeed, spawns: spec.spawns.length, sourceSector: spec.sourceSector });
}

function spawnEnemy(run, def) {
  const t = ENEMY_TYPES[def.type];
  // Post-nova surge (M2): enemies spawned inside the surge window arrive
  // already at their hover point and firing — the arena rebuilds in ~2s
  // after a nova instead of going quiet for ~8s while waves glide in and
  // wind up their first shot. The spawn burst (game.js) marks the spot.
  const surging = run.surgeT > 0;
  const e = {
    id: nextEnemyId++, type: def.type, x: surging ? def.hx : def.x, y: surging ? def.hy : def.y,
    hx: def.hx, hy: def.hy, pol: def.pol,
    hp: t.hp, maxHp: t.hp, r: t.r,
    fireT: surging ? 0.5 + run.rng() * 0.4 : 1.1 + run.rng() * 0.6,
    age: 0, angle: run.rng() * Math.PI * 2,
    entering: !surging, telegraphT: 0, swayPhase: run.rng() * Math.PI * 2,
  };
  run.enemies.push(e);
  pushEvent(run, { type: 'spawn', enemyType: def.type, pol: def.pol, x: e.x, y: e.y });
  if (def.telegraph) pushEvent(run, { type: 'telegraph', text: def.telegraph });
  return e;
}

function fireBullet(run, x, y, vx, vy, pol) {
  run.bullets.push({ x, y, vx, vy, pol, r: BULLET_R, age: 0 });
}

function aimedVelocity(run, e, speed) {
  const p = run.player;
  const tx = p.x + p.vx * AIM_LEAD, ty = p.y + p.vy * AIM_LEAD;
  const dx = tx - e.x, dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  return { vx: (dx / d) * speed, vy: (dy / d) * speed, angle: Math.atan2(dy, dx) };
}

function enemyFire(run, e) {
  const t = ENEMY_TYPES[e.type];
  const speed = run.def.bulletSpeed * t.bulletFactor;
  if (e.type === 'drifter' || e.type === 'sniper') {
    const v = aimedVelocity(run, e, speed);
    fireBullet(run, e.x, e.y, v.vx, v.vy, e.pol);
    if (e.type === 'sniper') pushEvent(run, { type: 'sniper-shot', x: e.x, y: e.y, pol: e.pol });
  } else if (e.type === 'weaver') {
    const v = aimedVelocity(run, e, speed);
    const half = Math.floor(WEAVER_SPREAD_COUNT / 2);
    for (let i = -half; i <= half; i++) {
      const a = v.angle + i * WEAVER_SPREAD_ANGLE;
      fireBullet(run, e.x, e.y, Math.cos(a) * speed, Math.sin(a) * speed, e.pol);
    }
  } else if (e.type === 'spinner') {
    // Ring: alternating polarity, so no single polarity is safe inside it.
    for (let i = 0; i < SPINNER_RING_COUNT; i++) {
      const a = e.angle + (i / SPINNER_RING_COUNT) * Math.PI * 2;
      const pol = i % 2 === 0 ? e.pol : (e.pol === 'cyan' ? 'magenta' : 'cyan');
      fireBullet(run, e.x, e.y, Math.cos(a) * speed, Math.sin(a) * speed, pol);
    }
    pushEvent(run, { type: 'ring', x: e.x, y: e.y, pol: e.pol });
  }
}

function updateEnemy(run, e) {
  const t = ENEMY_TYPES[e.type];
  e.age += DT;
  // Entry: glide to the hover/park point, then settle.
  if (e.entering) {
    const dx = e.hx - e.x, dy = e.hy - e.y;
    const d = Math.hypot(dx, dy);
    const step = t.speed * 2.2 * DT;
    if (d <= step + 4) { e.x = e.hx; e.y = e.hy; e.entering = false; }
    else { e.x += (dx / d) * step; e.y += (dy / d) * step; }
    return;
  }
  if (e.type === 'drifter') {
    // Slow strafe around the hover point.
    e.x = e.hx + Math.sin(e.age * 0.5 + e.swayPhase) * 46;
    e.y = e.hy + Math.sin(e.age * 0.8 + e.swayPhase) * 14;
  } else if (e.type === 'weaver') {
    e.x = e.hx + Math.sin(e.age * 0.7 + e.swayPhase) * 90;
    e.y = e.hy + Math.sin(e.age * 1.3 + e.swayPhase) * 42;
  } else if (e.type === 'spinner') {
    e.angle += DT * 1.4;
    e.x = e.hx + Math.sin(e.age * 0.4 + e.swayPhase) * 24;
    e.y = e.hy + Math.cos(e.age * 0.55 + e.swayPhase) * 16;
  }
  // Sniper parks still and telegraphs before firing.
  if (e.type === 'sniper') {
    if (e.telegraphT > 0) {
      e.telegraphT -= DT;
      if (e.telegraphT <= 0) enemyFire(run, e);
    } else {
      e.fireT -= DT;
      if (e.fireT <= 0) { e.telegraphT = SNIPER_TELEGRAPH; e.fireT = t.fireInterval; pushEvent(run, { type: 'sniper-aim', x: e.x, y: e.y, pol: e.pol }); }
    }
    return;
  }
  e.fireT -= DT;
  if (e.fireT <= 0) { enemyFire(run, e); e.fireT = t.fireInterval * (0.92 + run.rng() * 0.16); }
}

function doNova(run) {
  const p = run.player;
  p.charge -= NOVA_COST;
  p.novaCd = 0.5;
  p.invuln = Math.max(p.invuln, NOVA_INVULN);
  run.novas++;
  const cleared = run.bullets.length;
  run.bullets = [];
  let kills = 0;
  for (const e of run.enemies) e.hp -= NOVA_DAMAGE;
  const dead = run.enemies.filter((e) => e.hp <= 0);
  for (const e of dead) {
    kills++;
    run.kills++;
    run.score += KILL_SCORE[e.type];
    p.charge = clamp(p.charge + KILL_CHARGE, 0, CHARGE_MAX);
    pushEvent(run, { type: 'kill', enemyType: e.type, x: e.x, y: e.y, score: KILL_SCORE[e.type], pol: e.pol });
  }
  run.enemies = run.enemies.filter((e) => e.hp > 0);
  p.charge = clamp(p.charge + cleared * NOVA_CLEAR_CHARGE, 0, CHARGE_MAX);
  pushEvent(run, { type: 'nova', cleared, kills, charge: p.charge });
  // Post-nova lull fix (M2): a nova is the game's best moment — it must
  // not go quiet for ~5s while the next wave spawns. Pull the next wave
  // forward so it arrives within ~1.0s, and compress the SECOND wave to
  // +2.5s, keeping the remaining spawns' relative spacing (no count cuts
  // — Bastion lesson). The surge window (6.0s) covers both waves, so 4+
  // enemies are fighting again by ~+3.5s. (v0.2.2 only pulled the first
  // wave: the probe showed 2 enemies by +1s but only 4 by +4s with 1–2
  // bullets between volleys, and the live playtest still called the
  // arena quiet — the second wave is what makes it feel busy.)
  const next = run.spawnQueue[0];
  if (next) {
    if (next.t > run.time + 1.0) {
      const shift = next.t - (run.time + 1.0);
      for (const s of run.spawnQueue) s.t -= shift;
    }
    const t1 = run.spawnQueue[0].t;
    const second = run.spawnQueue.find((s) => s.t > t1 + 0.001);
    if (second && second.t > run.time + 2.5) {
      const shift2 = second.t - (run.time + 2.5);
      for (const s of run.spawnQueue) if (s.t > t1 + 0.001) s.t -= shift2;
    }
  }
  // Open the surge window: the next waves arrive already fighting (see
  // spawnEnemy). Without it the pull-forward above only fixes WHEN the
  // next wave arrives, not how fast it starts shooting — the arena still
  // went quiet for ~8s while waves glided in and wound up (live
  // playtest 2026-11-24 03:55, sector 9).
  run.surgeT = SURGE_WINDOW;
}

// input: { mx, my, swap, nova } — mx/my in [-1, 1], swap/nova booleans.
export function stepRun(run, input = {}) {
  if (run.phase !== 'playing') return;
  const p = run.player;
  run.time += DT;

  // Endless Drift: between waves the arena breathes — no spawns, no
  // win check — until the breather ends and the next wave is dealt.
  if (run.mode === 'endless' && run.waveState === 'breather') {
    run.breatherT -= DT;
    if (run.breatherT <= 0) startEndlessWave(run);
  }

  // Spawns.
  while (run.spawnQueue.length > 0 && run.spawnQueue[0].t <= run.time) {
    spawnEnemy(run, run.spawnQueue.shift());
  }

  // Polarity swap — instant, no assist: only a real input swaps.
  if (input.swap && p.swapCd <= 0) {
    p.pol = p.pol === 'cyan' ? 'magenta' : 'cyan';
    p.swapCd = SWAP_COOLDOWN;
    pushEvent(run, { type: 'swap', pol: p.pol });
  }
  // Nova — charge-powered only.
  if (input.nova && p.charge >= NOVA_COST && p.novaCd <= 0) doNova(run);

  // Movement: accelerate toward input, friction when idle, clamp to arena.
  const mx = clamp(input.mx || 0, -1, 1), my = clamp(input.my || 0, -1, 1);
  const mag = Math.hypot(mx, my);
  if (mag > 0.01) {
    const nx = mx / Math.max(mag, 1), ny = my / Math.max(mag, 1);
    p.vx += nx * PLAYER_ACCEL * DT;
    p.vy += ny * PLAYER_ACCEL * DT;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > PLAYER_SPEED) { p.vx = (p.vx / sp) * PLAYER_SPEED; p.vy = (p.vy / sp) * PLAYER_SPEED; }
  } else {
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 0) {
      const dec = PLAYER_FRICTION * DT;
      if (sp <= dec) { p.vx = 0; p.vy = 0; }
      else { p.vx -= (p.vx / sp) * dec; p.vy -= (p.vy / sp) * dec; }
    }
  }
  p.x = clamp(p.x + p.vx * DT, PLAYER_R, ARENA_W - PLAYER_R);
  p.y = clamp(p.y + p.vy * DT, PLAYER_R, ARENA_H - PLAYER_R);
  if (p.x === PLAYER_R || p.x === ARENA_W - PLAYER_R) p.vx = 0;
  if (p.y === PLAYER_R || p.y === ARENA_H - PLAYER_R) p.vy = 0;

  // Timers.
  p.invuln = Math.max(0, p.invuln - DT);
  p.swapCd = Math.max(0, p.swapCd - DT);
  p.novaCd = Math.max(0, p.novaCd - DT);
  run.surgeT = Math.max(0, run.surgeT - DT);
  run.comboT -= DT;
  if (run.comboT <= 0) run.combo = 0;

  // Enemies.
  for (const e of [...run.enemies]) updateEnemy(run, e);

  // Bullets.
  for (const b of run.bullets) { b.x += b.vx * DT; b.y += b.vy * DT; b.age += DT; }
  run.bullets = run.bullets.filter((b) => b.x > -40 && b.x < ARENA_W + 40 && b.y > -40 && b.y < ARENA_H + 40);

  // Bullet vs player: absorb same polarity, damage opposite.
  for (let i = run.bullets.length - 1; i >= 0; i--) {
    const b = run.bullets[i];
    const dx = b.x - p.x, dy = b.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (b.pol === p.pol) {
      if (d2 < ABSORB_RADIUS * ABSORB_RADIUS) {
        run.bullets.splice(i, 1);
        const wasReady = p.charge >= NOVA_COST;
        p.charge = clamp(p.charge + ABSORB_CHARGE, 0, CHARGE_MAX);
        run.absorbs++;
        run.score += ABSORB_SCORE;
        run.combo++; run.comboT = COMBO_WINDOW;
        run.maxCombo = Math.max(run.maxCombo, run.combo);
        pushEvent(run, { type: 'absorb', pol: b.pol, x: b.x, y: b.y, charge: p.charge, combo: run.combo });
        // Crossing the nova threshold is its own moment (M3): the charge
        // bar filling is silent, the READY is not — the player must hear
        // and see the instant their weapon comes online. Fires once per
        // crossing; a nova spends the charge, so it can fire again.
        if (!wasReady && p.charge >= NOVA_COST) {
          pushEvent(run, { type: 'nova-ready', charge: p.charge, x: p.x, y: p.y });
        }
      }
    } else if (p.invuln <= 0 && d2 < (PLAYER_R + b.r) * (PLAYER_R + b.r)) {
      run.bullets.splice(i, 1);
      p.hull -= HIT_DAMAGE;
      p.invuln = HIT_INVULN;
      run.hits++;
      run.combo = 0;
      pushEvent(run, { type: 'hit', pol: b.pol, x: b.x, y: b.y, hull: p.hull });
    }
  }

  // Enemy contact: touching an enemy hurts.
  if (p.invuln <= 0) {
    for (const e of run.enemies) {
      const dx = p.x - e.x, dy = p.y - e.y;
      const rr = PLAYER_R + e.r;
      if (dx * dx + dy * dy < rr * rr) {
        p.hull -= CONTACT_DAMAGE;
        p.invuln = CONTACT_INVULN;
        run.hits++;
        const d = Math.hypot(dx, dy) || 1;
        p.vx = (dx / d) * 320; p.vy = (dy / d) * 320;
        pushEvent(run, { type: 'hit', pol: e.pol, x: p.x, y: p.y, hull: p.hull, contact: true });
        break;
      }
    }
  }

  // Lose: hull gone. Checked BEFORE the win, so dying on the same tick
  // the last enemy falls is a loss, not a clear.
  if (p.hull <= 0) {
    p.hull = 0;
    run.phase = 'lost';
    pushEvent(run, { type: 'lost', score: run.score, time: run.time });
    return;
  }
  // Endless Drift: clearing a wave is not a clear — it is a breather,
  // a wave bonus, and the next wave. The run ends only at hull 0.
  if (run.mode === 'endless') {
    if (run.waveState === 'fighting' && run.spawnQueue.length === 0 && run.enemies.length === 0) {
      const clearedWave = run.wave;
      run.wavesCleared = clearedWave;
      run.wave = clearedWave + 1;
      const bonus = ENDLESS_WAVE_BONUS * clearedWave;
      run.score += bonus;
      let hullBonus = 0;
      if (ENDLESS_WAVE_HULL_BONUS > 0) {
        hullBonus = Math.min(ENDLESS_WAVE_HULL_BONUS, HULL_MAX - p.hull);
        p.hull += hullBonus;
      }
      run.waveState = 'breather';
      run.breatherT = ENDLESS_WAVE_BREATHER;
      pushEvent(run, { type: 'wave-clear', wave: clearedWave, bonus, hullBonus, score: run.score });
    }
    return;
  }
  // Win: every spawn done and every enemy dead.
  if (run.spawnQueue.length === 0 && run.enemies.length === 0) {
    run.phase = 'clear';
    run.clearTime = run.time;
    const timeBonus = Math.max(0, Math.round((run.def.par - run.time) * 15));
    const hullBonus = p.hull * 5;
    run.clearBonus = timeBonus + hullBonus;
    run.score += run.clearBonus;
    pushEvent(run, { type: 'clear', score: run.score, time: run.time, timeBonus, hullBonus });
    return;
  }
}

export function cloneRun(run) {
  return JSON.parse(JSON.stringify({ ...run, rng: undefined, events: [] }));
}

// --- saves ---------------------------------------------------------------
// best[sectorId] = { score, time, hull, rank } — rank is the clear rank
// (S/A/B from hull left). endless = { bestWave, bestScore } — the best
// Endless Drift run, saved separately from the sector bests.
export function defaultSave() {
  return {
    version: SAVE_VERSION, best: {}, unlocked: 1,
    endless: { bestWave: 0, bestScore: 0 },
    settings: { shake: 1, flash: true, muted: false, music: true, textSize: 'normal', contrast: false },
  };
}
export function serializeSave(save) { return JSON.stringify(save); }
// Migrate an old save in place: v1 saves from before M4 have no endless
// field and no rank on their bests. A best without a rank gets one derived
// from its stored hull; a best without a hull gets rank null (unknown,
// not a lie — the badge simply does not show).
function migrateBest(best) {
  const out = {};
  for (const [k, v] of Object.entries(best || {})) {
    if (!v || typeof v !== 'object') continue;
    out[k] = {
      ...v,
      rank: v.rank ?? (typeof v.hull === 'number' ? rankForHull(v.hull) : null),
    };
  }
  return out;
}
export function parseSave(raw) {
  try {
    const s = JSON.parse(raw);
    if (!s || s.version !== SAVE_VERSION || typeof s.best !== 'object') return defaultSave();
    const endless = s.endless && typeof s.endless === 'object'
      ? { bestWave: s.endless.bestWave || 0, bestScore: s.endless.bestScore || 0 }
      : { bestWave: 0, bestScore: 0 };
    return {
      ...defaultSave(), ...s,
      best: migrateBest(s.best),
      endless,
      settings: { ...defaultSave().settings, ...(s.settings || {}) },
    };
  } catch { return defaultSave(); }
}
export function recordBest(save, sectorId, score, time, hull) {
  const prev = save.best[sectorId];
  const better = !prev || score > prev.score;
  if (better) save.best[sectorId] = { score, time: Math.round(time * 100) / 100, hull, rank: rankForHull(hull) };
  if (save.unlocked < Math.min(SECTORS.length, sectorId + 1)) save.unlocked = Math.min(SECTORS.length, sectorId + 1);
  return better;
}
export function isSectorUnlocked(save, sectorId) { return sectorId <= (save.unlocked || 1); }
export function bestFor(save, sectorId) { return save.best[sectorId] || null; }
// Endless Drift unlocks by clearing Sector 1 — the core must be taught
// first, and it is reachable in one session. (The ?endless=1 playtest
// path bypasses this for the session only, like ?sector=N.)
export function isEndlessUnlocked(save) { return (save.unlocked || 1) >= 2; }
// Best Endless result: the highest wave reached wins; on a tie the
// higher score wins. Returns true when the save improved.
export function recordEndlessBest(save, wave, score) {
  if (!save.endless) save.endless = { bestWave: 0, bestScore: 0 };
  const prev = save.endless;
  const better = wave > prev.bestWave || (wave === prev.bestWave && score > prev.bestScore);
  if (better) save.endless = { bestWave: wave, bestScore: score };
  return better;
}
export function bestEndless(save) { return save.endless || { bestWave: 0, bestScore: 0 }; }

// --- bots ----------------------------------------------------------------
// All bots play ONLY through the public stepRun input hooks — no peeking at
// internals beyond the run state a player could see (positions, polarity,
// charge, hull). The decision bot makes real swap + nova decisions.
export function stationaryPolicy() { return { mx: 0, my: 0, swap: false, nova: false }; }

function steering(run, opts) {
  const p = run.player;
  const input = { mx: 0, my: 0, swap: false, nova: false };
  // Nova: spend charge when the sky is full, the field is crowded, or
  // the hull is hurting — a nova is worth more than a saved charge.
  // Tail rule: once every spawn is out, any living enemy is worth a nova
  // (a nova kills everything alive, so waiting only feeds the bullet storm).
  if (p.charge >= NOVA_COST && run.enemies.length >= 1
    && (run.enemies.length >= 3 || run.bullets.length >= 28 || p.hull <= 35
      || run.spawnQueue.length === 0)) {
    input.nova = true;
  }
  // Polarity: match the nearest bullet — the immediate threat is the one
  // that decides the next swap. (No-swap bot skips this entirely.)
  if (opts.swap) {
    let nearest = null, nd = 1e9;
    for (const b of run.bullets) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < nd) { nd = d; nearest = b; }
    }
    if (nearest && nd < 240 && nearest.pol !== p.pol) input.swap = true;
  }
  // Steering: flee opposite bullets, chase same-polarity ones to absorb,
  // keep enemies at arm's length, stay off the walls.
  let sx = 0, sy = 0;
  for (const b of run.bullets) {
    const dx = p.x - b.x, dy = p.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    if (b.pol !== p.pol && d < 230) {
      const w = ((230 - d) / 230) * 2.4;
      sx += (dx / d) * w; sy += (dy / d) * w;
    } else if (b.pol === p.pol && d < 170 && d > 32) {
      const w = ((170 - d) / 170) * 0.9;
      sx -= (dx / d) * w; sy -= (dy / d) * w;
    }
  }
  for (const e of run.enemies) {
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 80) { const w = ((80 - d) / 80) * 2.0; sx += (dx / d) * w; sy += (dy / d) * w; }
  }
  const m = 70; // wall margin
  if (p.x < m) sx += (m - p.x) / m * 1.6;
  if (p.x > ARENA_W - m) sx -= (p.x - (ARENA_W - m)) / m * 1.6;
  if (p.y < m) sy += (m - p.y) / m * 1.6;
  if (p.y > ARENA_H - m) sy -= (p.y - (ARENA_H - m)) / m * 1.6;
  // Idle drift toward the middle of the arena, so the bot never camps a corner.
  if (Math.hypot(sx, sy) < 0.15) {
    sx += (ARENA_W / 2 - p.x) / ARENA_W * 0.5;
    sy += (ARENA_H * 0.55 - p.y) / ARENA_H * 0.5;
  }
  const len = Math.hypot(sx, sy);
  if (len > 0.01) { input.mx = sx / len; input.my = sy / len; }
  return input;
}

export function createDecisionBot() {
  return { input: (run) => steering(run, { swap: true }) };
}
export function createNoSwapBot() {
  return { input: (run) => steering(run, { swap: false }) };
}
export function createSitStillBot() {
  return { input: () => stationaryPolicy() };
}
// Random masher: moves randomly, swaps at random, novas at random. Must die.
export function createRandomBot(seed = 1) {
  const rng = mulberry32(seed);
  let dir = { x: 0, y: 0 }, dirT = 0;
  return {
    input: (run) => {
      dirT -= DT;
      if (dirT <= 0) {
        const a = rng() * Math.PI * 2;
        dir = { x: Math.cos(a), y: Math.sin(a) };
        dirT = 0.3 + rng() * 0.7;
      }
      return { mx: dir.x, my: dir.y, swap: rng() < 0.02, nova: rng() < 0.01 };
    },
  };
}

export function simulateRun(sectorId, botFactory, opts = {}) {
  const maxSteps = Math.round((opts.maxSeconds || 150) * 60);
  const run = createRun(sectorId, { seed: opts.seed });
  const bot = botFactory();
  let steps = 0;
  while (run.phase === 'playing' && steps < maxSteps) {
    stepRun(run, bot.input(run));
    steps++;
  }
  return {
    won: run.phase === 'clear', lost: run.phase === 'lost',
    time: run.time, score: run.score, hull: run.player.hull,
    absorbs: run.absorbs, kills: run.kills, novas: run.novas, hits: run.hits,
    maxCombo: run.maxCombo, steps, timedOut: run.phase === 'playing',
  };
}

// Endless Drift simulation: the same bots, the same public input hooks,
// playing waves until the hull gives out. wave = the wave the bot died
// in (wavesCleared + 1); a bot that is still playing at the cap reports
// timedOut with its current wave.
export function simulateEndless(botFactory, opts = {}) {
  const maxSteps = Math.round((opts.maxSeconds || 600) * 60);
  const run = createEndlessRun({ seed: opts.seed });
  const bot = botFactory();
  let steps = 0;
  while (run.phase === 'playing' && steps < maxSteps) {
    stepRun(run, bot.input(run));
    steps++;
  }
  return {
    wave: run.wave, wavesCleared: run.wavesCleared,
    lost: run.phase === 'lost',
    time: run.time, score: run.score, hull: run.player.hull,
    absorbs: run.absorbs, kills: run.kills, novas: run.novas, hits: run.hits,
    maxCombo: run.maxCombo, steps, timedOut: run.phase === 'playing',
  };
}
