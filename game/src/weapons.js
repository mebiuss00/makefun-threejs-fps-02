// Guns and grenades. One firing path serves the player and every bot: a shot
// is a ray from the eye along the aim, spread by stance and motion, tested
// against the map's boxes and the other team's capsules, with the head worth
// more than the chest and the chest more than the legs. Recoil kicks the aim,
// bloom grows while you spray, and both fade when you stop — so the game
// pays the fighter who stops, crouches and taps.
import * as THREE from 'three';
import { WEAPONS, GRENADES } from './config.js';
import { rayVsBox, rayVsFighter, segmentBlocked } from './physics.js';
import { activeWeapon, damageFighter, eyePos } from './fighters.js';

const LOC_MULT = { head: 0, chest: 1, stomach: 1.25, legs: 0.75 }; // head uses the weapon's headMult
const dir = new THREE.Vector3();
const origin = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();
const normal = new THREE.Vector3();
const hitTest = { t: 0, part: 'chest' };

function buildViewmodel(key) {
  const metal = new THREE.MeshStandardMaterial({ color: '#24282e', roughness: 0.45, metalness: 0.55 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: '#17191d', roughness: 0.6, metalness: 0.4 });
  const grip = new THREE.MeshStandardMaterial({ color: '#3d332a', roughness: 0.9 });
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const group = new THREE.Group();
  function part(mat, w, h, d, x, y, z, rx = 0) {
    const mesh = new THREE.Mesh(unit, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    group.add(mesh);
    return mesh;
  }
  if (key === 'kestrel') {
    part(metal, 0.055, 0.09, 0.21, 0, 0, -0.08);
    part(darkMetal, 0.05, 0.12, 0.06, 0, -0.09, 0.03, 0.25);
  } else if (key === 'hornet') {
    part(metal, 0.06, 0.1, 0.34, 0, 0, -0.1);
    part(darkMetal, 0.045, 0.045, 0.2, 0, 0.01, -0.36);
    part(metal, 0.05, 0.16, 0.07, 0, -0.12, -0.05, 0.15);
    part(grip, 0.05, 0.11, 0.05, 0, -0.09, 0.1, 0.3);
  } else if (key === 'boar') {
    part(metal, 0.07, 0.09, 0.52, 0, 0, -0.2);
    part(grip, 0.075, 0.06, 0.16, 0, -0.045, -0.3);
    part(darkMetal, 0.06, 0.13, 0.06, 0, -0.1, 0.14, 0.2);
  } else if (key === 'lance') {
    part(metal, 0.065, 0.11, 0.46, 0, 0, -0.16);
    part(darkMetal, 0.04, 0.04, 0.3, 0, 0.02, -0.5);
    part(metal, 0.05, 0.05, 0.18, 0, 0.09, -0.18);
    part(metal, 0.055, 0.17, 0.08, 0, -0.13, -0.08, 0.12);
    part(grip, 0.055, 0.12, 0.055, 0, -0.1, 0.16, 0.3);
  } else if (key === 'longbow') {
    part(metal, 0.06, 0.1, 0.62, 0, 0, -0.26);
    part(darkMetal, 0.035, 0.035, 0.34, 0, 0.015, -0.68);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.17, 10), darkMetal);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.1, -0.2);
    group.add(scope);
    part(grip, 0.07, 0.09, 0.24, 0, -0.03, 0.22);
    part(metal, 0.05, 0.15, 0.07, 0, -0.12, -0.02, 0.1);
  }
  group.position.set(0.24, -0.21, -0.42);
  return group;
}

