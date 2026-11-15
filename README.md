# VEILBREAK — a three.js tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/mebiuss00/makefun-threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard)
[![reward](https://make.fun/badge/threejs-fps-02/mebiuss00/makefun-threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02)

A complete, original, round-based tactical first-person shooter that runs
offline in a desktop browser from static files — no build step, no network.
Counter-Strike in spirit, never in assets: its own map, names, art and sound
(every sound is synthesised live with WebAudio; there are no audio files).

## The game

You lead the **Breachers** against the **Wardens** in a dusk ore foundry,
5 v 5 with bot teammates and opponents. Each round:

- **Buy phase (12 s, frozen)** — spend the team's money: four buyable guns
  (Hornet SMG, Boar 12 shotgun, Lance AR, Longbow DMR) on top of your Kestrel
  pistol, armour, and three grenades (Shard frag, Flare flash, Veil smoke).
  Kills, plants, wins and loss streaks feed the economy.
- **Live round (100 s)** — take site **A, the Kiln**, or **B, the Vault**.
  Plant the Charge (hold **E**, 3.2 s) and hold it for 40 s, or eliminate the
  Wardens. If the Charge drops, a teammate can recover it.
- **Planted** — the Wardens retake and defuse (5 s with a kit, 10 s without)
  while the beeps accelerate. First team to 9 rounds takes the Foundry.

Gunplay is built so accuracy beats speed: hits are tested against a capsule
body plus a head sphere (headshots multiply damage, armour turns it by each
weapon's penetration), spread grows with movement, air and spray bloom, and
recoil kicks the aim — stopping, crouching and tapping wins fights. Bots play
by the same rules: they navigate a waypoint graph, hold posts, run lanes,
rotate on contact, stop to shoot in bursts, reload behind cover, throw
utility into sites, fetch a dropped Charge, plant, retake and defuse.

## Controls

| Keys | Action |
| --- | --- |
| W A S D / mouse | Move / look (pointer lock) |
| Click / right-click | Fire / aim (Longbow scope) |
| R | Reload |
| 1 2 3 4 5, wheel | Primary, sidearm, Shard, Flare, Veil |
| B, then 1–9 | Buy menu and purchases |
| E (hold) | Plant the Charge |
| G | Drop the Charge |
| Ctrl / C, Shift, Space | Crouch, walk quietly, jump |
| Tab | Scoreboard |

## Run it

Serve `game/` with any static file server and open `index.html` in desktop
Chrome (WebGL 2). Everything is vendored — three.js 0.187.0 sits in
`game/vendor/three/` behind the import map in `index.html`.

## Layout

- `main.ts` — the hand-in program: copies `game/` and `screenshots/` to the
  output and writes the dossier with `vendor/makefun-threejs.ts`.
- `game/src/` — one module per job: `config` (all tuning), `map` (the
  Foundry as data), `physics` (colliders and ray tests), `fighters` (bodies,
  movement, damage, buying), `weapons` (guns, recoil, grenades, viewmodels),
  `bots` (perception, navigation, tactics), `rounds` (phases, economy, the
  Charge), `fx` (tracers, particles, smoke), `audio` (synthesised sound),
  `hud` (every readout, the buy menu, the minimap), `input`, `palette`,
  and `main` (boot, the fixed-step loop, the camera).

The simulation runs at a fixed 60 Hz, apart from rendering; hot loops reuse
pooled objects and shared temporaries.

## License

MIT — see `LICENSE`.

---
Entered on make.fun — [threejs-fps-02](https://make.fun/bounty/threejs-fps-02)
