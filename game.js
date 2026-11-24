// Neon Surge v0.4.0 — 2D neon polarity bullet-hell arena (vanilla Canvas 2D).
// Pilot a wisp; enemy bullets come in cyan and magenta. Match your polarity
// to absorb bullets and build charge; opposite polarity damages your hull.
// Charge powers a nova that clears the screen. Polarity is the skill:
// no auto-swap, no assist, no gun.
import {
  VERSION, ARENA_W, ARENA_H, DT, PLAYER_R, PLAYER_SPEED,
  HULL_MAX, CHARGE_MAX, NOVA_COST, NOVA_DAMAGE, HIT_DAMAGE, ABSORB_SCORE,
  SECTORS, sectorById, createRun, createEndlessRun, rankForHull,
  stepRun, drainEvents,
  createDecisionBot, defaultSave, serializeSave, parseSave,
  recordBest, recordEndlessBest, isSectorUnlocked, isEndlessUnlocked,
  bestFor, bestEndless, SAVE_KEY,
  FEEDBACK, STREAK_MILESTONES, clamp, worldToScreen,
} from './physics.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

const COLORS = {
  cyan: '#22d3ee', cyanSoft: '#67e8f9',
  magenta: '#e879f9', magentaSoft: '#f5d0fe',
  gold: '#fbbf24', violet: '#a78bfa',
  bg: '#0b0b26', bg2: '#12123a', red: '#fb7185', green: '#34d399',
  white: '#f8fafc',
};
const POL_COLOR = { cyan: COLORS.cyan, magenta: COLORS.magenta };

// ---------------------------------------------------------------- canvas
let viewW = 0, viewH = 0, dpr = 1, view = { scale: 1, ox: 0, oy: 0 };
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = window.innerWidth; viewH = window.innerHeight;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  canvas.style.width = viewW + 'px';
  canvas.style.height = viewH + 'px';
  const s = worldToScreen(0, 0, viewW, viewH);
  view = { scale: s.scale, ox: s.ox, oy: s.oy };
}
window.addEventListener('resize', resize);
resize();
function wx2sx(x) { return view.ox + x * view.scale; }
function wy2sy(y) { return view.oy + y * view.scale; }
function sx2wx(sx) { return (sx - view.ox) / view.scale; }
function sy2wy(sy) { return (sy - view.oy) / view.scale; }

// ---------------------------------------------------------------- audio
let ac = null;
function ensureAudio() {
  if (!ac) {
    try { const AC = window.AudioContext || window.webkitAudioContext; ac = new AC(); } catch { ac = null; }
  }
  if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
}
function tone(freq, dur, type = 'sine', gain = 0.12, slideTo = 0) {
  if (!ac || muted) return;
  const t0 = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ac.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function noiseBurst(dur = 0.15, gain = 0.15, filterFreq = 1200) {
  if (!ac || muted) return;
  const t0 = ac.currentTime;
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource(); src.buffer = buf;
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq;
  const g = ac.createGain(); g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(ac.destination);
  src.start(t0);
}
const sfx = {
  swap() { tone(660, 0.07, 'triangle', 0.1, 880); },
  absorb(combo) { tone(520 + Math.min(combo, 12) * 32, 0.06, 'sine', 0.09, 780 + Math.min(combo, 12) * 32); },
  hit() { noiseBurst(0.18, 0.2, 900); tone(160, 0.18, 'sawtooth', 0.12, 70); },
  nova() { tone(180, 0.5, 'sawtooth', 0.14, 1400); noiseBurst(0.4, 0.2, 2400); tone(90, 0.4, 'sine', 0.2, 45); },
  kill() { tone(880, 0.09, 'triangle', 0.1, 1320); },
  clear() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'triangle', 0.12), i * 90)); },
  lost() { tone(220, 0.6, 'sawtooth', 0.12, 55); },
  uiTick() { tone(1200, 0.03, 'sine', 0.05); },
  denied() { tone(140, 0.12, 'square', 0.07); },
  ring() { tone(440, 0.12, 'sine', 0.05, 660); },
  aim() { tone(980, 0.05, 'sine', 0.04); },
  // M3: the moments that were silent. A sniper shot is the fastest bullet
  // in the game — it must crack. A nova coming online is the run's turning
  // point — it must chime. A streak milestone is earned — it must sing.
  shot() { noiseBurst(0.08, 0.14, 3200); tone(1500, 0.08, 'square', 0.05, 900); },
  blip() { tone(1046, 0.06, 'sine', 0.05, 1318); },
  novaReady() { [659, 880, 1318].forEach((f, i) => setTimeout(() => tone(f, 0.14, 'triangle', 0.11), i * 70)); },
  streak(combo) {
    const base = 660 + Math.min(combo, 30) * 12;
    [0, 4, 7].forEach((s, i) => setTimeout(() => tone(base * [1, 1.25, 1.5][i], 0.1, 'triangle', 0.09), i * 55));
  },
  warn() { tone(196, 0.14, 'square', 0.08, 147); setTimeout(() => tone(196, 0.14, 'square', 0.08, 147), 180); },
  // M4: an Endless wave starting gets a rising two-note horn — the wave
  // banner is seen, the horn is heard, the next storm is announced.
  wave() { tone(392, 0.14, 'triangle', 0.1, 523); setTimeout(() => tone(523, 0.18, 'triangle', 0.1, 784), 130); },
};

// ---------------------------------------------------------------- music
// Generative loop (M3): a quiet Am–F–C–G bass pulse under a sparse A-minor
// pentatonic arpeggio, scheduled ahead on the AudioContext clock. No
// samples, no assets, no autoplay — it starts on the first real gesture
// (startSector) and stops when the music toggle is off. Mute silences it
// through tone(), the same path as every SFX.
const MUSIC_BPM = 96;
const MUSIC_STEP = 60 / MUSIC_BPM / 2; // 8th notes
const MUSIC_BASS = [110.0, 87.31, 130.81, 98.0]; // A2 F2 C3 G2, one per bar
const MUSIC_ARP = [440.0, 523.25, 587.33, 659.25, 783.99, 880.0]; // A-minor pentatonic
const MUSIC_PATTERN = [0, 2, 4, 3, 5, 4, 2, 1]; // one bar of 8ths
let musicTimer = null, musicStep = 0, musicNextT = 0;
function musicOn() { return save.settings.music !== false; }
function scheduleMusic() {
  if (!ac || !musicOn()) return;
  while (musicNextT < ac.currentTime + 0.4) {
    const step = musicStep;
    const bar = Math.floor(step / 8) % MUSIC_BASS.length;
    const at = musicNextT;
    const delay = Math.max(0, (at - ac.currentTime) * 1000);
    if (step % 8 === 0) setTimeout(() => tone(MUSIC_BASS[bar], 0.5, 'triangle', 0.055), delay);
    if (step % 8 === 4) setTimeout(() => tone(MUSIC_BASS[bar] * 1.5, 0.35, 'triangle', 0.04), delay);
    // Arp: play the pattern note on ~2 of every 3 steps so the loop
    // breathes instead of ticking mechanically.
    if (step % 3 !== 2) {
      const f = MUSIC_ARP[MUSIC_PATTERN[step % 8]];
      setTimeout(() => tone(f, 0.22, 'sine', 0.028), delay);
    }
    musicStep++;
    musicNextT += MUSIC_STEP;
  }
}
function startMusic() {
  if (musicTimer !== null || !musicOn()) return;
  ensureAudio();
  if (!ac) return;
  musicNextT = ac.currentTime + 0.15;
  musicStep = 0;
  musicTimer = setInterval(scheduleMusic, 120);
}
function stopMusic() {
  if (musicTimer !== null) { clearInterval(musicTimer); musicTimer = null; }
}
function setMusic(on) {
  save.settings.music = on;
  persistSave();
  updateMusicLabels();
  if (on) startMusic(); else stopMusic();
}
function updateMusicLabels() {
  const label = musicOn() ? 'Music: On' : 'Music: Off';
  const el = $('btn-music-settings');
  if (el) el.textContent = label;
}

