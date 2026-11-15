// A fighter: one combatant, whether the local player or a bot. Both share this
// body — position, velocity, health, armour, loadout — and the same movement
// and damage code, so a bot is bound by exactly the physics the player is.
// Rendering of the body (for everyone but the player) is built here too.
import * as THREE from 'three';
import { WEAPONS, GRENADES, ARMOR, KIT_PRICE } from './config.js';
import { PALETTE, TEAM_COLORS } from './palette.js';
import { moveBody } from './physics.js';

export const STAND_HEIGHT = 1.78;
export const CROUCH_HEIGHT = 1.24;
const HALF_WIDTH = 0.34;
const BASE_SPEED = 5.3;
const GROUND_ACCEL = 40;
const AIR_ACCEL = 8;
const FRICTION = 10;
const GRAVITY = 21;
const JUMP_SPEED = 6.4;

export function makeWeaponState(key) {
  const def = WEAPONS[key];
  return { key, mag: def.mag, reserve: def.reserve };
}

function nameSprite(name, colourHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 56;
  const g = canvas.getContext('2d');
  g.font = '700 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.8)';
  g.shadowBlur = 5;
  g.fillStyle = colourHex;
  g.fillText(name, 128, 30);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(1.35, 0.3, 1);
  return sprite;
}

function buildModel(team, name) {
  const teamColour = new THREE.Color(TEAM_COLORS[team]);
  const dark = new THREE.Color(team === 'breach' ? PALETTE.rustDark : PALETTE.tealDark);
  const cloth = new THREE.MeshStandardMaterial({ color: teamColour, roughness: 0.85 });
  const clothDark = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: '#33373d', roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: '#8a6f56', roughness: 0.8 });
  const gunMetal = new THREE.MeshStandardMaterial({ color: '#22262b', roughness: 0.5, metalness: 0.5 });
  const visor = new THREE.MeshStandardMaterial({ color: '#10151a', roughness: 0.25, metalness: 0.4, emissive: teamColour, emissiveIntensity: 0.55 });
  const unit = new THREE.BoxGeometry(1, 1, 1);
  function part(parent, mat, w, h, d, x, y, z) {
    const mesh = new THREE.Mesh(unit, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const root = new THREE.Group();
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.11, 0.92, 0);
  legR.position.set(0.11, 0.92, 0);
  part(legL, pants, 0.17, 0.92, 0.18, 0, -0.46, 0);
  part(legR, pants, 0.17, 0.92, 0.18, 0, -0.46, 0);
  root.add(legL, legR);
  // The rig carries everything above the hips and pitches with the aim.
  const rig = new THREE.Group();
  rig.position.y = 1.38;
  root.add(rig);
  part(rig, cloth, 0.48, 0.62, 0.26, 0, -0.16, 0); // torso
  part(rig, clothDark, 0.53, 0.42, 0.31, 0, -0.2, 0); // vest
  part(rig, skin, 0.24, 0.26, 0.24, 0, 0.3, 0); // head
  part(rig, clothDark, 0.28, 0.13, 0.28, 0, 0.47, 0); // helmet
  part(rig, visor, 0.2, 0.05, 0.02, 0, 0.31, -0.13); // visor slit
  part(rig, cloth, 0.13, 0.13, 0.52, 0.31, -0.28, -0.18); // right arm, forward
  part(rig, cloth, 0.13, 0.13, 0.4, -0.31, -0.3, -0.1); // left arm
  part(rig, gunMetal, 0.07, 0.1, 0.62, 0.24, -0.3, -0.42); // the gun
  const tag = nameSprite(name, TEAM_COLORS[team]);
  tag.position.y = 2.08;
  root.add(tag);
  return { root, legL, legR, rig, tag };
}

export function createFighter(scene, team, name, isPlayer) {
  const fighter = {
    team, name, isPlayer,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, pitch: 0, crouching: false, onGround: true, alive: true,
    health: 100, armor: 0, helmet: false,
    money: 0, kills: 0, deaths: 0,
    slots: { primary: null, sidearm: makeWeaponState('kestrel') },
    active: 'sidearm', // 'primary' | 'sidearm' | a grenade key
    grenades: { shard: 0, flare: 0, veil: 0 },
    kit: false, carryingCharge: false,
    cooldown: 0, reloadLeft: 0, drawLeft: 0, bloom: 0, scoped: false,
    speedNow: 0, walkPhase: 0, stepAcc: 0, deathT: 0,
    lastAttacker: null, lastHurtAt: -99, flashUntil: 0, flashStrength: 0,
    onStep: null, model: null, bot: null,
  };
  if (!isPlayer) {
    fighter.model = buildModel(team, name);
    scene.add(fighter.model.root);
  }
  return fighter;
}

