// VEILBREAK — boot and the one loop. A fixed 60 Hz simulation (rounds, bots,
// guns, grenades) feeds a render at the display's rate; the camera, the
// viewmodel and the HUD are projections of that simulation, never part of it.
// ?shot=buy|fight|plant|win with &seed=N stages a deterministic scene for a
// capture, renders it, freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS, GRENADES, BOT_NAMES } from './config.js';
import { createMap, SITES } from './map.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createBot, stepBot } from './bots.js';
import {
  createFighter, moveFighter, animateFighter, eyePos, activeWeapon, buyItem, damageFighter,
} from './fighters.js';
import { createArmory } from './weapons.js';
import { createRounds } from './rounds.js';
import { createHud, BUY_HOTKEYS } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 30, 95);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 220);
scene.add(camera);

const map = createMap(scene);
const fx = createFx(scene);
const audio = createAudio();

const player = createFighter(scene, 'breach', 'YOU', true);
const fighters = [player];
for (const name of BOT_NAMES.breach) {
  const f = createFighter(scene, 'breach', name, false);
  f.bot = createBot(f, fighters.length - 1);
  fighters.push(f);
}
for (const name of BOT_NAMES.ward) {
  const f = createFighter(scene, 'ward', name, false);
  f.bot = createBot(f, fighters.length - 5);
  fighters.push(f);
}
for (const f of fighters) {
  f.onStep = (fighter, run) => {
    audio.step(fighter.isPlayer ? null : fighter.pos, run);
    if (run && !fighter.crouching) pushNoise(fighter.pos, 11, fighter.team);
  };
}

const world = {
  now: 0, phase: 'menu', scene, map, fighters, player, fx, audio,
  sites: SITES, noise: [], armory: null,
  moveFighter: (f, dt, wx, wz, flags) => moveFighter(f, dt, map.colliders, wx, wz, flags),
};
function pushNoise(pos, radius, team) {
  world.noise.push({ x: pos.x, y: pos.y ?? 1, z: pos.z, at: world.now, team, radius });
  if (world.noise.length > 80) world.noise.splice(0, world.noise.length - 80);
}

let rounds = null;
let trauma = 0;
const hooks = {
  now: () => world.now,
  noise: pushNoise,
  hit(shooter, victim, part, dealt, killed) {
    if (shooter.isPlayer) {
      hud.hitmarker(killed);
      audio.hit(part === 'head');
    }
    if (victim.isPlayer) {
      audio.hurt();
      const dx = shooter.pos.x - player.pos.x;
      const dz = shooter.pos.z - player.pos.z;
      const attackerYaw = Math.atan2(-dx, -dz);
      let diff = attackerYaw - player.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      hud.damage(-diff, dealt);
      trauma = Math.min(1, trauma + 0.25);
    }
  },
  kill(killer, victim, weaponKey, headshot) {
    hud.killfeed(killer, victim, WEAPONS[weaponKey]?.name ?? GRENADES[weaponKey]?.name ?? weaponKey, headshot);
    if (killer.isPlayer) audio.kill();
    if (rounds) rounds.onKill(killer, victim);
  },
  blast(pos, radius) {
    const dist = player.pos.distanceTo(pos);
    trauma = Math.min(1, trauma + Math.max(0, 1 - dist / radius) * 0.9);
  },
  playerFlashed(strength) {
    if (strength > 0.45) audio.ring();
  },
};
const armory = createArmory({ scene, camera, map, fighters, fx, audio, hooks });
world.armory = armory;
world.hooks = hooks;
const hud = createHud({ onPlay: () => startPlaying() });
rounds = createRounds(world, { hud, audio });

let started = false;
let buyOpen = false;
let specIndex = 0;
let frozen = false;

const input = createInput(renderer.domElement, (locked) => {
  if (shot) return;
  if (!locked && started && world.phase !== 'over') {
    hud.showStart(null, null);
    document.getElementById('overlay-title').textContent = 'PAUSED';
    document.getElementById('overlay-copy').textContent = 'The round goes on without you. Click to get back in.';
    document.getElementById('play').textContent = 'Resume';
  }
});

function startPlaying() {
  audio.ensure();
  hud.showGame();
  if (!started || world.phase === 'over') {
    rounds.startMatch();
    started = true;
  }
  buyOpen = world.phase === 'buy';
  input.requestLock();
}

// ---- the local player's body, per fixed step -------------------------------

const eyeTmp = new THREE.Vector3();
let fovCurrent = 75;

