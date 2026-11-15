// Bot brains. A bot perceives on a staggered clock (sight through a vision cone
// with line-of-sight and smoke, hearing from the shared noise list, pain from
// its last attacker), navigates the waypoint graph with A*, and fights with
// the same guns, spread and movement rules as the player: it stops to shoot,
// fires in bursts, and reloads behind cover. Tactics sit on top: the
// Breachers pick a site, run lanes, plant and hold; the Wardens hold posts,
// rotate on information, retake and defuse.
import * as THREE from 'three';
import { WEAPONS, GRENADES, ARMOR, KIT_PRICE } from './config.js';
import { HOLD_POSTS } from './map.js';
import { segmentBlocked, segmentThroughSmoke } from './physics.js';
import { activeWeapon, eyePos } from './fighters.js';

const eyeA = new THREE.Vector3();
const eyeB = new THREE.Vector3();
const toEnemy = new THREE.Vector3();

export function createBot(fighter, index) {
  const skill = 0.78 + Math.random() * 0.4;
  return {
    fighter, index, skill,
    reaction: 0.52 - skill * 0.18,
    state: 'advance',
    path: [], pathI: 0, dest: null, destName: null,
    lastPos: { x: fighter.pos.x, z: fighter.pos.z }, stuckFor: 0,
    perceiveAt: Math.random() * 0.12,
    enemy: null, spotAt: 0, lastSeenAt: -99, lastSeenPos: new THREE.Vector3(),
    heardPos: null, heardAt: -99,
    burstLeft: 0, burstWait: 0, strafeDir: 1, strafeAt: 0, crouchAt: 0,
    aimYawOff: 0, aimPitchOff: 0,
    holdNode: null, holdYaw: 0, scanPhase: Math.random() * 6,
    laneIndex: index, laneStep: 0, role: 'hold', postSite: 'A', postIndex: 0,
    threwUtility: false, jumpAt: -9, nadeAt: 0, nading: false, prevFire: false,
    planting: false, defusing: false,
  };
}

function angleWrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function yawTo(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/** Can this bot see that fighter right now? Writes the reason into out.dist. */
function canSee(bot, other, world, out) {
  const me = bot.fighter;
  eyePos(me, eyeA);
  eyePos(other, eyeB);
  const dist = eyeA.distanceTo(eyeB);
  out.dist = dist;
  if (dist > 58) return false;
  toEnemy.subVectors(eyeB, eyeA).normalize();
  const cos = Math.cos(me.pitch);
  const facing = (-Math.sin(me.yaw) * cos) * toEnemy.x + Math.sin(me.pitch) * toEnemy.y + (-Math.cos(me.yaw) * cos) * toEnemy.z;
  const inCone = facing > (dist < 9 ? -0.4 : 0.25);
  if (!inCone) return false;
  if (segmentBlocked(eyeA, eyeB, world.map.colliders)) return false;
  if (dist > 3.5 && segmentThroughSmoke(eyeA, eyeB, world.fx.smokes)) return false;
  return true;
}

const seeInfo = { dist: 0 };

function perceive(bot, world) {
  const me = bot.fighter;
  const now = world.now;
  let best = null;
  let bestDist = Infinity;
  for (const other of world.fighters) {
    if (other.team === me.team || !other.alive) continue;
    if (canSee(bot, other, world, seeInfo)) {
      if (seeInfo.dist < bestDist) { bestDist = seeInfo.dist; best = other; }
    }
  }
  if (best) {
    if (bot.enemy !== best) {
      bot.enemy = best;
      bot.spotAt = now + bot.reaction * (0.7 + bestDist / 60);
      bot.aimYawOff = (Math.random() - 0.5) * 0.05 / bot.skill;
      bot.aimPitchOff = (Math.random() - 0.5) * 0.04 / bot.skill;
    }
    bot.lastSeenAt = now;
    eyePos(best, bot.lastSeenPos);
    bot.lastSeenPos.y -= 0.12;
    // Share the contact with the team: which site, or mid.
    const site = world.map.siteAt(best.pos.x, best.pos.z);
    world.teamInfo[me.team].contactAt = now;
    world.teamInfo[me.team].contactSite = site ?? world.teamInfo[me.team].contactSite;
  } else if (bot.enemy && (!bot.enemy.alive || now - bot.lastSeenAt > 3.2)) {
    bot.enemy = null;
  }
  // Hearing: fresh enemy noise pulls the head, and sometimes the feet.
  for (const noise of world.noise) {
    if (noise.team === me.team || now - noise.at > 1.4) continue;
    const dist = Math.hypot(noise.x - me.pos.x, noise.z - me.pos.z);
    if (dist < noise.radius) {
      bot.heardPos = bot.heardPos ?? new THREE.Vector3();
      bot.heardPos.set(noise.x, noise.y, noise.z);
      bot.heardAt = now;
    }
  }
  // Pain is the loudest signal: face whoever is shooting me.
  if (me.lastAttacker && me.lastAttacker.alive && now - me.lastHurtAt < 1.6) {
    bot.lastSeenAt = now;
    eyePos(me.lastAttacker, bot.lastSeenPos);
    if (!bot.enemy) {
      bot.enemy = me.lastAttacker;
      bot.spotAt = now + bot.reaction * 0.6;
    }
  }
}

function setDest(bot, world, nodeName, exact) {
  const me = bot.fighter;
  const target = exact ?? world.map.byName.get(nodeName);
  if (!target) return;
  const start = world.map.nearestNode(me.pos.x, me.pos.z);
  const goal = exact ? world.map.nearestNode(exact.x, exact.z) : target;
  bot.path = world.map.findPath(start.index, goal.index);
  bot.pathI = 0;
  bot.destName = nodeName;
  bot.dest = exact ? { x: exact.x, z: exact.z } : { x: target.x, z: target.z };
  bot.stuckFor = 0;
}

/** Steer along the path. Returns the wish direction, or null on arrival. */
function followPath(bot, world, dt) {
  const me = bot.fighter;
  if (!bot.dest) return null;
  let tx = bot.dest.x;
  let tz = bot.dest.z;
  if (bot.pathI < bot.path.length) {
    // bot.path holds node INDICES (that is what findPath returns) — every
    // waypoint read must go through the map's node table first.
    const node = world.map.nodes[bot.path[bot.pathI]];
    tx = node.x; tz = node.z;
    // Skip nodes already reached, and nodes visible ahead (smooth corners).
    while (bot.pathI < bot.path.length - 1) {
      const ahead = world.map.nodes[bot.path[bot.pathI + 1]];
      eyeA.set(me.pos.x, 0.55, me.pos.z);
      eyeB.set(ahead.x, 0.55, ahead.z);
      if (Math.hypot(ahead.x - me.pos.x, ahead.z - me.pos.z) < 11 && !segmentBlocked(eyeA, eyeB, world.map.colliders)) {
        bot.pathI += 1;
        tx = ahead.x; tz = ahead.z;
      } else break;
    }
    if (Math.hypot(tx - me.pos.x, tz - me.pos.z) < 0.85) {
      bot.pathI += 1;
      if (bot.pathI >= bot.path.length) return arrive(bot);
      const node2 = world.map.nodes[bot.path[bot.pathI]];
      tx = node2.x; tz = node2.z;
    }
  } else if (Math.hypot(tx - me.pos.x, tz - me.pos.z) < 0.6) {
    return arrive(bot);
  }
  const dx = tx - me.pos.x;
  const dz = tz - me.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  // Stuck? Shuffle sideways and, once, jump.
  if (me.speedNow < 0.35) {
    bot.stuckFor += dt;
    if (bot.stuckFor > 1.1) {
      bot.stuckFor = 0;
      bot.jumpAt = world.now;
      bot.pathI = Math.max(0, bot.pathI - 1);
    }
  } else bot.stuckFor = 0;
  bot.lastPos.x = me.pos.x;
  bot.lastPos.z = me.pos.z;
  return { x: dx / len, z: dz / len, tx, tz };
}

function arrive(bot) {
  bot.dest = null;
  bot.path = [];
  return null;
}

const LANES = {
  A: [
    ['longW', 'longM', 'longE', 'aW'],
    ['upperWest', 'hallW', 'hall', 'hallA'],
    ['westDoor', 'midW', 'midE', 'midDoor', 'corrW', 'aDoor'],
  ],
  B: [
    ['tunDoorOut', 'tunDoor', 'tunM', 'tunE', 'tunExit', 'shortE', 'bS'],
    ['shortW', 'short', 'shortN', 'bW'],
    ['westDoor', 'midW', 'midS', 'shortN', 'bW'],
  ],
};
const SITE_HOLDS = { A: ['aS', 'aE', 'aBack'], B: ['bN', 'bPlant', 'bW'] };

function turnToward(bot, targetYaw, targetPitch, dt, rate = 5.6) {
  const me = bot.fighter;
  const dy = angleWrap(targetYaw - me.yaw);
  const step = Math.max(-rate * dt, Math.min(rate * dt, dy));
  me.yaw += step;
  const dp = targetPitch - me.pitch;
  me.pitch += Math.max(-rate * 0.7 * dt, Math.min(rate * 0.7 * dt, dp));
  return Math.abs(dy) + Math.abs(dp);
}

/**
 * Fight the seen enemy. Returns { wish, fire, crouch } for this tick. The bot
 * closes or backs off to its weapon's band, strafes between bursts, and only
 * fires settled: the shared spread rules punish its movement exactly like
 * the player's.
 */
function combat(bot, world, dt) {
  const me = bot.fighter;
  const enemy = bot.enemy;
  const now = world.now;
  const out = { wish: null, fire: false, crouch: me.crouching };
  if (now < me.flashUntil) {
    turnToward(bot, me.yaw + 2.4, 0, dt);
    out.crouch = true;
    return out;
  }
  const weapon = activeWeapon(me);
  const def = weapon ? WEAPONS[weapon.key] : WEAPONS.kestrel;
  eyePos(me, eyeA);
  const dx = bot.lastSeenPos.x - eyeA.x;
  const dy = bot.lastSeenPos.y - eyeA.y;
  const dz = bot.lastSeenPos.z - eyeA.z;
  const distXZ = Math.hypot(dx, dz);
  const dist = Math.hypot(distXZ, dy);
  turnToward(bot, Math.atan2(-dx, -dz) + bot.aimYawOff, Math.atan2(dy, distXZ) + bot.aimPitchOff, dt, 4.6 + bot.skill * 1.6);
  const fresh = now - bot.lastSeenAt < 0.3 && enemy && enemy.alive;
  // Range band per weapon.
  const bandMax = def.key === 'boar' ? 13 : def.key === 'hornet' ? 24 : def.key === 'longbow' ? 60 : 40;
  const bandMin = def.key === 'longbow' ? 13 : 0;
  let mx = 0;
  let mz = 0;
  if (dist > bandMax) { mx = dx / dist; mz = dz / dist; }
  else if (dist < bandMin) { mx = -dx / dist; mz = -dz / dist; }
  else {
    if (now > bot.strafeAt) {
      bot.strafeAt = now + 0.45 + Math.random() * 0.7;
      bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
      bot.aimYawOff = (Math.random() - 0.5) * 0.05 / bot.skill;
    }
    mx = (-dz / dist) * bot.strafeDir * 0.8;
    mz = (dx / dist) * bot.strafeDir * 0.8;
  }
  out.wish = (mx || mz) ? { x: mx, z: mz } : null;
  out.speedScale = dist > bandMax ? 1 : 0.82;
  // Crouch in the pauses, like a player tapping control between bursts.
  out.crouch = bot.burstWait > 0.05 && dist > 9 && def.key !== 'boar';
  // Fire discipline (skipped while a grenade is in hand; the nading flow
  // further down is the one that throws it).
  if (weapon && weapon.mag === 0) {
    world.armory.startReload(me);
    out.crouch = true;
    out.wish = { x: -dx / (dist || 1), z: -dz / (dist || 1) };
    return out;
  }
  if (weapon && fresh && now >= bot.spotAt) {
    if (bot.burstWait > 0) {
      bot.burstWait -= dt;
    } else {
      if (bot.burstLeft <= 0) {
        bot.burstLeft = def.auto ? 2 + Math.floor(Math.random() * 3 / bot.skill) : 1;
      }
      const aligned = Math.abs(angleWrap(Math.atan2(-dx, -dz) - me.yaw)) < 0.085;
      if (aligned) {
        out.fire = true;
        out.fireEdge = bot.prevFire !== true;
        if (world.armory.tryFire(me, true, out.fireEdge)) {
          bot.burstLeft -= 1;
          if (bot.burstLeft <= 0) bot.burstWait = (def.auto ? 0.24 : 0.42) + Math.random() * 0.3 / bot.skill;
        }
      }
    }
  }
  // A grenade for an enemy who just ducked behind cover.
  if (!fresh && now - bot.lastSeenAt > 0.7 && now - bot.lastSeenAt < 2.4 && dist > 5 && dist < 15 &&
      me.grenades.shard > 0 && now > (bot.nadeAt ?? 0) && me.active !== 'shard') {
    bot.nadeAt = now + 9;
    bot.nading = true;
    world.armory.setActive(me, 'shard');
  }
  if (bot.nading) {
    turnToward(bot, Math.atan2(-dx, -dz), Math.atan2(dy + 1.6, distXZ), dt, 6);
    if (Math.abs(angleWrap(Math.atan2(-dx, -dz) - me.yaw)) < 0.1) {
      world.armory.throwGrenade(me, now);
      bot.nading = false;
      world.armory.setActive(me, me.slots.primary ? 'primary' : 'sidearm');
    }
  }
  bot.prevFire = out.fire;
  return out;
}

function laneStep(bot, world, dt) {
  const me = bot.fighter;
  const lanes = LANES[world.plan.site];
  const lane = lanes[bot.laneIndex % lanes.length];
  if (bot.laneStep === undefined) bot.laneStep = 0;
  const nodeName = lane[Math.min(bot.laneStep, lane.length - 1)];
  if (bot.destName !== nodeName && !bot.dest) setDest(bot, world, nodeName);
  const wish = followPath(bot, world, dt);
  if (!wish && bot.destName === nodeName) {
    bot.laneStep += 1;
    if (bot.laneStep >= lane.length) return null; // lane done: caller pushes in
  }
  // Face the way we walk, or the last place trouble was heard.
  if (wish) turnToward(bot, Math.atan2(-wish.x, -wish.z), 0, dt, 4.2);
  else if (bot.heardPos && world.now - bot.heardAt < 2.5) {
    turnToward(bot, yawTo(me.pos, bot.heardPos), 0, dt, 3.4);
  }
  return wish;
}

function pushSiteStep(bot, world, dt) {
  const me = bot.fighter;
  const site = world.plan.site;
  // Utility on the way in, once: smoke or flash the site's heart.
  if (!bot.threwUtility) {
    const centre = world.map.byName.get(site === 'A' ? 'aPlant' : 'bPlant');
    const dist = Math.hypot(centre.x - me.pos.x, centre.z - me.pos.z);
    const kind = me.grenades.veil > 0 ? 'veil' : me.grenades.flare > 0 ? 'flare' : null;
    if (kind && dist < 17 && dist > 6) {
      bot.threwUtility = true;
      world.armory.setActive(me, kind);
      turnToward(bot, yawTo(me.pos, centre), 0.24, dt, 7);
      world.armory.throwGrenade(me, world.now);
      world.armory.setActive(me, me.slots.primary ? 'primary' : 'sidearm');
      return null;
    }
    if (!kind || dist <= 6) bot.threwUtility = true; // nothing to throw, or too close to bother
  }
  const holds = SITE_HOLDS[site];
  const hold = holds[bot.index % holds.length];
  if (bot.destName !== hold && !bot.dest) setDest(bot, world, hold);
  const wish = followPath(bot, world, dt);
  if (wish) turnToward(bot, Math.atan2(-wish.x, -wish.z), 0, dt, 4.2);
  return wish;
}

function stepBreach(bot, world, dt) {
  const me = bot.fighter;
  const bomb = world.bomb;
  bot.planting = false;
  if (bomb.state === 'planted') {
    return pushSiteStep(bot, world, dt); // hold the site we took
  }
  if (me.carryingCharge) {
    const site = world.plan.site;
    const plant = world.sites[site].plant;
    if (world.map.siteAt(me.pos.x, me.pos.z) === site) {
      if (Math.hypot(plant.x - me.pos.x, plant.z - me.pos.z) > 1.1) {
        if (!bot.dest || bot.destName !== 'plant') setDest(bot, world, 'plant', plant);
        const wish = followPath(bot, world, dt);
        if (wish) turnToward(bot, Math.atan2(-wish.x, -wish.z), 0, dt, 4.2);
        return wish;
      }
      bot.planting = true;
      me.crouching = true;
      turnToward(bot, site === 'A' ? 2.8 : -2.6, -0.2, dt, 3);
      return null;
    }
    if (!bot.dest || bot.destName !== 'plant') setDest(bot, world, 'plant', plant);
    const wish = followPath(bot, world, dt);
    if (wish) turnToward(bot, Math.atan2(-wish.x, -wish.z), 0, dt, 4.2);
    return wish;
  }
  if (bomb.state === 'dropped') {
    // The nearest living Breacher fetches the charge.
    let nearest = null;
    let nearestDist = Infinity;
    for (const other of world.fighters) {
      if (other.team !== 'breach' || !other.alive) continue;
      const d = Math.hypot(other.pos.x - bomb.pos.x, other.pos.z - bomb.pos.z);
      if (d < nearestDist) { nearestDist = d; nearest = other; }
    }
    if (nearest === me) {
      if (!bot.dest || bot.destName !== 'charge') setDest(bot, world, 'charge', { x: bomb.pos.x, z: bomb.pos.z });
      const wish = followPath(bot, world, dt);
      if (wish) turnToward(bot, Math.atan2(-wish.x, -wish.z), 0, dt, 4.2);
      return wish;
    }
  }
  const laneWish = laneStep(bot, world, dt);
  if (laneWish) return laneWish;
  return pushSiteStep(bot, world, dt);
}

function stepWard(bot, world, dt) {
  const me = bot.fighter;
  const bomb = world.bomb;
  bot.defusing = false;
  if (bomb.state === 'planted') {
    const dist = Math.hypot(bomb.pos.x - me.pos.x, bomb.pos.z - me.pos.z);
    const amDefuser = bomb.defuser === me || (!bomb.defuser && bot.role === 'defuse');
    if (amDefuser) {
      if (dist > 1.7) {
        if (!bot.dest || bot.destName !== 'charge') setDest(bot, world, 'charge', { x: bomb.pos.x, z: bomb.pos.z });
        const wish = followPath(bot, world, dt);
        if (wish) turnToward(bot, Math.atan2(-wish.x, -wish.z), 0, dt, 4.6);
        return wish;
      }
      bot.defusing = true;
      me.crouching = true;
      turnToward(bot, me.yaw, -0.5, dt, 3);
      return null;
    }
    // Cover the defuser: get near the site and watch its mouths.
    const holds = SITE_HOLDS[bomb.site];
    const hold = holds[bot.index % holds.length];
    if (!bot.dest && bot.destName !== hold) setDest(bot, world, hold);
    const wish = followPath(bot, world, dt);
    if (wish) turnToward(bot, Math.atan2(-wish.x, -wish.z), 0, dt, 4.4);
    return wish;
  }
  // Rotation: the swing bot answers fresh contact on the other site.
  const info = world.teamInfo.ward;
  if (bot.role === 'rotate' && info.contactSite && world.now - info.contactAt < 6 && info.contactSite !== bot.postSite) {
    const holds = SITE_HOLDS[info.contactSite];
    const hold = holds[bot.index % holds.length];
    if (bot.destName !== hold) setDest(bot, world, hold);
    const wish = followPath(bot, world, dt);
    if (wish) turnToward(bot, Math.atan2(-wish.x, -wish.z), 0, dt, 4.4);
    return wish;
  }
  // Help rotation: when a teammate has just died on the other site, the
  // second holder answers it — one anchor stays behind, and a defender
  // sitting out the round on an empty site loses it for free. The help
  // lasts while the death is fresh; after that the post is home again.
  let postSite = bot.postSite;
  if (bot.role === 'hold' && bot.postIndex === 1 && info.deathSite &&
      info.deathSite !== bot.postSite && world.now - info.deathAt < 9) {
    postSite = info.deathSite;
  }
  // Hold the assigned post (or the helped site's), scanning its angle.
  const post = HOLD_POSTS[postSite][bot.postIndex];
  if (!post) return null;
  const [nodeName, watchYaw] = post;
  const node = world.map.byName.get(nodeName);
  if (Math.hypot(node.x - me.pos.x, node.z - me.pos.z) > 1.2) {
    if (bot.destName !== nodeName && (postSite !== bot.postSite || !bot.dest)) setDest(bot, world, nodeName);
    const wish = followPath(bot, world, dt);
    if (wish) turnToward(bot, Math.atan2(-wish.x, -wish.z), 0, dt, 4.4);
    return wish;
  }
  bot.holdYaw = watchYaw;
  const scan = watchYaw + Math.sin(world.now * 0.4 + bot.scanPhase) * 0.55;
  turnToward(bot, scan, 0.02, dt, 1.6);
  me.crouching = Math.sin(world.now * 0.23 + bot.scanPhase * 2) > 0.25;
  return null;
}

/** One fixed step of one bot: perceive, decide, move, shoot. */
export function stepBot(bot, world, dt) {
  const me = bot.fighter;
  bot.planting = false;
  bot.defusing = false;
  if (!me.alive) return;
  if (world.now >= bot.perceiveAt) {
    perceive(bot, world);
    bot.perceiveAt = world.now + 0.12;
  }
  let wish = null;
  let speedScale = 1;
  let wantCrouch = false;
  const engaged = bot.enemy && bot.enemy.alive && world.now - bot.lastSeenAt < 0.35;
  if (world.phase === 'buy' || world.phase === 'over') {
    // Frozen with everyone else; keep the gun up and the eyes forward.
  } else if (engaged || bot.nading) {
    const out = combat(bot, world, dt);
    wish = out.wish;
    speedScale = out.speedScale ?? 1;
    wantCrouch = out.crouch;
  } else if (me.team === 'breach') {
    wish = stepBreach(bot, world, dt);
  } else {
    wish = stepWard(bot, world, dt);
  }
  if (bot.planting || bot.defusing) wantCrouch = true;
  me.crouching = wantCrouch || bot.planting || bot.defusing;
  const jump = bot.jumpAt !== undefined && world.now - bot.jumpAt < 0.15;
  world.moveFighter(me, dt, wish ? wish.x : 0, wish ? wish.z : 0, { jump, speedScale });
  world.armory.stepFighter(me, dt);
}

/** Round-start shopping for a bot, through the same buy() the player uses. */
export function botBuy(bot, buy) {
  const me = bot.fighter;
  const rich = me.money >= 4200;
  if (!me.slots.primary) {
    if (me.money >= WEAPONS.lance.price && (rich || Math.random() < 0.75)) buy(me, 'lance');
    else if (me.money >= WEAPONS.hornet.price + ARMOR.vestPrice) buy(me, 'hornet');
    else if (me.money >= WEAPONS.boar.price + 300 && Math.random() < 0.3) buy(me, 'boar');
  }
  if (me.money >= ARMOR.helmPrice && Math.random() < 0.8) buy(me, 'helm');
  else if (me.money >= ARMOR.vestPrice) buy(me, 'vest');
  if (me.team === 'ward' && !me.kit && me.money >= KIT_PRICE + 400) buy(me, 'kit');
  if (me.team === 'breach') {
    if (bot.index % 2 === 0 && me.money >= GRENADES.flare.price + 300) buy(me, 'flare');
    if (bot.index % 2 === 1 && me.money >= GRENADES.veil.price + 300) buy(me, 'veil');
  } else if (me.money >= GRENADES.shard.price + 900) {
    buy(me, 'shard');
  }
  if (me.money >= 5000 && Math.random() < 0.4) buy(me, 'longbow');
}
