// Geometry the whole game shares: box colliders for movement, and the ray tests
// that decide what a bullet hits and what a bot can see. A fighter is tested as a
// capsule for the body plus a sphere for the head, so a headshot is a geometric
// fact, not a mesh name. All functions write into caller-owned temporaries where
// they can: nothing here allocates inside a frame loop.
import * as THREE from 'three';

const probe = new THREE.Box3();

/** The first collider a body of this half-width and height would touch at (x, y, z). */
export function overlapsAt(colliders, x, y, z, half, height, lift = 0) {
  probe.min.set(x - half, y + lift, z - half);
  probe.max.set(x + half, y + height - lift, z + half);
  for (const box of colliders) if (probe.intersectsBox(box)) return box;
  return null;
}

/**
 * Slide one horizontal axis. A ledge no higher than 0.55 m is climbed, not a
 * wall: when the straight move is blocked, retry raised, and take the raise
 * only when something solid is under the raised feet to land on.
 */
function slideAxis(colliders, pos, vel, half, height, axis, dt) {
  const delta = vel[axis] * dt;
  if (delta === 0) return;
  const nx = axis === 'x' ? pos.x + delta : pos.x;
  const nz = axis === 'z' ? pos.z + delta : pos.z;
  if (!overlapsAt(colliders, nx, pos.y, nz, half, height, 0.04)) {
    pos.x = nx; pos.z = nz;
    return;
  }
  for (const lift of [0.28, 0.55]) {
    const raised = pos.y + lift;
    const free = !overlapsAt(colliders, nx, raised, nz, half, height, 0.04);
    const supported = overlapsAt(colliders, nx, raised - 0.62, nz, half, 0.6, 0);
    if (free && supported) {
      pos.x = nx; pos.z = nz; pos.y = raised;
      return;
    }
  }
  vel[axis] = 0;
}

/**
 * Move a body one fixed step: integrate velocity axis by axis so walls stop one
 * axis and the body slides along the other, then settle gravity against floors
 * and ceilings. Mutates pos and vel; returns true when the body stands on ground.
 */
export function moveBody(colliders, pos, vel, half, height, dt) {
  slideAxis(colliders, pos, vel, half, height, 'x', dt);
  slideAxis(colliders, pos, vel, half, height, 'z', dt);
  pos.y += vel.y * dt;
  let onGround = false;
  const hit = overlapsAt(colliders, pos.x, pos.y, pos.z, half, height, 0);
  if (hit) {
    if (vel.y <= 0) {
      pos.y = hit.max.y;
      onGround = true;
    } else {
      pos.y = hit.min.y - height;
    }
    vel.y = 0;
  }
  if (pos.y < 0) {
    pos.y = 0;
    vel.y = 0;
    onGround = true;
  }
  return onGround;
}

/** Distance along the ray to a box, or Infinity when it misses or starts inside past the face. */
export function rayVsBox(origin, dir, box) {
  let tMin = 0;
  let tMax = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < box.min[axis] || o > box.max[axis]) return Infinity;
    } else {
      let t1 = (box.min[axis] - o) / d;
      let t2 = (box.max[axis] - o) / d;
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return Infinity;
    }
  }
  return tMin;
}

const toCenter = new THREE.Vector3();

/** Distance along the ray to a sphere, or Infinity. */
export function rayVsSphere(origin, dir, center, radius) {
  toCenter.subVectors(center, origin);
  const tca = toCenter.dot(dir);
  if (tca < 0) return Infinity;
  const d2 = toCenter.lengthSq() - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

const segA = new THREE.Vector3();
const segB = new THREE.Vector3();
const rayPoint = new THREE.Vector3();
const segPoint = new THREE.Vector3();

/**
 * Distance along the ray to a fighter's body: the head sphere first, then the
 * capsule (a vertical segment with radius). Returns { t, part } in the object
 * passed as `out`, or null. Crouching lowers both, exactly as the model shows.
 */
export function rayVsFighter(origin, dir, fighter, out) {
  const pos = fighter.pos;
  const height = fighter.crouching ? 1.24 : 1.78;
  segA.set(pos.x, pos.y + height - 0.16, pos.z);
  const headT = rayVsSphere(origin, dir, segA, 0.21);
  segA.set(pos.x, pos.y + 0.34, pos.z);
  segB.set(pos.x, pos.y + height - 0.3, pos.z);
  // Closest approach between the ray (origin + t * dir, t >= 0) and the body
  // segment (segA + s * ab, 0 <= s <= 1): solve the 2x2 least-squares system,
  // then clamp s into the segment and t onto the ray.
  const abx = segB.x - segA.x, aby = segB.y - segA.y, abz = segB.z - segA.z;
  const rx = origin.x - segA.x, ry = origin.y - segA.y, rz = origin.z - segA.z;
  const b = dir.x * abx + dir.y * aby + dir.z * abz;
  const c = abx * abx + aby * aby + abz * abz;
  const d = dir.x * rx + dir.y * ry + dir.z * rz;
  const e = abx * rx + aby * ry + abz * rz;
  const denom = c - b * b; // a = dir . dir = 1
  let s = denom > 1e-9 ? Math.max(0, Math.min(1, (e - b * d) / denom)) : 0;
  let t = b * s - d;
  if (t < 0) {
    t = 0;
    s = c > 1e-9 ? Math.max(0, Math.min(1, e / c)) : 0;
  }
  rayPoint.copy(dir).multiplyScalar(t).add(origin);
  segPoint.set(segA.x + abx * s, segA.y + aby * s, segA.z + abz * s);
  const dist = rayPoint.distanceTo(segPoint);
  const bodyT = dist <= 0.35 ? t : Infinity;
  if (headT === Infinity && bodyT === Infinity) return null;
  if (headT <= bodyT) { out.t = headT; out.part = 'head'; return out; }
  out.t = bodyT;
  // The capsule spans groin to neck; split it into chest / stomach / legs by height.
  const hitY = rayPoint.y - pos.y;
  out.part = hitY > height * 0.62 ? 'chest' : hitY > height * 0.38 ? 'stomach' : 'legs';
  return out;
}

const segDir = new THREE.Vector3();

/** True when the straight line from a to b passes through any collider. */
export function segmentBlocked(a, b, colliders) {
  segDir.subVectors(b, a);
  const dist = segDir.length();
  if (dist < 1e-6) return false;
  segDir.multiplyScalar(1 / dist);
  for (const box of colliders) {
    const t = rayVsBox(a, segDir, box);
    if (t < dist - 0.05) return true;
  }
  return false;
}

/** True when the line from a to b passes through a smoke cloud (a sight blocker). */
export function segmentThroughSmoke(a, b, smokes) {
  for (const cloud of smokes) {
    segPoint.subVectors(cloud.pos, a);
    segDir.subVectors(b, a);
    const len = segDir.length();
    if (len < 1e-6) continue;
    segDir.multiplyScalar(1 / len);
    const along = Math.max(0, Math.min(len, segPoint.dot(segDir)));
    rayPoint.copy(segDir).multiplyScalar(along).add(a);
    if (rayPoint.distanceTo(cloud.pos) < cloud.radius) return true;
  }
  return false;
}