/**
 * Buy one item by key — a weapon key, 'vest', 'helm', 'kit', or a grenade
 * key. The one purchase path: the player's buy menu and the bots' shopping
 * both come through here, so the prices and slot rules cannot diverge.
 * Returns false (and changes nothing) when it cannot be had.
 */
export function buyItem(fighter, key) {
  if (WEAPONS[key]) {
    const def = WEAPONS[key];
    if (fighter.money < def.price) return false;
    if (def.slot === 'primary' && fighter.slots.primary?.key === key) return false;
    fighter.money -= def.price;
    fighter.slots[def.slot] = makeWeaponState(key);
    if (def.slot === 'primary') fighter.active = 'primary';
    return true;
  }
  if (GRENADES[key]) {
    if (fighter.money < GRENADES[key].price || fighter.grenades[key] >= 1) return false;
    fighter.money -= GRENADES[key].price;
    fighter.grenades[key] += 1;
    return true;
  }
  if (key === 'vest') {
    if (fighter.money < ARMOR.vestPrice || fighter.armor >= 100) return false;
    fighter.money -= ARMOR.vestPrice;
    fighter.armor = 100;
    return true;
  }
  if (key === 'helm') {
    if (fighter.money < ARMOR.helmPrice || (fighter.armor >= 100 && fighter.helmet)) return false;
    fighter.money -= ARMOR.helmPrice;
    fighter.armor = 100;
    fighter.helmet = true;
    return true;
  }
  if (key === 'kit') {
    if (fighter.money < KIT_PRICE || fighter.kit) return false;
    fighter.money -= KIT_PRICE;
    fighter.kit = true;
    return true;
  }
  return false;
}

export function activeWeapon(fighter) {
  if (fighter.active === 'primary' || fighter.active === 'sidearm') return fighter.slots[fighter.active];
  return null; // a grenade is in hand
}

export function eyeHeight(fighter) {
  return fighter.crouching ? 1.04 : 1.6;
}

export function eyePos(fighter, out) {
  return out.set(fighter.pos.x, fighter.pos.y + eyeHeight(fighter), fighter.pos.z);
}

/** Reset for a new round: back to a spawn, alive, keeping whatever gear survives. */
export function resetFighter(fighter, spawn, keepGear) {
  fighter.pos.set(spawn.x, 0, spawn.z);
  fighter.vel.set(0, 0, 0);
  fighter.yaw = fighter.team === 'breach' ? -Math.PI / 2 : Math.PI / 2;
  fighter.pitch = 0;
  fighter.crouching = false;
  fighter.alive = true;
  fighter.health = 100;
  fighter.deathT = 0;
  fighter.flashUntil = 0;
  fighter.flashStrength = 0;
  fighter.cooldown = 0;
  fighter.reloadLeft = 0;
  fighter.bloom = 0;
  if (!keepGear) {
    fighter.slots.primary = null;
    fighter.slots.sidearm = makeWeaponState('kestrel');
    fighter.active = 'sidearm';
    fighter.grenades = { shard: 0, flare: 0, veil: 0 };
    fighter.armor = 0;
    fighter.helmet = false;
    fighter.kit = false;
  } else {
    for (const slot of ['primary', 'sidearm']) {
      const w = fighter.slots[slot];
      if (w) { const def = WEAPONS[w.key]; w.mag = def.mag; w.reserve = Math.max(w.reserve, def.reserve); }
    }
    if (!fighter.slots.primary && fighter.active === 'primary') fighter.active = 'sidearm';
    if (fighter.grenades[fighter.active] !== undefined && fighter.grenades[fighter.active] === 0) fighter.active = fighter.slots.primary ? 'primary' : 'sidearm';
  }
  if (fighter.model) {
    fighter.model.root.visible = true;
    fighter.model.root.rotation.set(0, 0, 0);
  }
}

/**
 * One fixed step of body movement. wishX/wishZ are a world-space direction of
 * intent (length 0..1); the body's own speed cap comes from its weapon's
 * weight and stance. Footsteps accumulate into stepAcc for the caller to hear.
 */
