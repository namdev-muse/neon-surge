# Neon Surge — devlog

A 12-hour sprint, Mon 2026-11-23 23:30 – Tue 2026-11-24 11:30
Asia/Bangkok. Game #10 in the Neon series, the 2D game of the loop
(games #7–#9 were 3D). Milestone-driven: one milestone at a time, each
shipped only after a real-browser playtest judged it fun. No
feature-count target — quality over quantity.

## The core

Polarity is the skill. Enemy bullets come in cyan and magenta; your
wisp has one polarity at a time. Same-colour bullets are absorbed and
build charge; opposite-colour bullets damage your hull. Swapping is
instant, but you can only absorb one colour at a time, and the bullet
mix forces constant reads. Charge powers a nova — your only weapon —
which clears the screen and damages every enemy. There is no auto-swap,
no assist, no "best polarity" hint. If a bot that never swaps can clear
a sector, that sector is not done.

## M1 — Core (v0.1.0, live playtest GO 2026-11-24 01:57)

Movement, instant polarity swap, absorb/damage, nova, four enemy types
(drifter / weaver / sniper / spinner), three dense hand-crafted sectors,
live animated menu with a screen stack. First sector opens slow and
single-colour so the first minutes teach instead of punishing. The bot
gates were built in from day one: a decision bot clears all three
sectors, a no-swap bot loses all three.

## M2 — Sector craft (v0.2.0–v0.2.3, live playtest GO 2026-11-24 05:06)

Twelve hand-crafted sectors, each with its own bullet patterns, enemy
mix and accent — no dead space, no filler. Five live playtest rounds
tuned the curve: sector 2's opening softened by spawn spacing (not
count cuts — cutting counts starves the charge economy), the post-nova
lull fixed by compressing the next wave to +2.5s, a sniper-entry bug
(snipers never entered or fired) fixed, telegraphs brightened. The
hardest lesson was the same as every game before it: passing tests are
the floor, and three of the five rounds said NO-GO before the GO
landed.

## M3 — Feel & juice (v0.3.0, live playtest GO 2026-11-24 06:05)

Every event fires a full tier bundle — sound, particles, trauma shake,
flash, number pops — inside the frame it fires. Nova-ready chime,
sniper-shot crack, absorb-streak milestone pops, nova slow-mo with a
zoom punch, generative synth loop (Am–F–C–G bass under a pentatonic
arpeggio). The playtest said the flying *feels* great, which was the
whole point of the milestone. Caveat carried forward: nobody has
listened to the music critically by ear.

## M4 — Progression & depth (v0.4.0, live playtest GO 2026-11-24 08:53)

Clear ranks (S at 80 hull, A at 50, B below) on every sector card and
clear screen, and Endless Drift — seeded scaling waves cycling the
twelve sector patterns, polarity lean flipping wave to wave, best wave
and score saved. No hull restore between waves: the decision bot
reaches wave 16. The live playtest's replay hooks landed — the tester
wanted an A after a B clear, and wanted to beat wave 1 after a 2,020
point run. Two real bugs came out of it: the wisp read as a weaver
(both a polarity-coloured diamond), and results could be lost by
reloading during the 0.9s end-screen transition.

## M5 — Polish & robustness (v0.5.0, live playtest GO 2026-11-24 10:31)

The wisp became a velocity-pointed dart with a white outline and a
persistent white ring — unmistakable at a glance. Results are now
recorded the moment a run ends, not at the end screen. Flashes and
toasts run on real seconds. Portrait letterbox bands are star-filled.
Settings gained text size and contrast. An FPS guard drops the DPR cap
when the frame rate sags. Cross-browser: Firefox render check plus a
Chromium probe, zero console errors on both. A desktop-browser report
of missing touch buttons in Sector 2 / Endless could not be reproduced
from the shipped code and is logged as unverified, not fixed by
guessing.

## M6 — Release (v1.0.0)

README, screenshots, this devlog, final full playthrough in a real
browser, release tag v1.0.0. The live build is the last version that
passed its tests and its playtests; anything that didn't earn a GO
stayed local.

## What we didn't ship

Nothing that failed its playtest. The quality gate held all sprint:
a milestone that wasn't fun didn't push, even at sprint end. Known
issues are listed honestly in the README — touch on a real device,
music by ear, Endless wave 2+ by human hand, sectors 5 and 9 by human
hand — all open, none game-breaking.