// ---------------------------------------------------------------- state
let save;
try { save = parseSave(localStorage.getItem(SAVE_KEY)); } catch { save = defaultSave(); }
function persistSave() { try { localStorage.setItem(SAVE_KEY, serializeSave(save)); } catch { /* private mode */ } }
let muted = save.settings.muted === true;
let phase = 'menu'; // menu | playing | pause | complete | gameover
let screenStack = [];
let run = null;
let selectedSector = Math.min(Math.max(save.unlocked || 1, 1), SECTORS.length);
let autopilot = null;       // decision-bot driver (render check + attract)
let demoRun = null, demoBot = null, demoRestartT = 0;
let transitionT = null;     // delay before the end screen shows
let toastTimer = 0;

const keys = { up: false, down: false, left: false, right: false };
let swapQueued = false, novaQueued = false;
let drag = { active: false, id: null, x: 0, y: 0, startX: 0, startY: 0, startT: 0, moved: false };

// Feel state (must return to rest values when idle — see __surge.feel()).
let trauma = 0, hitStopT = 0, slowMoT = 0, timeScale = 1, flashT = 0, flashColor = COLORS.gold;
let swapFlashT = 0, zoomT = 0, fpsEma = 60, lastTime = performance.now(), acc = 0;
let hullLowWarned = false, lastDeniedT = 0;
let waveBanner = { text: '', t: 0 }; // M4: big centre banner ("WAVE 3", "WAVE 2 CLEAR") on Endless wave starts/clears

// Particles (pooled), shockwaves, floating pops.
const particles = [];
for (let i = 0; i < 420; i++) particles.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, color: COLORS.white, drag: 2 });
function spawnParticle(x, y, vx, vy, life, size, color, drag = 2.5) {
  for (const p of particles) {
    if (p.alive) continue;
    p.alive = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.maxLife = life; p.size = size; p.color = color; p.drag = drag;
    return;
  }
}
function burst(x, y, color, n, speed, size = 3, life = 0.6) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = speed * (0.4 + Math.random() * 0.8);
    spawnParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, life * (0.6 + Math.random() * 0.7), size * (0.7 + Math.random() * 0.6), color);
  }
}
const shockwaves = [];
function addShockwave(x, y, color, maxR = 260) {
  shockwaves.push({ x, y, r: 12, maxR, life: 0.55, maxLife: 0.55, color });
}
const pops = [];
function addPop(x, y, text, color) {
  pops.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
}

// Background stars (world coords, twinkle with time).
const stars = [];
{
  let s = 12345;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 110; i++) {
    stars.push({ x: rnd() * ARENA_W, y: rnd() * ARENA_H, r: 0.8 + rnd() * 1.8, tw: rnd() * Math.PI * 2, sp: 0.5 + rnd() * 2 });
  }
}

// ---------------------------------------------------------------- screens
function showScreen(id) {
  for (const el of document.querySelectorAll('.overlay')) el.classList.add('hidden');
  const el = $(id);
  if (!el) return;
  el.classList.remove('hidden');
  // Re-trigger the pop-in animation.
  el.classList.remove('open'); void el.offsetWidth; el.classList.add('open');
  // Focus one control per screen (game-ui-ux). On the sector select the
  // first enabled sector card is the natural focus: focusing the Back
  // button (the first .btn in the overlay) scrolled the 12-card panel so
  // the first row clipped off the top at 1280x720.
  const focusEl = id === 'sectors'
    ? el.querySelector('.level-card:not(:disabled)')
    : el.querySelector('.btn.primary, .btn');
  if (focusEl) focusEl.focus();
  // Keep the panel at the top after the focus scroll.
  const panel = el.querySelector('.panel');
  if (panel) panel.scrollTop = 0;
}
function pushScreen(id) { screenStack.push(id); showScreen(id); }
function popScreen() {
  screenStack.pop();
  showScreen(screenStack.length ? screenStack[screenStack.length - 1] : 'menu');
}
function clearToast() {
  const t = $('hud-toast');
  t.classList.add('hidden'); t.textContent = '';
  toastTimer = 0;
}
function toast(text, ms = 2600) {
  const t = $('hud-toast');
  t.textContent = text;
  t.classList.remove('hidden');
  toastTimer = ms / 1000;
}

function refreshMenuBest() {
  const cleared = Object.keys(save.best).length;
  const bestScore = Math.max(0, ...Object.values(save.best).map((b) => b.score));
  $('menu-best').textContent = cleared === 0
    ? 'No sectors cleared yet — twelve sectors of bullet storms await.'
    : `${cleared}/${SECTORS.length} sectors cleared · best score ${bestScore.toLocaleString()}.`;
  refreshEndlessButton();
}
// M4: the Endless Drift button reads its lock state from the save. Locked:
// dimmed with a lock and the reason under it. Unlocked: the best Endless
// result under it. The button stays clickable when locked — the click
// answers with a denied tick and pulses the note, never a dead button.
function refreshEndlessButton() {
  const btn = $('btn-endless'), note = $('endless-note');
  const unlocked = isEndlessUnlocked(save);
  btn.classList.toggle('locked', !unlocked);
  btn.textContent = unlocked ? '∞ Endless Drift' : '🔒 Endless Drift';
  if (unlocked) {
    const eb = bestEndless(save);
    note.textContent = eb.bestWave > 0
      ? `Best: Wave ${eb.bestWave} · ${eb.bestScore.toLocaleString()} points`
      : 'Endless Drift unlocked — no runs yet. Waves keep coming.';
  } else {
    note.textContent = 'Clear Sector 1 to unlock Endless Drift';
  }
}
function refreshSectorSelect() {
  const grid = $('sector-grid');
  grid.innerHTML = '';
  for (const s of SECTORS) {
    const unlocked = isSectorUnlocked(save, s.id);
    const best = bestFor(save, s.id);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'level-card' + (unlocked ? '' : ' locked');
    card.disabled = !unlocked;
    card.style.setProperty('--accent', s.accent);
    card.innerHTML = `<span class="level-num">SECTOR ${s.id}</span>`
      + `<span class="level-name">${s.name}${best && best.rank ? ` <span class="level-rank rank-${best.rank.toLowerCase()}">${best.rank}</span>` : ''}</span>`
      + `<span class="level-meta">${s.hint}</span>`
      + `<span class="level-meta">${best ? `Best ${best.score.toLocaleString()} · ${best.time.toFixed(1)}s` : 'Not cleared yet'}</span>`;
    card.addEventListener('click', () => { ensureAudio(); sfx.uiTick(); selectedSector = s.id; startSector(s.id); });
    grid.appendChild(card);
  }
}

