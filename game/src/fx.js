// Transient visuals, all pooled: tracers, impact sparks and dust, bullet-hole
// decals, explosion flashes and the smoke clouds that also block sight (the AI
// and the bullet code read the same cloud list, so what you see is what the
// bots cannot see through). Nothing here is created after startup.
import * as THREE from 'three';

const TRACER_COUNT = 40;
const PARTICLE_COUNT = 700;
const DECAL_COUNT = 70;

export function createFx(scene) {
  // Tracers: thin stretched boxes that live for a few frames.
  const tracerGeo = new THREE.BoxGeometry(0.014, 0.014, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.85 });
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerCursor = 0;

  // Particles: one Points cloud, CPU-simulated in flat arrays.
  const pPos = new Float32Array(PARTICLE_COUNT * 3);
  const pCol = new Float32Array(PARTICLE_COUNT * 3);
  const pVel = new Float32Array(PARTICLE_COUNT * 3);
  const pLife = new Float32Array(PARTICLE_COUNT);
  const pMaxLife = new Float32Array(PARTICLE_COUNT);
  const pGrav = new Float32Array(PARTICLE_COUNT);
  let particleCursor = 0;
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  particleGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const particleMat = new THREE.PointsMaterial({ size: 0.075, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const points = new THREE.Points(particleGeo, particleMat);
  points.frustumCulled = false;
  scene.add(points);
  const colour = new THREE.Color();

  function spawnParticle(x, y, z, vx, vy, vz, life, hex, gravity) {
    const i = particleCursor;
    particleCursor = (particleCursor + 1) % PARTICLE_COUNT;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
    colour.set(hex);
    pCol[i * 3] = colour.r; pCol[i * 3 + 1] = colour.g; pCol[i * 3 + 2] = colour.b;
    pLife[i] = life;
    pMaxLife[i] = life;
    pGrav[i] = gravity;
  }

  function burst(point, count, hex, speed, life, gravity = -3) {
    for (let n = 0; n < count; n += 1) {
      const theta = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.1;
      const flat = Math.sqrt(1 - up * up) * speed * (0.3 + Math.random() * 0.7);
      spawnParticle(
        point.x, point.y, point.z,
        Math.cos(theta) * flat, up * speed, Math.sin(theta) * flat,
        life * (0.5 + Math.random() * 0.8), hex, gravity,
      );
    }
  }

  // Decals: dark discs stuck where bullets landed, recycled oldest-first.
  const decalGeo = new THREE.CircleGeometry(0.055, 10);
  const decalMat = new THREE.MeshBasicMaterial({ color: '#101114', transparent: true, opacity: 0.75, depthWrite: false });
  const decals = [];
  for (let i = 0; i < DECAL_COUNT; i += 1) {
    const mesh = new THREE.Mesh(decalGeo, decalMat);
    mesh.visible = false;
    scene.add(mesh);
    decals.push(mesh);
  }
  let decalCursor = 0;
  const zAxis = new THREE.Vector3(0, 0, 1);

  // Two reusable flash lights (muzzle + explosion) and a shockwave ring.
  const flashLight = new THREE.PointLight(new THREE.Color('#ffb066'), 0, 15, 1.6);
  scene.add(flashLight);
  let flashLife = 0;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 40),
    new THREE.MeshBasicMaterial({ color: '#ffc98a', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  let ringLife = 0;

  // Smoke clouds: a cluster of soft spheres each. The list is shared with the
  // sight code: { pos, radius, until } in seconds on the game clock.
  const smokes = [];
  const smokeMat = new THREE.MeshStandardMaterial({ color: '#b9bcc0', roughness: 1, transparent: true, opacity: 0.34, depthWrite: false });
  const smokeGeo = new THREE.SphereGeometry(1, 12, 10);

  function spawnSmoke(pos, radius, lasts, now) {
    const group = new THREE.Group();
    const mat = smokeMat.clone(); // one material a cloud, so clouds fade apart
    const puffs = [];
    for (let i = 0; i < 7; i += 1) {
      const puff = new THREE.Mesh(smokeGeo, mat);
      const a = (i / 7) * Math.PI * 2;
      puff.position.set(Math.cos(a) * radius * 0.45, 0.9 + (i % 3) * 0.55, Math.sin(a) * radius * 0.45);
      puff.scale.setScalar(radius * (0.55 + (i % 3) * 0.16));
      group.add(puff);
      puffs.push(puff);
    }
    group.position.copy(pos);
    scene.add(group);
    const cloud = { pos: pos.clone(), radius, until: now + lasts, group, born: now, mat };
    smokes.push(cloud);
    return cloud;
  }

  const mid = new THREE.Vector3();

  return {
    smokes,
    tracer(from, to) {
      const slot = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % TRACER_COUNT;
      mid.addVectors(from, to).multiplyScalar(0.5);
      slot.mesh.position.copy(mid);
      slot.mesh.lookAt(to);
      slot.mesh.scale.set(1, 1, from.distanceTo(to));
      slot.mesh.material.opacity = 0.85;
      slot.mesh.visible = true;
      slot.life = 0.055;
    },
    impact(point, kind) {
      if (kind === 'flesh') {
        burst(point, 7, '#c23a1e', 1.6, 0.4, -4);
      } else {
        burst(point, 5, '#ffc46b', 2.2, 0.28, -5);
        burst(point, 4, '#8d8d86', 0.9, 0.55, -1.2);
      }
    },
    decal(point, normal) {
      const mesh = decals[decalCursor];
      decalCursor = (decalCursor + 1) % DECAL_COUNT;
      mesh.position.copy(point).addScaledVector(normal, 0.012);
      mesh.quaternion.setFromUnitVectors(zAxis, normal);
      mesh.visible = true;
    },
    muzzle(point) {
      flashLight.position.copy(point);
      flashLight.intensity = 26;
      flashLife = 0.05;
    },
    explosion(point) {
      flashLight.position.copy(point);
      flashLight.intensity = 160;
      flashLife = 0.22;
      burst(point, 46, '#ff9a3c', 7, 0.8, -2);
      burst(point, 30, '#5a564e', 3.4, 1.3, 0.7);
      ring.position.set(point.x, 0.25, point.z);
      ring.visible = true;
      ringLife = 0.45;
    },
    spawnSmoke,
    update(dt, now) {
      for (const slot of tracers) {
        if (slot.life <= 0) continue;
        slot.life -= dt;
        slot.mesh.material.opacity = Math.max(0, slot.life / 0.055) * 0.85;
        if (slot.life <= 0) slot.mesh.visible = false;
      }
      for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        if (pLife[i] <= 0) { pPos[i * 3 + 1] = -50; continue; }
        pLife[i] -= dt;
        pVel[i * 3 + 1] += pGrav[i] * dt;
        pPos[i * 3] += pVel[i * 3] * dt;
        pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
        pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
        if (pPos[i * 3 + 1] < 0.02) pPos[i * 3 + 1] = 0.02;
      }
      particleGeo.attributes.position.needsUpdate = true;
      particleGeo.attributes.color.needsUpdate = true;
      if (flashLife > 0) {
        flashLife -= dt;
        if (flashLife <= 0) flashLight.intensity = 0;
      }
      if (ringLife > 0) {
        ringLife -= dt;
        const t = 1 - ringLife / 0.45;
        ring.scale.setScalar(1 + t * 9);
        ring.material.opacity = 0.5 * (1 - t);
        if (ringLife <= 0) ring.visible = false;
      }
      for (let i = smokes.length - 1; i >= 0; i -= 1) {
        const cloud = smokes[i];
        const age = now - cloud.born;
        const fade = Math.min(1, age / 0.9) * (cloud.until - now < 1.6 ? Math.max(0, (cloud.until - now) / 1.6) : 1);
        cloud.group.scale.setScalar(0.6 + 0.4 * Math.min(1, age / 1.4));
        cloud.mat.opacity = 0.34 * fade;
        if (now >= cloud.until) {
          scene.remove(cloud.group);
          cloud.mat.dispose();
          smokes.splice(i, 1);
        }
      }
    },
  };
}
