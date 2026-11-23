# Neon Surge — Polarity Bullet-Hell Arena

![Menu](docs/screenshots/menu-1280x720.png)

A 2D neon polarity bullet-hell arena. Pilot a wisp through bullet storms:
enemy bullets come in **cyan** and **magenta**. Match your polarity to
**absorb** bullets and build charge — opposite-polarity bullets damage your
hull. Charge powers a **nova** that clears the screen and damages every
enemy. Polarity is the skill: there is no auto-swap, no assist, and no gun.
The nova is your only weapon, and absorbing is the only way to earn one.

**Live:** https://namdev-muse.github.io/neon-surge/ (v0.1.0 — M1 core, 3 sectors)

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

## Sectors (M1 ships 3)

| # | Sector | Identity |
|---|--------|----------|
| 1 | First Light | Slow cyan bullets first; the first magenta wave is telegraphed so the opening teaches the swap. Drifters, weavers, a sniper, a spinner. |
| 2 | Crossfire | Magenta-heavy mixed fire from both sides; two spinners firing rings at once. |
| 3 | Vortex | The densest storm: three spinners, three snipers, crossing weaver spreads. |

## Enemies

- **Drifter** — drifts in and fires single aimed bullets.
- **Weaver** — sine-wave flight, fires a 5-bullet spread.
- **Sniper** — parks at the edge, glows and draws an aim line, then fires one fast shot.
- **Spinner** — slow rotating star that fires 14-bullet rings with alternating polarity — no single polarity is safe inside one.

## Anti-slop gates

Every sector is verified by bot harness (`node tests/bot.js`):

- A **decision bot** that swaps polarity and novas with real decisions clears all 3 sectors.
- A **no-swap bot** (same movement and nova play, never swaps) loses all 3.
- A **sit-still bot** and a **random masher** lose all 3.

If a no-swap bot clears a sector, that sector is not done.

## Run locally

```sh
python3 -m http.server 8932   # then open http://localhost:8932/
```

Playtest path: `?sector=3` jumps straight into sector 3, bypassing the
unlock. It is deliberately not shown in the UI.

## Tests

```sh
node --check game.js && node --check physics.js
npm run smoke        # 154 assertions: sectors, movement (screen-space),
                     # swap, absorb, damage, nova, enemy fire, saves
npm run bot          # anti-slop gates on all 3 sectors
npm run render-check # headless Chromium: menu, demo, screen-space movement,
                     # swap, autopilot clear, pause, ?sector=3, zero console errors
npm run screenshots  # size sweep: 1280x720, 2560x1080, 1080x2340 (inspect by eye)
```

## Tech

Vanilla Canvas 2D, vanilla HTML/CSS/JS, Web Audio API synth SFX, no build
step. Static files on GitHub Pages (main / root). The simulation lives in
`physics.js` (no DOM — fully testable in Node); `game.js` renders it and
owns the menu, HUD, input, particles, trauma shake, hit-stop and nova
slow-mo. Palette: deep-space indigo, cyan + magenta polarities, gold
score/charge/nova, violet arena grid — the same neon family as the series.