function goMenu() {
  phase = 'menu';
  run = null; autopilot = null; transitionT = null;
  waveBanner = { text: '', t: 0 };
  clearToast();
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
  screenStack = ['menu'];
  refreshMenuBest();
  showScreen('menu');
  startDemo();
}
function startDemo() {
  demoRun = createRun(1);
  demoBot = createDecisionBot();
  demoRestartT = 0;
}
function startSector(id) {
  ensureAudio();
  startMusic();
  selectedSector = id;
  run = createRun(id);
  phase = 'playing';
  transitionT = null;
  trauma = 0; hitStopT = 0; slowMoT = 0; timeScale = 1; flashT = 0; zoomT = 0;
  hullLowWarned = false;
  for (const p of particles) p.alive = false;
  shockwaves.length = 0; pops.length = 0;
  screenStack = [];
  for (const el of document.querySelectorAll('.overlay')) el.classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) $('touch').classList.remove('hidden');
  $('hud-sector').textContent = `${run.def.id} · ${run.def.name}`;
  const best = bestFor(save, id);
  $('hud-best').textContent = best ? `Best ${best.score.toLocaleString()}` : 'Best —';
  toast(run.def.hint, 3600);
  lastTime = performance.now();
}
function startEndless() {
  ensureAudio();
  startMusic();
  run = createEndlessRun();
  phase = 'playing';
  transitionT = null;
  trauma = 0; hitStopT = 0; slowMoT = 0; timeScale = 1; flashT = 0; zoomT = 0;
  waveBanner = { text: '', t: 0 };
  hullLowWarned = false;
  for (const p of particles) p.alive = false;
  shockwaves.length = 0; pops.length = 0;
  screenStack = [];
  for (const el of document.querySelectorAll('.overlay')) el.classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) $('touch').classList.remove('hidden');
  $('hud-sector').textContent = 'Endless Drift · Wave 1';
  const eb = bestEndless(save);
  $('hud-best').textContent = eb.bestWave > 0 ? `Best Wave ${eb.bestWave}` : 'Best Wave —';
  toast('Endless Drift — waves keep coming. Survive as long as you can.', 3600);
  lastTime = performance.now();
}
function pauseGame() {
  if (phase !== 'playing') return;
  phase = 'pause';
  screenStack = ['pause'];
  showScreen('pause');
}
function resumeGame() {
  if (phase !== 'pause') return;
  phase = 'playing';
  screenStack = [];
  for (const el of document.querySelectorAll('.overlay')) el.classList.add('hidden');
  lastTime = performance.now();
}
function restartSector() {
  if (!run) return;
  if (run.mode === 'endless') startEndless();
  else startSector(run.sectorId);
}
function quitToMenu() {
  // Talon lesson: clear transient UI state on run end and quit-to-menu.
  clearToast();
  goMenu();
}
function showEndScreen() {
  if (!run) return;
  if (run.phase === 'clear') {
    const isBest = recordBest(save, run.sectorId, run.score, run.time, run.player.hull);
    persistSave();
    phase = 'complete';
    $('complete-title').textContent = 'Sector Clear!';
    // M4: the clear rank is the headline — S/A/B from hull left.
    const rank = rankForHull(run.player.hull);
    const rankEl = $('complete-rank');
    rankEl.textContent = `RANK ${rank}`;
    rankEl.className = `complete-rank rank-${rank.toLowerCase()}`;
    $('complete-best').textContent = isBest ? `New best score: ${run.score.toLocaleString()}!` : `Score ${run.score.toLocaleString()} (best ${bestFor(save, run.sectorId).score.toLocaleString()})`;
    $('complete-time').textContent = `Time ${run.time.toFixed(1)}s`;
    $('complete-score').textContent = `Score ${run.score.toLocaleString()}`;
    $('complete-absorbs').textContent = `Absorbed ${run.absorbs}`;
    $('complete-hull').textContent = `Hull ${run.player.hull}`;
    $('btn-next').disabled = run.sectorId >= SECTORS.length;
    $('btn-next').textContent = run.sectorId >= SECTORS.length ? 'All Sectors Clear!' : 'Next Sector';
    screenStack = ['complete'];
    showScreen('complete');
  } else if (run.phase === 'lost') {
    phase = 'gameover';
    if (run.mode === 'endless') {
      // M4: an Endless run ends at hull 0 — the result is the wave
      // reached and the score, saved separately from the sector bests.
      const isBest = recordEndlessBest(save, run.wave, run.score);
      persistSave();
      $('gameover-title').textContent = 'The Drift Ends';
      $('gameover-sub').textContent = isBest
        ? `New best — Wave ${run.wave} · ${run.score.toLocaleString()} points!`
        : `Wave ${run.wave} · Score ${run.score.toLocaleString()} (best Wave ${save.endless.bestWave})`;
      $('gameover-wave').textContent = `Wave ${run.wave}`;
      $('gameover-wave').classList.remove('hidden');
      $('btn-retry').textContent = '↻ Drift Again';
    } else {
      $('gameover-title').textContent = 'Wisp Down';
      $('gameover-sub').textContent = `The storm got you in ${run.def.name}. Swap sooner, absorb more, nova when the sky fills.`;
      $('gameover-wave').classList.add('hidden');
      $('btn-retry').textContent = '↻ Retry Sector';
    }
    $('gameover-score').textContent = `Score ${run.score.toLocaleString()}`;
    $('gameover-time').textContent = `Time ${run.time.toFixed(1)}s`;
    $('gameover-absorbs').textContent = `Absorbed ${run.absorbs}`;
    $('gameover-kills').textContent = `Kills ${run.kills}`;
    screenStack = ['gameover'];
    showScreen('gameover');
  }
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
}