export function createArmory({ scene, camera, map, fighters, fx, audio, hooks }) {
  // The player's viewmodels, one per gun, hung off the camera.
  const viewmodels = {};
  for (const key of Object.keys(WEAPONS)) {
    viewmodels[key] = buildViewmodel(key);
    viewmodels[key].visible = false;
    camera.add(viewmodels[key]);
  }
  const grenadeProp = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 10, 8),
    new THREE.MeshStandardMaterial({ color: '#4a5548', roughness: 0.7 }),
  );
  grenadeProp.position.set(0.24, -0.2, -0.42);
  grenadeProp.visible = false;
  camera.add(grenadeProp);
  let vmKick = 0;
  let vmDraw = 1;

  // Live grenades in flight.
  const grenadeMesh = new THREE.SphereGeometry(0.06, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: '#3f4a3c', roughness: 0.65 });
  const flying = [];

  function aimDirection(fighter, out) {
    const cos = Math.cos(fighter.pitch);
    out.set(-Math.sin(fighter.yaw) * cos, Math.sin(fighter.pitch), -Math.cos(fighter.yaw) * cos);
    return out;
  }

  function rangeFade(def, dist) {
    if (dist <= def.range) return 1;
    const extra = Math.min(1, (dist - def.range) / def.range);
    return 1 - extra * (1 - def.falloff);
  }

  function fireOnce(fighter, def) {
    const state = activeWeapon(fighter);
    state.mag -= 1;
    fighter.cooldown = 60 / def.rpm;
    const scopedStill = def.zoom > 0 && fighter.scoped && fighter.speedNow < 0.4;
    let spread = def.spreadBase + fighter.bloom;
    if (!fighter.onGround) spread += def.spreadAir;
    else spread += def.spreadMove * Math.min(1, fighter.speedNow / 5.3);
    if (fighter.crouching) spread *= 0.72;
    if (scopedStill) spread *= 0.25;
    fighter.bloom = Math.min(0.02, fighter.bloom + 0.0035);
    eyePos(fighter, origin);
    muzzlePos.copy(origin).addScaledVector(aimDirection(fighter, dir), 0.55);
    muzzlePos.y -= 0.12;
    fx.muzzle(muzzlePos);
    audio.shot(state.key, fighter.isPlayer ? null : fighter.pos);
    hooks.noise(fighter.pos, 30, fighter.team);
    for (let pellet = 0; pellet < def.pellets; pellet += 1) {
      aimDirection(fighter, dir);
      dir.x += (Math.random() + Math.random() - 1) * spread;
      dir.y += (Math.random() + Math.random() - 1) * spread;
      dir.z += (Math.random() + Math.random() - 1) * spread;
      dir.normalize();
      // Nearest wall.
      let bestT = Infinity;
      let bestBox = null;
      for (const box of map.colliders) {
        const t = rayVsBox(origin, dir, box);
        if (t < bestT) { bestT = t; bestBox = box; }
      }
      // Nearest enemy body in front of that wall.
      let victim = null;
      for (const other of fighters) {
        if (other === fighter || !other.alive || other.team === fighter.team) continue;
        const hit = rayVsFighter(origin, dir, other, hitTest);
        if (hit && hit.t < bestT) {
          bestT = hit.t;
          victim = other;
          hitTest.part = hit.part;
        }
      }
      hitPoint.copy(origin).addScaledVector(dir, Math.min(bestT, 160));
      if (fighter.isPlayer || victim) fx.tracer(muzzlePos, hitPoint);
      if (victim) {
        const locMult = hitTest.part === 'head' ? def.headMult : LOC_MULT[hitTest.part];
        const raw = def.damage * locMult * rangeFade(def, bestT);
        const wasAlive = victim.alive;
        const { dealt, killed } = damageFighter(victim, raw, hitTest.part, def.pen);
        victim.lastAttacker = fighter;
        victim.lastHurtAt = hooks.now();
        // No flesh burst on the local player: the hit point sits on the
        // camera, so the particles would fill the screen. The damage
        // vignette and direction arc already carry that feedback.
        if (!victim.isPlayer) fx.impact(hitPoint, 'flesh');
        hooks.hit(fighter, victim, hitTest.part, dealt, killed);
        if (killed && wasAlive) hooks.kill(fighter, victim, state.key, hitTest.part === 'head');
      } else if (bestBox) {
        // The face the bullet entered, for the decal's orientation.
        normal.set(0, 1, 0);
        const cx = (bestBox.min.x + bestBox.max.x) / 2;
        const cy = (bestBox.min.y + bestBox.max.y) / 2;
        const cz = (bestBox.min.z + bestBox.max.z) / 2;
        const px = (hitPoint.x - cx) / Math.max(0.01, bestBox.max.x - cx);
        const py = (hitPoint.y - cy) / Math.max(0.01, bestBox.max.y - cy);
        const pz = (hitPoint.z - cz) / Math.max(0.01, bestBox.max.z - cz);
        if (Math.abs(px) > Math.abs(py) && Math.abs(px) > Math.abs(pz)) normal.set(Math.sign(px), 0, 0);
        else if (Math.abs(py) > Math.abs(pz)) normal.set(0, Math.sign(py), 0);
        else normal.set(0, 0, Math.sign(pz));
        fx.impact(hitPoint, 'wall');
        fx.decal(hitPoint, normal);
      }
    }
    // Recoil: the aim climbs and wanders; it settles when the trigger rests.
    fighter.pitch = Math.min(1.45, fighter.pitch + def.recoil * (0.9 + Math.random() * 0.25));
    fighter.yaw += (Math.random() - 0.5) * def.recoil * 0.7;
    if (fighter.isPlayer) vmKick = 1;
  }

  /** The trigger, once per fixed step. Returns true when a shot left the gun. */
  function tryFire(fighter, held, edge) {
    const state = activeWeapon(fighter);
    if (!state || !fighter.alive) return false;
    const def = WEAPONS[state.key];
    if (fighter.cooldown > 0 || fighter.reloadLeft > 0 || fighter.drawLeft > 0) return false;
    if (state.mag <= 0) {
      if (edge) audio.dryFire(fighter.isPlayer ? null : fighter.pos);
      if (edge && state.reserve > 0) startReload(fighter);
      return false;
    }
    if (def.auto ? !held : !edge) return false;
    fireOnce(fighter, def);
    return true;
  }

  function startReload(fighter) {
    const state = activeWeapon(fighter);
    if (!state) return;
    const def = WEAPONS[state.key];
    if (fighter.reloadLeft > 0 || state.mag >= def.mag || state.reserve <= 0) return;
    fighter.reloadLeft = def.reload;
    audio.reloadStart(fighter.isPlayer ? null : fighter.pos);
  }

  function setActive(fighter, next) {
    if (fighter.active === next) return;
    if ((next === 'primary' || next === 'sidearm') && !fighter.slots[next]) return;
    if (GRENADES[next] !== undefined && fighter.grenades[next] <= 0) return;
    fighter.active = next;
    fighter.reloadLeft = 0;
    fighter.scoped = false;
    fighter.drawLeft = next === 'primary' || next === 'sidearm' ? 0.3 : 0.22;
    audio.draw(fighter.isPlayer ? null : fighter.pos);
    if (fighter.isPlayer) vmDraw = 0;
  }

  function throwGrenade(fighter, now) {
    const kind = fighter.active;
    const def = GRENADES[kind];
    if (!def || fighter.grenades[kind] <= 0 || fighter.cooldown > 0) return false;
    fighter.grenades[kind] -= 1;
    fighter.cooldown = 0.55;
    eyePos(fighter, origin);
    aimDirection(fighter, dir);
    const mesh = new THREE.Mesh(grenadeMesh, grenadeMat);
    mesh.position.copy(origin).addScaledVector(dir, 0.3);
    scene.add(mesh);
    flying.push({
      kind, mesh, owner: fighter, fuse: def.fuse,
      pos: mesh.position,
      vel: new THREE.Vector3(dir.x * 15, dir.y * 15 + 2.2, dir.z * 15),
      born: now,
    });
    audio.throwWhoosh();
    if (fighter.grenades[kind] <= 0) {
      setActive(fighter, fighter.slots.primary ? 'primary' : 'sidearm');
    }
    return true;
  }

  function detonate(grenade, now) {
    const def = GRENADES[grenade.kind];
    const pos = grenade.pos;
    scene.remove(grenade.mesh);
    if (grenade.kind === 'shard') {
      fx.explosion(pos);
      audio.explosion(pos);
      hooks.noise(pos, 40, grenade.owner.team);
      hooks.blast(pos, def.radius);
      for (const other of fighters) {
        if (!other.alive) continue;
        const centre = hitPoint.set(other.pos.x, other.pos.y + 0.9, other.pos.z);
        const dist = centre.distanceTo(pos);
        if (dist > def.radius + 0.4) continue;
        origin.set(pos.x, pos.y + 0.25, pos.z);
        if (segmentBlocked(origin, centre, map.colliders)) continue;
        const raw = def.damage * Math.max(0.12, 1 - dist / (def.radius + 0.4));
        const { dealt, killed } = damageFighter(other, raw, 'chest', 0.35);
        other.lastAttacker = grenade.owner;
        other.lastHurtAt = now;
        hooks.hit(grenade.owner, other, 'chest', dealt, killed);
        if (killed) hooks.kill(grenade.owner, other, 'shard', false);
      }
    } else if (grenade.kind === 'flare') {
      fx.muzzle(pos);
      audio.flashCrack(pos);
      hooks.noise(pos, 24, grenade.owner.team);
      for (const other of fighters) {
        if (!other.alive) continue;
        eyePos(other, origin);
        const dist = origin.distanceTo(pos);
        if (dist > def.radius) continue;
        aimDirection(other, dir);
        hitPoint.subVectors(pos, origin).normalize();
        const facing = dir.dot(hitPoint); // 1 = staring at it, -1 = back turned
        origin.set(pos.x, pos.y + 0.2, pos.z);
        eyePos(other, normal);
        if (segmentBlocked(origin, normal, map.colliders)) continue;
        const closeness = 1 - dist / def.radius;
        const strength = facing > 0.55 ? 1 : facing > 0 ? 0.45 : 0.16;
        const duration = (0.5 + 3.1 * closeness) * strength;
        if (duration > 0.25) {
          other.flashUntil = Math.max(other.flashUntil, now + duration);
          other.flashStrength = Math.max(other.flashStrength, Math.min(1, strength + closeness * 0.4));
          if (other.isPlayer) hooks.playerFlashed(Math.min(1, strength + closeness * 0.4), duration);
        }
      }
    } else if (grenade.kind === 'veil') {
      audio.smokeHiss(pos);
      hitPoint.set(pos.x, 0, pos.z);
      fx.spawnSmoke(hitPoint, def.radius, def.lasts, now);
    }
  }

  const stepTmp = new THREE.Vector3();

  function stepGrenades(dt, now) {
    for (let i = flying.length - 1; i >= 0; i -= 1) {
      const grenade = flying[i];
      grenade.fuse -= dt;
      grenade.vel.y -= 13.5 * dt;
      stepTmp.copy(grenade.vel).multiplyScalar(dt);
      // Move axis by axis; a blocked axis bounces with a tick.
      for (const axis of ['x', 'y', 'z']) {
        const next = grenade.pos[axis] + stepTmp[axis];
        const tx = axis === 'x' ? next : grenade.pos.x;
        const ty = axis === 'y' ? next : grenade.pos.y;
        const tz = axis === 'z' ? next : grenade.pos.z;
        let blocked = ty < 0.06;
        if (!blocked) {
          for (const box of map.colliders) {
            if (tx > box.min.x - 0.05 && tx < box.max.x + 0.05 &&
                ty > box.min.y - 0.05 && ty < box.max.y + 0.05 &&
                tz > box.min.z - 0.05 && tz < box.max.z + 0.05) { blocked = true; break; }
          }
        }
        if (blocked) {
          if (Math.abs(grenade.vel[axis]) > 2.2) audio.bounce(grenade.pos);
          grenade.vel[axis] *= -0.42;
          grenade.vel.x *= 0.82;
          grenade.vel.z *= 0.82;
          if (axis === 'y' && Math.abs(grenade.vel.y) < 1) grenade.vel.y = 0;
        } else {
          grenade.pos[axis] = next;
        }
      }
      if (grenade.pos.y < 0.06) grenade.pos.y = 0.06;
      if (grenade.fuse <= 0) {
        flying.splice(i, 1);
        detonate(grenade, now);
      }
    }
  }

  /** Per-fighter timers: cooldown, reload completion, bloom recovery. */
  function stepFighter(fighter, dt) {
    fighter.cooldown = Math.max(0, fighter.cooldown - dt);
    fighter.drawLeft = Math.max(0, fighter.drawLeft - dt);
    const held = activeWeapon(fighter);
    fighter.bloom = Math.max(0, fighter.bloom - dt * 0.007 * (held ? WEAPONS[held.key].recovery : 6));
    if (fighter.reloadLeft > 0) {
      fighter.reloadLeft = Math.max(0, fighter.reloadLeft - dt);
      if (fighter.reloadLeft === 0) {
        const state = activeWeapon(fighter);
        if (state) {
          const def = WEAPONS[state.key];
          const take = Math.min(def.mag - state.mag, state.reserve);
          state.mag += take;
          state.reserve -= take;
          audio.reloadEnd(fighter.isPlayer ? null : fighter.pos);
        }
      }
    }
  }

  /** The player's viewmodel: which gun shows, and its kick, bob and draw. */
  function updateViewmodel(player, dt, now) {
    const state = activeWeapon(player);
    for (const [key, model] of Object.entries(viewmodels)) {
      model.visible = state !== null && state.key === key && !player.scoped;
    }
    grenadeProp.visible = state === null && player.alive;
    if (!state) return;
    const model = viewmodels[state.key];
    vmKick = Math.max(0, vmKick - dt * 9);
    vmDraw = Math.min(1, vmDraw + dt * 3.4);
    const bob = Math.min(1, player.speedNow / 5) * 0.012;
    const t = now * (player.speedNow > 3 ? 11 : 8);
    model.position.set(
      0.24 + Math.sin(t) * bob,
      -0.21 + Math.abs(Math.cos(t)) * bob - (1 - vmDraw) * 0.3 + (player.reloadLeft > 0 ? -0.1 : 0),
      -0.42 + vmKick * 0.05,
    );
    model.rotation.x = vmKick * 0.1 + (player.reloadLeft > 0 ? -0.6 * Math.sin(Math.min(1, player.reloadLeft) * Math.PI) : 0);
  }

  return { tryFire, startReload, setActive, throwGrenade, stepGrenades, stepFighter, updateViewmodel, aimDirection };
}
