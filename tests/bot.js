// Neon Surge v1.0.0 — bot harness: the anti-slop gate.
//   - Decision bot: real polarity-swap + nova decisions through the public
//     stepRun input hooks. It MUST clear all 12 sectors.
//   - No-swap bot: same movement and nova play, but never swaps polarity.
//     It MUST lose all 12 — if it clears one, that sector is not done.
//   - Sit-still bot: no movement, no swap, no nova. It MUST lose all 12.
//   - Random bot: random movement/swaps/novas. It MUST lose all 12.
//   - Endless Drift (M4): the decision bot MUST reach wave 4+; the
//     no-swap / sit-still / random bots MUST die in wave 1-2.
// Usage: node tests/bot.js
import { SECTORS, simulateRun, simulateEndless, createDecisionBot, createNoSwapBot, createSitStillBot, createRandomBot } from '../physics.js';

let failures = 0;
for (const sector of SECTORS) {
  const t0 = Date.now();
  const smart = simulateRun(sector.id, createDecisionBot, { maxSeconds: 150 });
  const noswap = simulateRun(sector.id, createNoSwapBot, { maxSeconds: 150 });
  const still = simulateRun(sector.id, createSitStillBot, { maxSeconds: 60 });
  const random = simulateRun(sector.id, () => createRandomBot(1000 + sector.id), { maxSeconds: 120 });
  const ms = Date.now() - t0;
  console.log(`Sector ${sector.id} "${sector.name}": decision bot ${smart.won ? 'CLEAR' : 'FAILED'}`
    + ` in ${smart.time.toFixed(1)}s, hull ${smart.hull}, score ${smart.score}, ${smart.absorbs} absorbs, ${smart.kills} kills, ${smart.novas} novas, ${smart.hits} hits, max combo ${smart.maxCombo}`
    + ` | no-swap: ${noswap.won ? 'CLEARED (SLOP!)' : `lost in ${noswap.time.toFixed(1)}s (${noswap.hits} hits)`}`
    + ` | sit-still: ${still.won ? 'CLEARED (SLOP!)' : `lost in ${still.time.toFixed(1)}s`}`
    + ` | random: ${random.won ? 'CLEARED (SLOP!)' : `lost in ${random.time.toFixed(1)}s`}`
    + ` (${ms}ms)`);
  if (!smart.won) { failures++; console.error(`  BOT FAIL: sector ${sector.id} not cleared by the decision bot${smart.timedOut ? ' (timed out)' : ''}`); }
  if (smart.hits > 25) { failures++; console.error(`  BOT FAIL: sector ${sector.id} cost the decision bot ${smart.hits} hits (want <= 25 — the sector may be unfair)`); }
  if (noswap.won) { failures++; console.error(`  BOT FAIL: sector ${sector.id} is clearable without ever swapping polarity — tighten the bullet mix`); }
  if (still.won) { failures++; console.error(`  BOT FAIL: sector ${sector.id} is clearable by sitting still — tighten the sector`); }
  if (random.won) { failures++; console.error(`  BOT FAIL: sector ${sector.id} is clearable by a random masher — tighten the sector`); }
}

// A second random seed, to catch sectors that are only deadly by luck.
for (const sector of SECTORS) {
  const random = simulateRun(sector.id, () => createRandomBot(555 + sector.id), { maxSeconds: 120 });
  if (random.won) { failures++; console.error(`  BOT FAIL: sector ${sector.id} cleared by random bot seed 555 (SLOP)`); }
}
console.log(`bot: second random seed checked on all ${SECTORS.length} sectors`);

// --- Endless Drift gates (M4) -------------------------------------------
// The decision bot plays real polarity decisions through the same public
// hooks; it must reach wave 4+ (a good-play run has real depth — the
// probe run reached wave 15 with no hull restore). The bots that never
// swap, never move, or mash at random must die in wave 1-2: endless
// scaling is meaningless if the no-input bot survives it.
const eDecision = simulateEndless(createDecisionBot, { maxSeconds: 900 });
const eNoSwap = simulateEndless(createNoSwapBot, { maxSeconds: 600 });
const eStill = simulateEndless(createSitStillBot, { maxSeconds: 600 });
const eRandom = simulateEndless(() => createRandomBot(42), { maxSeconds: 600 });
console.log(`endless: decision bot reached wave ${eDecision.wave} (cleared ${eDecision.wavesCleared})`
  + ` in ${eDecision.time.toFixed(1)}s, score ${eDecision.score}, hull ${eDecision.hull}, ${eDecision.absorbs} absorbs, ${eDecision.kills} kills, ${eDecision.novas} novas, ${eDecision.hits} hits${eDecision.timedOut ? ' (still alive at the 900s cap)' : ''}`);
console.log(`endless: no-swap bot died in wave ${eNoSwap.wave} (${eNoSwap.time.toFixed(1)}s, ${eNoSwap.hits} hits)`
  + ` | sit-still died in wave ${eStill.wave} (${eStill.time.toFixed(1)}s)`
  + ` | random died in wave ${eRandom.wave} (${eRandom.time.toFixed(1)}s)`);
if (eDecision.wave < 4) { failures++; console.error(`  BOT FAIL: endless decision bot only reached wave ${eDecision.wave} (want 4+ — the mode has no depth for good play)`); }
if (!eNoSwap.lost || eNoSwap.wave > 2) { failures++; console.error(`  BOT FAIL: endless no-swap bot survived to wave ${eNoSwap.wave} (want dead in wave 1-2)`); }
if (!eStill.lost || eStill.wave > 2) { failures++; console.error(`  BOT FAIL: endless sit-still bot survived to wave ${eStill.wave} (want dead in wave 1-2)`); }
if (!eRandom.lost || eRandom.wave > 2) { failures++; console.error(`  BOT FAIL: endless random bot survived to wave ${eRandom.wave} (want dead in wave 1-2)`); }

if (failures > 0) { console.error(`bot: ${failures} failure(s)`); process.exit(1); }
console.log('bot: all gates pass — decision clears everything, no-swap / sit-still / random lose everywhere');