// ---------------------------------------------------------------- HUD
const hudCache = {};
function setText(id, value) {
  if (hudCache[id] !== value) { hudCache[id] = value; $(id).textContent = value; }
}
function updateHUD() {
  if (!run || (phase !== 'playing' && phase !== 'pause')) return;
  const p = run.player;
  // M4: in Endless Drift the HUD carries the wave, not a sector name,
  // and the best wave, not a sector best score.
  if (run.mode === 'endless') {
    setText('hud-sector', `Endless Drift · Wave ${run.wave}`);
    const eb = bestEndless(save);
    setText('hud-best', eb.bestWave > 0 ? `Best Wave ${eb.bestWave}` : 'Best Wave —');
  } else {
    setText('hud-sector', `${run.def.id} · ${run.def.name}`);
    const best = bestFor(save, run.sectorId);
    setText('hud-best', best ? `Best ${best.score.toLocaleString()}` : 'Best —');
  }
  setText('hud-score', `Score ${run.score.toLocaleString()}`);
  setText('hud-time', `${run.time.toFixed(1)}s`);
  const chargeEl = $('hud-charge-fill');
  chargeEl.style.width = `${(p.charge / CHARGE_MAX) * 100}%`;
  const chargeBar = chargeEl.parentElement;
  const full = p.charge >= NOVA_COST;
  chargeBar.classList.toggle('full', full);
  setText('hud-charge-label', full ? 'NOVA READY — X' : `CHARGE ${p.charge}`);
  const hullEl = $('hud-hull-fill');
  hullEl.style.width = `${(p.hull / HULL_MAX) * 100}%`;
  hullEl.parentElement.classList.toggle('low', p.hull <= 30);
  setText('hud-hull-label', `HULL ${p.hull}`);
  const chip = $('hud-polarity');
  const cls = p.pol === 'cyan' ? 'pol-cyan' : 'pol-magenta';
  if (hudCache.pol !== cls) {
    hudCache.pol = cls;
    chip.className = 'hud-polarity ' + cls;
    chip.textContent = p.pol === 'cyan' ? '◉ CYAN' : '◉ MAGENTA';
  }
  if (toastTimer > 0) {
    toastTimer -= 1 / 60;
    if (toastTimer <= 0) clearToast();
  }
}
function setMuted(m) {
  muted = m;
  save.settings.muted = m;
  persistSave();
  updateMuteLabels();
}
function updateMuteLabels() {
  const label = muted ? 'Sound: Off' : 'Sound: On';
  for (const id of ['btn-mute-hud', 'btn-mute-menu', 'btn-mute-settings']) { const el = $(id); if (el) el.textContent = label; }
}
function setFlash(on) {
  save.settings.flash = on;
  persistSave();
  const el = $('btn-flash-settings');
  if (el) el.textContent = on ? 'Flashing: On' : 'Flashing: Off';
}

// ---------------------------------------------------------------- input
function queueSwap() { if (phase === 'playing') { ensureAudio(); swapQueued = true; } }
function queueNova() {
  if (phase !== 'playing') return;
  ensureAudio();
  // M3: a nova press with no charge must answer, not swallow the input —
  // the denied tick is what teaches the charge economy. Throttled so a
  // held X doesn't buzz every frame.
  if (run && run.player.charge < NOVA_COST && performance.now() - lastDeniedT > 300) {
    lastDeniedT = performance.now();
    sfx.denied();
  }
  novaQueued = true;
}
function currentInput() {
  if (autopilot && run) return autopilot.input(run);
  let mx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  let my = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (drag.active && run) {
    const dx = drag.x - run.player.x, dy = drag.y - run.player.y;
    const d = Math.hypot(dx, dy);
    if (d > 8) { mx = dx / d; my = dy / d; }
  }
  const input = { mx, my, swap: swapQueued, nova: novaQueued };
  swapQueued = false; novaQueued = false;
  return input;
}
window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ') e.preventDefault();
  if (e.repeat) return;
  switch (k) {
    case 'ArrowUp': case 'w': case 'W': keys.up = true; break;
    case 'ArrowDown': case 's': case 'S': keys.down = true; break;
    case 'ArrowLeft': case 'a': case 'A': keys.left = true; break;
    case 'ArrowRight': case 'd': case 'D': keys.right = true; break;
    case ' ': case 'Shift': queueSwap(); break;
    case 'x': case 'X': queueNova(); break;
    case 'p': case 'P': case 'Escape':
      if (phase === 'playing') pauseGame();
      else if (phase === 'pause') resumeGame();
      else if (screenStack.length > 1) popScreen();
      break;
    case 'm': case 'M': setMuted(!muted); break;
    case 'r': case 'R': if (phase === 'playing' || phase === 'pause') restartSector(); break;
    case 'Enter':
      if (phase === 'pause') resumeGame();
      else if (phase === 'menu') startSector(selectedSector);
      break;
  }
});
window.addEventListener('keyup', (e) => {
  switch (e.key) {
    case 'ArrowUp': case 'w': case 'W': keys.up = false; break;
    case 'ArrowDown': case 's': case 'S': keys.down = false; break;
    case 'ArrowLeft': case 'a': case 'A': keys.left = false; break;
    case 'ArrowRight': case 'd': case 'D': keys.right = false; break;
  }
});
window.addEventListener('blur', () => {
  keys.up = keys.down = keys.left = keys.right = false;
  drag.active = false;
});
canvas.addEventListener('pointerdown', (e) => {
  ensureAudio();
  if (phase !== 'playing') return;
  drag.active = true; drag.id = e.pointerId;
  drag.x = sx2wx(e.clientX); drag.y = sy2wy(e.clientY);
  drag.startX = e.clientX; drag.startY = e.clientY; drag.startT = performance.now();
  drag.moved = false;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag.active || e.pointerId !== drag.id) return;
  drag.x = sx2wx(e.clientX); drag.y = sy2wy(e.clientY);
  if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 12) drag.moved = true;
});
canvas.addEventListener('pointerup', (e) => {
  if (!drag.active || e.pointerId !== drag.id) return;
  drag.active = false;
  // A tap (short, no drag) is a nova — mouse click fires one too.
  if (!drag.moved && performance.now() - drag.startT < 300) queueNova();
});
canvas.addEventListener('pointercancel', () => { drag.active = false; });

