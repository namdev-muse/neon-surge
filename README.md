# Neon Surge — Polarity Bullet-Hell Arena

![Menu](docs/screenshots/menu-1280x720.png)

A 2D neon polarity bullet-hell arena. Pilot a wisp through bullet storms:
enemy bullets come in **cyan** and **magenta**. Match your polarity to
**absorb** bullets and build charge — opposite-polarity bullets damage your
hull. Charge powers a **nova** that clears the screen and damages every
enemy. Polarity is the skill: there is no auto-swap, no assist, and no gun.
The nova is your only weapon, and absorbing is the only way to earn one.

**Live:** https://namdev-muse.github.io/neon-surge/ (v0.4.0 — M4 progression & depth)

## How to play

- **Move** — WASD / arrow keys. Touch: drag anywhere to steer.
- **Swap polarity** — Space / Shift. Touch: the SWAP button. Instant, but
  every swap is a decision: you can only absorb one colour at a time.
- **Nova** — X or click, once the charge bar is full. Touch: the NOVA
  button. Clears every bullet and damages every enemy.
- **Pause** — P. **Mute** — M. **Restart sector** — R.

Absorbing builds charge (+6 per bullet) and score (+10). A nova costs 65
charge. Clearing a sector scores a time bonus plus a hull bonus. Your best
score per sector is saved; clearing a sector unlocks the next.

## Progression (M4)

- **Clear rank** — finish a sector with 80+ hull for **S**, 50+ for **A**,
  below that **B**. The rank shows on the sector card and on the clear
  screen: the reason to replay a sector for a better result.
- **Endless Drift** — unlocks after clearing Sector 1. Waves of bullet
  patterns keep coming, built from the 12 sectors' patterns and seeded so
  every run deals the same waves: each wave adds enemies and bullet speed
  (capped so the storm stays readable), the polarity mix flips wave to
  wave, and a 3-second breather sits between waves. The run ends at hull
  0; your best wave and best score are saved separately and shown on the
  menu and the end screen. No hull is restored between waves — a good run
  earns its length.

## Sectors (12 hand-crafted)

| # | Sector | Identity |
|---|--------|----------|
| 1 | First Light | Slow cyan bullets first; the first magenta wave is telegraphed so the opening teaches the swap. Drifters, weavers, a sniper, a spinner. |
| 2 | Crossfire | Magenta-heavy mixed fire from both sides; two spinners firing rings at once. Opening softened in M2 by staggered spawns. |
| 3 | Vortex | The densest storm: three spinners, three snipers, crossing weaver spreads. |
| 4 | Twin Currents | Paired weaver streams cross the arena — cyan from the left, magenta from the right. |
| 5 | Sniper's Gallery | Sniper-heavy: six snipers park at the edges and telegraph every shot; drifters fill the gaps. |
| 6 | Ring Road | Spinner-heavy: five spinners, rings everywhere. No single polarity is safe inside a ring. |
| 7 | Crosswind | Weaver-heavy: weavers pour in from every side at once. Keep moving across the wind. |
| 8 | Magenta Tide | Magenta flood with cyan seams — live in magenta, dip into cyan only to feed the nova. |
| 9 | The Spiral | Spinners stack their rings into a spiral; absorb the streams between the rings. |
| 10 | Ambush Alley | Snipers and spinners trade ambushes down the alley; never sit in one lane. |
| 11 | Storm Surge | Everything at once, faster than ever — three-enemy waves, no safe lane. |
| 12 | The Heart | The final gauntlet: every enemy, every pattern, at full speed. |

## Feel (M3)

Every event fires a full tier bundle from the feedback table in
`physics.js` (`FEEDBACK`): trauma shake (shake = trauma²), hit-stop,
flash, slow-mo and shockwaves, layered with particles, number pops and
synth SFX — all inside the frame the event fires. Absorb streaks earn
milestone pops and chimes (×5/10/15/20/30/40/50); reaching a full charge
plays a nova-ready chime; a nova fires slow-mo, a zoom punch and a
shockwave; snipers crack when they shoot. A generative synth loop
(Am–F–C–G bass under an A-minor pentatonic arpeggio) plays under the
game, with a Music toggle in Settings. Screen shake (0–100%) and
flashing can be turned down or off in Settings.

## Enemies

- **Drifter** — drifts in and fires single aimed bullets.
- **Weaver** — sine-wave flight, fires a 5-bullet spread.
- **Sniper** — parks at the edge, glows and draws an aim line, then fires one fast shot.
- **Spinner** — slow rotating star that fires 14-bullet rings with alternating polarity — no single polarity is safe inside one.

## Anti-slop gates

Every sector is verified by bot harness (`node tests/bot.js`):

- A **decision bot** that swaps polarity and novas with real decisions clears all 12 sectors.
- A **no-swap bot** (same movement and nova play, never swaps) loses all 12.
- A **sit-still bot** and a **random masher** lose all 12.
- **Endless Drift:** the decision bot reaches wave 16; no-swap, sit-still
  and random bots all die in wave 1.

If a no-swap bot clears a sector, that sector is not done.

## Run locally

```sh
python3 -m http.server 8932   # then open http://localhost:8932/
```

Playtest path: `?sector=3` jumps straight into sector 3, bypassing the
unlock. `?endless=1` jumps straight into Endless Drift. Both are
deliberately not shown in the UI.

## Tests

```sh
node --check game.js && node --check physics.js
npm run smoke        # 396 assertions: sectors, movement (screen-space),
                     # swap, absorb, damage, nova, enemy fire, saves,
                     # feedback tiers, nova-ready crossing, music setting,
                     # clear ranks, endless wave generation + run flow
npm run bot          # anti-slop gates on all 12 sectors + endless drift
npm run render-check # headless Firefox: menu, demo, screen-space movement,
                     # swap, autopilot clear, pause, ?sector=3, ?endless=1,
                     # endless locked/unlocked + wave 1 -> wave 2,
                     # zero console errors
npm run screenshots  # size sweep: 1280x720, 2560x1080, 1080x2340 (inspect by eye)
```

## Tech

Vanilla Canvas 2D, vanilla HTML/CSS/JS, Web Audio API synth SFX, no build
step. Static files on GitHub Pages (main / root). The simulation lives in
`physics.js` (no DOM — fully testable in Node); `game.js` renders it and
owns the menu, HUD, input, particles, trauma shake, hit-stop and nova
slow-mo. Palette: deep-space indigo, cyan + magenta polarities, gold
score/charge/nova, violet arena grid — the same neon family as the series.