function stepPlayer(dt) {
  const keys = input.state.keys;
  const phase = world.phase;
  const canAct = player.alive && (phase === 'live' || phase === 'planted' || phase === 'end');
  const frozenBody = phase === 'buy' || phase === 'menu' || phase === 'over' || !player.alive;
  player.crouching = !frozenBody && (keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'));
  let wishX = 0;
  let wishZ = 0;
  if (!frozenBody) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wishX = -sin * forward + cos * strafe;
      wishZ = -cos * forward - sin * strafe;
    }
  }
  moveFighter(player, dt, map.colliders, wishX, wishZ, {
    jump: !frozenBody && keys.has('Space'),
    walk: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  });
  armory.stepFighter(player, dt);
  if (!canAct) {
    player.scoped = false;
    return;
  }
  // Weapons and grenades.
  if (input.wasPressed('Digit1')) armory.setActive(player, 'primary');
  if (input.wasPressed('Digit2')) armory.setActive(player, 'sidearm');
  if (input.wasPressed('Digit3')) armory.setActive(player, 'shard');
  if (input.wasPressed('Digit4')) armory.setActive(player, 'flare');
  if (input.wasPressed('Digit5')) armory.setActive(player, 'veil');
  if (input.state.wheel > 0) cycleWeapon(1);
  if (input.state.wheel < 0) cycleWeapon(-1);
  if (keys.has('KeyR')) armory.startReload(player);
  const weapon = activeWeapon(player);
  if (weapon) {
    armory.tryFire(player, input.state.firing, input.state.clicked);
  } else if (input.state.clicked) {
    armory.throwGrenade(player, world.now);
  }
  player.scoped = Boolean(weapon && WEAPONS[weapon.key].zoom > 0 && input.state.aiming && player.drawLeft <= 0);
  // Drop the Charge.
  if (input.wasPressed('KeyG') && player.carryingCharge && world.bomb.state === 'held') {
    player.carryingCharge = false;
    world.bomb.state = 'dropped';
    world.bomb.carrier = null;
    world.bomb.pos.set(player.pos.x - Math.sin(player.yaw) * 1.1, 0.12, player.pos.z - Math.cos(player.yaw) * 1.1);
  }
}

function cycleWeapon(dir) {
  const owned = [];
  if (player.slots.primary) owned.push('primary');
  owned.push('sidearm');
  for (const kind of ['shard', 'flare', 'veil']) if (player.grenades[kind] > 0) owned.push(kind);
  const at = owned.indexOf(player.active);
  const next = owned[(at + dir + owned.length) % owned.length];
  if (next) armory.setActive(player, next);
}

function stepBuying() {
  if (world.phase !== 'buy' || !player.alive) {
    if (buyOpen) { buyOpen = false; hud.setBuyVisible(false); }
    return;
  }
  if (!buyOpen) { buyOpen = true; hud.setBuyVisible(true, player); }
  if (input.wasPressed('KeyB')) {
    buyOpen = false;
    hud.setBuyVisible(false);
    return;
  }
  for (const [code, item] of BUY_HOTKEYS) {
    if (input.wasPressed(code)) {
      if (buyItem(player, item)) {
        audio.buyOk();
        hud.flashBuy(item);
        hud.renderBuy(player);
      } else {
        audio.buyNo();
      }
    }
  }
}

// ---- camera -----------------------------------------------------------------

const specEye = new THREE.Vector3();
function syncCamera(dt) {
  trauma = Math.max(0, trauma - dt * 2.6);
  const shake = trauma * trauma * 0.05;
  const shakeX = (Math.random() - 0.5) * shake;
  const shakeY = (Math.random() - 0.5) * shake;
  if (player.alive) {
    eyePos(player, eyeTmp);
    const bob = Math.min(1, player.speedNow / 5) * 0.028;
    camera.position.set(eyeTmp.x, eyeTmp.y + Math.abs(Math.sin(player.walkPhase)) * bob, eyeTmp.z);
    camera.rotation.set(player.pitch + shakeX, player.yaw + shakeY, 0, 'YXZ');
    hud.spectate(null);
  } else {
    const mates = fighters.filter((f) => f.team === player.team && f.alive && !f.isPlayer);
    if (mates.length > 0) {
      const target = mates[specIndex % mates.length];
      eyePos(target, specEye);
      camera.position.copy(specEye);
      camera.rotation.set(target.pitch + shakeX, target.yaw + shakeY, 0, 'YXZ');
      hud.spectate(target.name);
    } else {
      camera.position.set(0, 34, 18);
      camera.rotation.set(-1.1, 0, 0, 'YXZ');
      hud.spectate('—');
    }
  }
  const weapon = activeWeapon(player);
  const targetFov = player.scoped && weapon ? 75 / WEAPONS[weapon.key].zoom : 75;
  fovCurrent += (targetFov - fovCurrent) * Math.min(1, dt * 11);
  if (Math.abs(fovCurrent - camera.fov) > 0.05) {
    camera.fov = fovCurrent;
    camera.updateProjectionMatrix();
  }
}

// ---- the loop ----------------------------------------------------------------

let accumulator = 0;
let lastTime = performance.now();