// ---------------------------------------------------------------- events -> feel
// M3: every event fires its FULL tier bundle from the FEEDBACK table in
// physics.js — trauma, hit-stop, flash, slow-mo and shockwave are applied
// generically here, so a layer listed in the table but never rendered is
// impossible to miss. The per-event code below adds only the layers the
// table can't express (particles, pops, sounds). Everything fires in the
// same frame the event is drained, well inside the ~100ms bar.
function fireTier(ev, opts = {}) {
  const fb = FEEDBACK[ev.type];
  if (!fb) return;
  if (fb.trauma) trauma = Math.min(1, trauma + fb.trauma);
  if (fb.hitStop) hitStopT = Math.max(hitStopT, fb.hitStop);
  if (fb.layers.includes('slow-mo')) {
    slowMoT = Math.max(slowMoT, opts.slowMo ?? 0.5);
    timeScale = 0.35;
  }
  if (fb.layers.includes('flash')) {
    flashT = Math.max(flashT, opts.flash ?? 0.3);
    flashColor = opts.flashColor || COLORS.gold;
  }
  if (fb.layers.includes('shockwave')) {
    addShockwave(opts.x ?? run.player.x, opts.y ?? run.player.y, opts.shockColor || COLORS.gold, opts.shockR ?? 300);
  }
  // Flash-ring: the swap's expanding wisp ring, or a small ring at the
  // event for anything else (a kill pops a ring where the enemy died).
  if (fb.layers.includes('flash-ring')) {
    if (ev.type === 'swap') swapFlashT = 0.25;
    else addShockwave(opts.x ?? ev.x ?? run.player.x, opts.y ?? ev.y ?? run.player.y, opts.shockColor || COLORS.gold, opts.shockR ?? 70);
  }
}
function handleEvents(runObj) {
  for (const ev of drainEvents(runObj)) {
    switch (ev.type) {
      case 'absorb': {
        fireTier(ev);
        burst(ev.x, ev.y, POL_COLOR[ev.pol], 5, 120, 2.5, 0.45);
        sfx.absorb(ev.combo);
        // Streak milestones celebrate the combo itself: a gold pop, a
        // small ring and a rising chime at 5/10/15/20/30/40/50.
        if (STREAK_MILESTONES.includes(ev.combo)) {
          addPop(ev.x, ev.y - 26, `STREAK ×${ev.combo}`, COLORS.gold);
          addShockwave(ev.x, ev.y, POL_COLOR[ev.pol], 90);
          sfx.streak(ev.combo);
        } else if (ev.combo >= 2) {
          addPop(ev.x, ev.y - 14, `+${ABSORB_SCORE} ×${ev.combo}`, POL_COLOR[ev.pol]);
        }
        break;
      }
      case 'nova-ready':
        fireTier(ev);
        burst(runObj.player.x, runObj.player.y, COLORS.gold, 12, 160, 3, 0.6);
        addPop(runObj.player.x, runObj.player.y - 28, 'NOVA READY', COLORS.gold);
        sfx.novaReady();
        break;
      case 'swap':
        fireTier(ev);
        sfx.swap();
        break;
      case 'hit':
        fireTier(ev, { flash: 0.22, flashColor: COLORS.red });
        burst(ev.x, ev.y, COLORS.red, 14, 220, 3.5, 0.7);
        addPop(ev.x, ev.y - 16, `-${HIT_DAMAGE}`, COLORS.red);
        sfx.hit();
        // Hull-low is a crossing, not a state: warn once, when the hull
        // first drops to 30 or below — the red edge pulse already shows
        // the state, the warning marks the moment it became dangerous.
        if (ev.hull <= 30 && ev.hull > 0 && !hullLowWarned) {
          hullLowWarned = true;
          addPop(ev.x, ev.y - 34, 'HULL LOW', COLORS.red);
          sfx.warn();
        }
        break;
      case 'kill':
        fireTier(ev, { x: ev.x, y: ev.y, shockColor: POL_COLOR[ev.pol], shockR: 70 });
        burst(ev.x, ev.y, POL_COLOR[ev.pol], 16, 240, 3.5, 0.8);
        addPop(ev.x, ev.y - 18, `+${ev.score}`, COLORS.gold);
        sfx.kill();
        break;
      case 'nova':
        fireTier(ev, { flash: 0.5, flashColor: COLORS.gold, slowMo: 0.5, shockR: 420 });
        zoomT = 0.45;
        burst(runObj.player.x, runObj.player.y, COLORS.gold, 40, 420, 4, 0.9);
        addPop(runObj.player.x, runObj.player.y - 30, 'NOVA!', COLORS.gold);
        sfx.nova();
        break;
      case 'clear':
        fireTier(ev, { flash: 0.4, flashColor: COLORS.gold, shockR: 380 });
        sfx.clear();
        burst(runObj.player.x, runObj.player.y, COLORS.gold, 50, 380, 4, 1.1);
        addPop(runObj.player.x, runObj.player.y - 34, 'SECTOR CLEAR', COLORS.gold);
        break;
      case 'lost':
        fireTier(ev, { flash: 0.6, flashColor: COLORS.red, slowMo: 0.8 });
        sfx.lost();
        burst(runObj.player.x, runObj.player.y, COLORS.red, 40, 320, 4, 1.0);
        addPop(runObj.player.x, runObj.player.y - 30, 'WISP DOWN', COLORS.red);
        break;
      case 'telegraph':
        fireTier(ev);
        sfx.blip();
        toast(ev.text, 3000);
        break;
      case 'spawn':
        burst(ev.x, ev.y, POL_COLOR[ev.pol], 6, 90, 2.5, 0.5);
        break;
      case 'sniper-shot':
        fireTier(ev);
        sfx.shot();
        break;
      case 'sniper-aim':
        fireTier(ev);
        sfx.aim();
        break;
      case 'ring':
        fireTier(ev);
        sfx.ring();
        break;
      case 'wave-start':
        // M4: a new Endless wave is announced, not just spawned — the
        // banner names the wave, the horn marks the moment.
        fireTier(ev);
        waveBanner = { text: `WAVE ${ev.wave}`, t: 2.2 };
        sfx.wave();
        break;
      case 'wave-clear': {
        fireTier(ev);
        waveBanner = { text: `WAVE ${ev.wave} CLEAR`, t: 1.8 };
        burst(runObj.player.x, runObj.player.y, COLORS.gold, 24, 300, 3.5, 0.8);
        addPop(runObj.player.x, runObj.player.y - 30, `+${ev.bonus}`, COLORS.gold);
        toast(`Wave ${ev.wave} clear — +${ev.bonus} bonus${ev.hullBonus > 0 ? ` · +${ev.hullBonus} hull` : ''}`, 2600);
        sfx.clear();
        break;
      }
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------- render
function drawBackground(t, accent) {
  const g = ctx.createLinearGradient(0, 0, 0, viewH);
  g.addColorStop(0, '#0d0d2e');
  g.addColorStop(0.6, COLORS.bg);
  g.addColorStop(1, '#070716');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, viewW, viewH);
  // Nebula blobs (sector accent).
  ctx.save();
  ctx.globalAlpha = 0.16;
  const nb = [
    { x: viewW * 0.2, y: viewH * 0.25, r: Math.min(viewW, viewH) * 0.45, c: accent },
    { x: viewW * 0.85, y: viewH * 0.7, r: Math.min(viewW, viewH) * 0.4, c: COLORS.violet },
  ];
  for (const b of nb) {
    const rg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    rg.addColorStop(0, b.c); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
  }
  ctx.restore();
  // Stars.
  ctx.save();
  for (const st of stars) {
    const a = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(t * st.sp + st.tw));
    ctx.globalAlpha = a;
    ctx.fillStyle = '#c7d2fe';
    ctx.beginPath();
    ctx.arc(wx2sx(st.x), wy2sy(st.y), Math.max(0.6, st.r * view.scale), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // Arena grid + border.
  ctx.save();
  ctx.strokeStyle = 'rgba(167, 139, 250, 0.10)';
  ctx.lineWidth = 1;
  for (let gx = 60; gx < ARENA_W; gx += 60) {
    ctx.beginPath(); ctx.moveTo(wx2sx(gx), wy2sy(0)); ctx.lineTo(wx2sx(gx), wy2sy(ARENA_H)); ctx.stroke();
  }
  for (let gy = 60; gy < ARENA_H; gy += 60) {
    ctx.beginPath(); ctx.moveTo(wx2sx(0), wy2sy(gy)); ctx.lineTo(wx2sx(ARENA_W), wy2sy(gy)); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(167, 139, 250, 0.55)';
  ctx.lineWidth = Math.max(1.5, 2 * view.scale);
  ctx.strokeRect(wx2sx(0), wy2sy(0), ARENA_W * view.scale, ARENA_H * view.scale);
  // Wide translucent echo of the border (cheap glow — no shadowBlur,
  // which is brutally slow in software rendering).
  ctx.strokeStyle = 'rgba(167, 139, 250, 0.14)';
  ctx.lineWidth = Math.max(4, 8 * view.scale);
  ctx.strokeRect(wx2sx(0), wy2sy(0), ARENA_W * view.scale, ARENA_H * view.scale);
  ctx.restore();
}
function drawBullet(b) {
  const x = wx2sx(b.x), y = wy2sy(b.y), r = Math.max(2.5, 6 * view.scale);
  const col = POL_COLOR[b.pol];
  ctx.save();
  // Cheap glow: translucent halo + solid core + white-hot centre.
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x, y, r * 2.1, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawEnemy(e, t) {
  const x = wx2sx(e.x), y = wy2sy(e.y);
  const s = view.scale;
  const col = POL_COLOR[e.pol];
  const appear = Math.min(1, e.age * 4);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(appear, appear);
  // Cheap glow: translucent halo behind the shape (no shadowBlur).
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(0, 0, e.r * 1.7 * s, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1.5, 2 * s);
  const r = e.r * s;
  if (e.type === 'drifter') {
    ctx.beginPath();
    ctx.moveTo(0, r); ctx.lineTo(-r * 0.8, -r * 0.6); ctx.lineTo(0, -r * 0.25); ctx.lineTo(r * 0.8, -r * 0.6);
    ctx.closePath(); ctx.fill();
  } else if (e.type === 'weaver') {
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r * 0.75, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.75, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2); ctx.fill();
  } else if (e.type === 'sniper') {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0b0b26';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2); ctx.fill();
    // Telegraph: bright solid aim line at the player. M2: the old line was
    // a thin dashed 0.05–0.65 alpha pulse for 0.65s — the live playtest
    // never saw it in any frame. Now solid, thicker, brighter, and the
    // telegraph lasts 0.85s (physics.js SNIPER_TELEGRAPH).
    if (e.telegraphT > 0 && run) {
      ctx.restore();
      ctx.save();
      const a = 0.55 + 0.35 * Math.sin(t * 18);
      ctx.globalAlpha = a;
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, 3.5 * s);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(wx2sx(run.player.x), wy2sy(run.player.y)); ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.translate(x, y); ctx.scale(appear, appear);
      ctx.fillStyle = col; ctx.strokeStyle = col;
    }
  } else if (e.type === 'spinner') {
    ctx.rotate(e.angle);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = i % 2 === 0 ? r : r * 0.45;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0b0b26';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // HP arc when damaged.
  if (e.hp < e.maxHp) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = Math.max(2, 3 * s);
    ctx.beginPath(); ctx.arc(x, y, (e.r + 8) * s, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(x, y, (e.r + 8) * s, -Math.PI / 2, -Math.PI / 2 + (e.hp / e.maxHp) * Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}
function drawPlayer(p, t) {
  const x = wx2sx(p.x), y = wy2sy(p.y);
  const s = view.scale;
  const col = POL_COLOR[p.pol];
  const blink = p.invuln > 0 && Math.floor(t * 14) % 2 === 0;
  ctx.save();
  // Invulnerability blink.
  ctx.translate(x, y);
  // Cheap glow: translucent halo behind the wisp (no shadowBlur).
  ctx.globalAlpha = (blink ? 0.45 : 1) * 0.3;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(0, 0, PLAYER_R * 2.1 * s, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = blink ? 0.45 : 1;
  // Charge ring (gold arc around the wisp).
  if (p.charge > 0) {
    ctx.strokeStyle = p.charge >= NOVA_COST ? COLORS.gold : 'rgba(251,191,36,0.5)';
    ctx.lineWidth = Math.max(2, 3.5 * s);
    ctx.beginPath();
    ctx.arc(0, 0, (PLAYER_R + 9) * s, -Math.PI / 2, -Math.PI / 2 + (p.charge / CHARGE_MAX) * Math.PI * 2);
    ctx.stroke();
  }
  // Swap flash ring.
  if (swapFlashT > 0) {
    const f = 1 - swapFlashT / 0.25;
    ctx.globalAlpha = (1 - f) * 0.8;
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, 2.5 * s);
    ctx.beginPath(); ctx.arc(0, 0, (PLAYER_R + 6 + f * 26) * s, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Wisp: a glowing diamond with a bright core.
  const r = PLAYER_R * s;
  const wob = 1 + 0.08 * Math.sin(t * 6);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(0, -r * wob); ctx.lineTo(r * 0.7, 0); ctx.lineTo(0, r * wob); ctx.lineTo(-r * 0.7, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawRunEntities(r, t) {
  for (const e of r.enemies) drawEnemy(e, t);
  for (const b of r.bullets) drawBullet(b);
  if (r.phase !== 'lost') drawPlayer(r.player, t);
}
function render(now) {
  const t = now / 1000;
  const active = run || demoRun;
  const accent = active ? active.def.accent : COLORS.violet;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Nova zoom punch (M3): a brief 5% push-in that eases back to exactly
  // 1.0 — the camera punch to go with the slow-mo. Applied around the
  // screen centre, before the shake translate.
  if (zoomT > 0) {
    const z = 1 + 0.05 * (zoomT / 0.45);
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(z, z);
    ctx.translate(-viewW / 2, -viewH / 2);
  }
  // Trauma shake: shake = trauma^2, written to a visual offset only.
  const shakeAmp = trauma * trauma * 14 * (save.settings.shake ?? 1);
  if (shakeAmp > 0.1) ctx.translate((Math.random() * 2 - 1) * shakeAmp, (Math.random() * 2 - 1) * shakeAmp);
  drawBackground(t, accent);
  if (phase === 'menu' && demoRun) {
    ctx.save(); ctx.globalAlpha = 0.9;
    drawRunEntities(demoRun, t);
    ctx.restore();
  } else if (run) {
    drawRunEntities(run, t);
  }
  // Particles.
  ctx.save();
  for (const p of particles) {
    if (!p.alive) continue;
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(wx2sx(p.x), wy2sy(p.y), Math.max(0.8, p.size * view.scale), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // Shockwaves.
  ctx.save();
  for (const w of shockwaves) {
    const f = 1 - w.life / w.maxLife;
    ctx.globalAlpha = (1 - f) * 0.9;
    ctx.strokeStyle = w.color;
    ctx.lineWidth = Math.max(2, 4 * view.scale * (1 - f));
    ctx.beginPath();
    ctx.arc(wx2sx(w.x), wy2sy(w.y), (w.r + (w.maxR - w.r) * f) * view.scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  // Floating pops.
  ctx.save();
  ctx.font = `bold ${Math.round(15 * view.scale)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  for (const p of pops) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, wx2sx(p.x), wy2sy(p.y - (1 - p.life / p.maxLife) * 30));
  }
  ctx.restore();
  // M4: Endless wave banner — big gold centre text while a wave starts
  // or clears. Fades in the last 0.4s so it never pops off mid-word.
  if (waveBanner.t > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, waveBanner.t / 0.4);
    ctx.font = `900 ${Math.round(46 * view.scale)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    // Cheap glow: four translucent echoes behind the solid text — no
    // shadowBlur, which is brutally slow in software rendering.
    ctx.fillStyle = 'rgba(251, 191, 36, 0.35)';
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
      ctx.fillText(waveBanner.text, viewW / 2 + dx, viewH * 0.38 + dy);
    }
    ctx.fillStyle = COLORS.gold;
    ctx.fillText(waveBanner.text, viewW / 2, viewH * 0.38);
    ctx.restore();
  }
  // Flash overlay (respects the flashing toggle).
  if (flashT > 0 && save.settings.flash !== false) {
    ctx.globalAlpha = Math.min(0.45, flashT * 0.9);
    ctx.fillStyle = flashColor;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.globalAlpha = 1;
  }
  // Low-hull red edge pulse.
  if (run && phase === 'playing' && run.player.hull <= 30 && run.player.hull > 0) {
    const pulse = 0.10 + 0.08 * Math.sin(t * 6);
    const rg = ctx.createRadialGradient(viewW / 2, viewH / 2, Math.min(viewW, viewH) * 0.4, viewW / 2, viewH / 2, Math.max(viewW, viewH) * 0.75);
    rg.addColorStop(0, 'rgba(251,113,133,0)');
    rg.addColorStop(1, `rgba(251,113,133,${pulse})`);
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, viewW, viewH);
  }
  ctx.restore();
}
function updateParticles(dt) {
  for (const p of particles) {
    if (!p.alive) continue;
    p.life -= dt;
    if (p.life <= 0) { p.alive = false; continue; }
    const d = Math.max(0, 1 - p.drag * dt);
    p.vx *= d; p.vy *= d;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    shockwaves[i].life -= dt;
    if (shockwaves[i].life <= 0) shockwaves.splice(i, 1);
  }
  for (let i = pops.length - 1; i >= 0; i--) {
    pops[i].life -= dt;
    if (pops[i].life <= 0) pops.splice(i, 1);
  }
  swapFlashT = Math.max(0, swapFlashT - dt);
}

// ---------------------------------------------------------------- main loop
function frame(now) {
  requestAnimationFrame(frame);
  const realDt = clamp((now - lastTime) / 1000, 0, 0.05);
  lastTime = now;
  if (realDt > 0) fpsEma = fpsEma * 0.95 + (1 / Math.max(realDt, 1e-4)) * 0.05;
  let simDt = realDt;
  if (hitStopT > 0) { hitStopT -= realDt; simDt = 0; }
  if (slowMoT > 0) { slowMoT -= realDt; timeScale = 0.35; }
  else timeScale = Math.min(1, timeScale + realDt * 2.5);
  simDt *= timeScale;
  trauma = Math.max(0, trauma - realDt * 1.6);
  flashT = Math.max(0, flashT - realDt * 2.2);
  zoomT = Math.max(0, zoomT - realDt * 1.2);
  waveBanner.t = Math.max(0, waveBanner.t - realDt);

  if (phase === 'playing' && run) {
    acc += simDt;
    let guard = 0;
    while (acc >= DT && guard++ < 8) {
      stepRun(run, currentInput());
      handleEvents(run);
      acc -= DT;
    }
    if (acc > DT * 8) acc = 0;
    // Player trail while moving.
    const p = run.player;
    if (Math.hypot(p.vx, p.vy) > 120 && Math.random() < 0.6) {
      spawnParticle(p.x - p.vx * 0.03, p.y - p.vy * 0.03, -p.vx * 0.05, -p.vy * 0.05, 0.35, 2.5, POL_COLOR[p.pol], 3);
    }
    if (run.phase !== 'playing' && transitionT === null) transitionT = 0.9;
    if (transitionT !== null) {
      transitionT -= realDt;
      if (transitionT <= 0) { transitionT = null; showEndScreen(); }
    }
  } else if (phase === 'menu' && demoRun) {
    acc += realDt;
    let guard = 0;
    while (acc >= DT && guard++ < 8) {
      stepRun(demoRun, demoBot.input(demoRun));
      drainEvents(demoRun);
      acc -= DT;
    }
    if (acc > DT * 8) acc = 0;
    if (demoRun.phase !== 'playing') {
      demoRestartT += realDt;
      if (demoRestartT > 1.2) startDemo();
    }
  }
  updateParticles(realDt);
  render(now);
  updateHUD();
}

// ---------------------------------------------------------------- wiring + hooks
function bindUI() {
  $('btn-play').addEventListener('click', () => { ensureAudio(); sfx.uiTick(); startSector(selectedSector); });
  // M4: Endless Drift. Locked: the click answers (denied tick + the lock
  // note pulses) instead of doing nothing — a locked button is not a
  // dead button. Unlocked: it starts the mode.
  $('btn-endless').addEventListener('click', () => {
    ensureAudio();
    if (!isEndlessUnlocked(save)) {
      sfx.denied();
      const note = $('endless-note');
      note.classList.remove('pulse'); void note.offsetWidth; note.classList.add('pulse');
      return;
    }
    sfx.uiTick(); startEndless();
  });
  $('btn-sectors').addEventListener('click', () => { refreshSectorSelect(); pushScreen('sectors'); });
  $('btn-howto').addEventListener('click', () => pushScreen('howto'));
  $('btn-settings').addEventListener('click', () => pushScreen('settings'));
  $('btn-sectors-back').addEventListener('click', () => popScreen());
  $('btn-howto-back').addEventListener('click', () => popScreen());
  $('btn-settings-back').addEventListener('click', () => popScreen());
  $('btn-resume').addEventListener('click', () => resumeGame());
  $('btn-restart').addEventListener('click', () => restartSector());
  $('btn-quit').addEventListener('click', () => quitToMenu());
  $('btn-next').addEventListener('click', () => { if (run && run.sectorId < SECTORS.length) startSector(run.sectorId + 1); });
  $('btn-replay').addEventListener('click', () => restartSector());
  $('btn-complete-menu').addEventListener('click', () => quitToMenu());
  $('btn-retry').addEventListener('click', () => restartSector());
  $('btn-gameover-menu').addEventListener('click', () => quitToMenu());
  $('btn-mute-menu').addEventListener('click', () => setMuted(!muted));
  $('btn-mute-hud').addEventListener('click', () => setMuted(!muted));
  $('btn-mute-settings').addEventListener('click', () => setMuted(!muted));
  $('btn-flash-settings').addEventListener('click', () => setFlash(save.settings.flash === false));
  $('btn-music-settings').addEventListener('click', () => setMusic(!musicOn()));
  $('btn-pause').addEventListener('click', () => pauseGame());
  const shakeInput = $('setting-shake'), shakeVal = $('setting-shake-val');
  if (shakeInput) {
    shakeInput.value = Math.round((save.settings.shake ?? 1) * 100);
    shakeVal.textContent = `${shakeInput.value}%`;
    shakeInput.addEventListener('input', () => {
      save.settings.shake = clamp(Number(shakeInput.value) / 100, 0, 1);
      shakeVal.textContent = `${shakeInput.value}%`;
      persistSave();
    });
  }
  const resetBtn = $('btn-reset-best');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    save.best = {}; save.unlocked = 1; save.endless = { bestWave: 0, bestScore: 0 }; persistSave();
    refreshMenuBest(); refreshSectorSelect();
    toast('Best scores cleared', 2000);
  });
  // Hover tick SFX + press feedback on every button (menu juice).
  let lastHoverEl = null;
  document.addEventListener('mouseover', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('.btn, .level-card, .hud-btn') : null;
    if (el && el !== lastHoverEl) {
      lastHoverEl = el;
      ensureAudio(); sfx.uiTick();
    } else if (!el) {
      lastHoverEl = null;
    }
  });
  // Touch controls.
  const ts = $('touch-swap'), tn = $('touch-nova');
  if (ts) ts.addEventListener('pointerdown', (e) => { e.preventDefault(); queueSwap(); });
  if (tn) tn.addEventListener('pointerdown', (e) => { e.preventDefault(); queueNova(); });
}

window.__surge = {
  get version() { return VERSION; },
  get state() {
    return {
      phase, mode: run ? run.mode : null, sectorId: run ? run.sectorId : selectedSector,
      score: run ? run.score : null, charge: run ? run.player.charge : null,
      hull: run ? run.player.hull : null, time: run ? run.time : null,
      wave: run && run.mode === 'endless' ? run.wave : null,
      done: run ? run.phase !== 'playing' : null, won: run ? run.phase === 'clear' : null,
      muted, fps: Math.round(fpsEma),
    };
  },
  info() {
    const r = run || (phase === 'menu' ? demoRun : null);
    if (!r) return null;
    const sp = worldToScreen(r.player.x, r.player.y, viewW, viewH);
    return {
      sectorId: r.sectorId, sectorName: r.def.name, mode: r.mode,
      wave: r.mode === 'endless' ? r.wave : null,
      wavesCleared: r.mode === 'endless' ? r.wavesCleared : null,
      player: { x: sp.x, y: sp.y },
      playerWorld: { x: r.player.x, y: r.player.y, pol: r.player.pol, hull: r.player.hull, charge: r.player.charge },
      score: r.score, absorbs: r.absorbs, kills: r.kills, novas: r.novas,
      enemies: r.enemies.length, bullets: r.bullets.length,
      time: r.time, done: r.phase !== 'playing', won: r.phase === 'clear',
    };
  },
  sectors() {
    return SECTORS.map((d) => ({
      id: d.id, name: d.name, par: d.par, accent: d.accent,
      best: save.best[d.id] || null, unlocked: isSectorUnlocked(save, d.id),
    }));
  },
  startSector(id) { startSector(id); },
  startEndless() { startEndless(); },
  endlessUnlocked() { return isEndlessUnlocked(save); },
  autopilot(on) {
    if (on) { autopilot = createDecisionBot(); }
    else autopilot = null;
  },
  pause() { pauseGame(); },
  resume() { resumeGame(); },
  quitToMenu() { quitToMenu(); },
  setMuted(m) { setMuted(m); },
  setFlash(on) { setFlash(on); },
  setShake(v) {
    save.settings.shake = clamp(Number(v), 0, 1);
    persistSave();
    const input = $('setting-shake');
    if (input) { input.value = Math.round(save.settings.shake * 100); $('setting-shake-val').textContent = `${input.value}%`; }
  },
  setMusic(on) { setMusic(on); },
  audio() {
    return { hasAudio: ac !== null, musicOn: musicOn(), musicPlaying: musicTimer !== null, muted };
  },
  swap() { queueSwap(); },
  nova() { queueNova(); },
  setMove(x, y) { keys.left = x < 0; keys.right = x > 0; keys.up = y < 0; keys.down = y > 0; },
  // Feel state for tests: every value must return to its rest value
  // (trauma 0, timeScale 1, flashT 0, zoomT 0, no shockwaves) once the
  // game sits idle. shakeAmp is the effective shake after the user's
  // shake setting — 0 when the slider is at 0, whatever the trauma.
  feel() {
    return {
      trauma, timeScale, hitStopT, slowMoT, flashT, swapFlashT, zoomT,
      shakeAmp: trauma * trauma * 14 * (save.settings.shake ?? 1),
      shakeSetting: save.settings.shake ?? 1,
      flashEnabled: save.settings.flash !== false,
      musicOn: musicOn(),
      shockwaves: shockwaves.length,
      pops: pops.length,
      particlesAlive: particles.reduce((n, p) => n + (p.alive ? 1 : 0), 0),
      waveBanner: { text: waveBanner.text, t: waveBanner.t },
    };
  },
  get save() { return JSON.parse(JSON.stringify(save)); },
};

// ---------------------------------------------------------------- init
bindUI();
updateMuteLabels();
updateMusicLabels();
setFlash(save.settings.flash !== false);
refreshMenuBest();
selectedSector = save.unlocked || 1;
goMenu();
// Playtest path (Apex lesson): ?sector=N jumps straight into that sector,
// ?endless=1 jumps straight into Endless Drift — both bypass the unlock,
// kept out of the player-facing UI.
{
  const params = new URLSearchParams(window.location.search);
  const s = Number(params.get('sector'));
  if (Number.isInteger(s) && s >= 1 && s <= SECTORS.length) startSector(s);
  else if (params.get('endless') === '1') startEndless();
}
lastTime = performance.now();
requestAnimationFrame(frame);