export function moveFighter(fighter, dt, colliders, wishX, wishZ, flags = {}) {
  const weapon = activeWeapon(fighter);
  const weight = weapon ? WEAPONS[weapon.key].weight : 0.95;
  let cap = BASE_SPEED * weight * (flags.speedScale ?? 1);
  if (fighter.crouching) cap *= 0.47;
  if (flags.walk) cap *= 0.58;
  const wishLen = Math.hypot(wishX, wishZ);
  const accel = fighter.onGround ? GROUND_ACCEL : AIR_ACCEL;
  const blend = Math.min(1, (accel * dt) / Math.max(cap, 0.01));
  if (wishLen > 0.01) {
    const nx = (wishX / wishLen) * Math.min(1, wishLen);
    const nz = (wishZ / wishLen) * Math.min(1, wishLen);
    fighter.vel.x += (nx * cap - fighter.vel.x) * blend;
    fighter.vel.z += (nz * cap - fighter.vel.z) * blend;
  } else if (fighter.onGround) {
    const damp = Math.max(0, 1 - FRICTION * dt);
    fighter.vel.x *= damp;
    fighter.vel.z *= damp;
  }
  if (flags.jump && fighter.onGround) {
    fighter.vel.y = JUMP_SPEED;
    fighter.onGround = false;
  }
  fighter.vel.y -= GRAVITY * dt;
  fighter.vel.y = Math.max(-32, fighter.vel.y);
  const height = fighter.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
  const wasAirborne = !fighter.onGround;
  fighter.onGround = moveBody(colliders, fighter.pos, fighter.vel, HALF_WIDTH, height, dt);
  fighter.speedNow = Math.hypot(fighter.vel.x, fighter.vel.z);
  if (fighter.onGround && fighter.speedNow > 0.6) {
    fighter.stepAcc += fighter.speedNow * dt;
    const stride = fighter.crouching || flags.walk ? 3.1 : 2.3;
    if (fighter.stepAcc > stride) {
      fighter.stepAcc = 0;
      if (fighter.onStep) fighter.onStep(fighter, !(fighter.crouching || flags.walk));
    }
  }
  if (fighter.onGround && wasAirborne && fighter.onLand) fighter.onLand(fighter);
  return fighter.onGround;
}

/**
 * Apply one hit. raw already carries the location multiplier and the range
 * fade; pen is the weapon's armour penetration for the parts armour covers
 * (chest, stomach, and the head only with a helmet). Returns what landed.
 */
export function damageFighter(fighter, raw, part, pen) {
  if (!fighter.alive) return { dealt: 0, killed: false };
  const covered = fighter.armor > 0 && (part === 'chest' || part === 'stomach' || (part === 'head' && fighter.helmet));
  let dealt = raw;
  if (covered) {
    dealt = raw * pen;
    fighter.armor = Math.max(0, fighter.armor - raw * ARMOR.wear);
  }
  fighter.health -= dealt;
  const killed = fighter.health <= 0;
  if (killed) {
    fighter.health = 0;
    fighter.alive = false;
    fighter.deaths += 1;
    fighter.deathT = 0;
  }
  return { dealt, killed };
}

/** Pose the character model from the body state: walk swing, crouch, the fall. */
export function animateFighter(fighter, dt) {
  const model = fighter.model;
  if (!model) return;
  model.root.position.copy(fighter.pos);
  model.root.rotation.y = fighter.yaw;
  if (!fighter.alive) {
    fighter.deathT += dt;
    const fall = Math.min(1, fighter.deathT / 0.45);
    model.root.rotation.x = -fall * Math.PI * 0.48;
    model.root.position.y = fighter.pos.y + fall * 0.12;
    model.tag.visible = false;
    return;
  }
  model.tag.visible = true;
  fighter.walkPhase += fighter.speedNow * dt * 1.9;
  const swing = Math.min(1, fighter.speedNow / 3) * 0.55;
  model.legL.rotation.x = Math.sin(fighter.walkPhase) * swing;
  model.legR.rotation.x = -Math.sin(fighter.walkPhase) * swing;
  const crouchDip = fighter.crouching ? 0.5 : 0;
  model.rig.position.y = 1.38 - crouchDip;
  model.rig.rotation.x = fighter.pitch * 0.72;
  if (fighter.crouching) {
    model.legL.rotation.x = 0.95;
    model.legR.rotation.x = -0.45;
  }
}

export { STAND_HEIGHT as FIGHTER_STAND, CROUCH_HEIGHT as FIGHTER_CROUCH };