function step(dt) {
  world.now += dt;
  stepPlayer(dt);
  stepBuying();
  for (const f of fighters) if (f.bot) stepBot(f.bot, world, dt);
  armory.stepGrenades(dt, world.now);
  rounds.step(dt, { channel: input.state.keys.has('KeyE') });
  fx.update(dt, world.now);
  world.phase = rounds.match.phase;
  // The interact prompt: what E would do here.
  if (player.alive && world.phase === 'live' && player.carryingCharge && world.map.siteAt(player.pos.x, player.pos.z)) {
    hud.interact('Hold to plant the Charge');
  } else {
    hud.interact(null);
  }
  if (input.state.clicked && !player.alive) specIndex += 1;
  input.endFrame();
}

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min((nowMs - lastTime) / 1000, 0.1);
  lastTime = nowMs;
  if (!frozen) {
    const look = input.takeLook();
    if (player.alive && input.state.locked) {
      const sens = player.scoped ? 0.0009 : 0.0021;
      player.yaw -= look.x * sens;
      player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - look.y * sens));
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    for (const f of fighters) if (f.bot) animateFighter(f, dt);
    armory.updateViewmodel(player, dt, world.now);
    syncCamera(dt);
    audio.setListener(camera.position.x, camera.position.y, camera.position.z);
    hud.update(world.now, { player, match: rounds.match, world, fighters });
    hud.setScoreboard(input.state.keys.has('Tab'), fighters, player);
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- staged captures ----------------------------------------------------------

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function stageShot(name) {
  hud.showGame();
  rounds.startMatch();
  started = true;
  const ward = fighters.filter((f) => f.team === 'ward');
  if (name === 'buy') {
    player.money = 4350;
    buyItem(player, 'lance');
    buyItem(player, 'helm');
    buyItem(player, 'flare');
    buyOpen = true;
    hud.setBuyVisible(true, player);
    player.yaw = -Math.PI / 2 + 0.35;
    settle(2);
  } else if (name === 'fight') {
    world.phase = 'live';
    rounds.match.phase = 'live';
    rounds.match.phaseT = 74;
    player.money = 5200;
    buyItem(player, 'lance');
    buyItem(player, 'helm');
    // Staged on site A, past the door: clear floor, a clear 6.5 m lane,
    // and the kiln crates as backdrop (spots and lane verified against
    // the map's box data).
    player.pos.set(15.5, 0, -9.8);
    player.yaw = -Math.PI / 2;
    const a = ward[0];
    a.pos.set(22, 0, -9.3);
    // The Warden holds his ground and trades fire — he does not wander
    // out of the frame while the shutter is open.
    a.bot.state = 'hold';
    a.bot.post = a.pos.clone();
    a.bot.enemy = player;
    a.bot.lastSeenAt = world.now;
    a.bot.spotAt = world.now + 0.1;
    eyePos(player, a.bot.lastSeenPos);
    settle(10);
    // The player answers: aim at the nearer Warden's chest and fire.
    const dx = a.pos.x - player.pos.x;
    const dz = a.pos.z - player.pos.z;
    player.yaw = Math.atan2(-dx, -dz);
    player.pitch = -0.02;
    armory.tryFire(player, true, true);
    settle(4);
    armory.tryFire(player, true, false);
    settle(3);
    armory.tryFire(player, true, false);
    settle(1);
    hud.banner('', '', 0); // the round-intro card would still be up in real time
  } else if (name === 'plant') {
    world.phase = 'live';
    rounds.match.phase = 'live';
    rounds.match.phaseT = 41;
    player.money = 6100;
    buyItem(player, 'lance');
    buyItem(player, 'helm');
    world.plan.site = 'A'; // the objective line must name the site we stage
    const plant = SITES.A.plant;
    player.pos.set(plant.x + 0.6, 0, plant.z + 0.4);
    player.yaw = 1.9; // face the A-long door he came through, not the kiln wall
    world.bomb.plantProgress = 2.0;
    // A teammate covers the door behind.
    const mate = fighters[1];
    mate.pos.set(18.5, 0, -9);
    mate.yaw = 2.4;
    // One tick with E held writes the progress bar, then we freeze on it.
    input.state.keys.add('KeyE');
    step(FIXED_STEP);
    input.state.keys.delete('KeyE');
    hud.banner('', '', 0);
  } else if (name === 'win') {
    world.phase = 'live';
    rounds.match.phase = 'live';
    // Real flow only: the last onKill ends the round, and endRound itself
    // scores it, pays out, and raises the ROUND WON banner.
    for (const f of ward) damageFighter(f, 500, 'chest', 1);
    for (const f of ward) rounds.onKill(null, f);
    settle(2);
  }
  syncCamera(0.016);
  hud.update(world.now, { player, match: rounds.match, world, fighters });
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 3) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.__game = { world, player, fighters, rounds, armory, map, damageFighter, startMatch: () => rounds.startMatch() };
if (shot) stageShot(shot);
else requestAnimationFrame(frame);
