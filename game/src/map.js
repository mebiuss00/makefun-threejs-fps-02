// The Foundry: an ore yard at dusk, built from data. Every solid thing is one
// row of BOXES — centre x/z, width, depth, height, material — and the same row
// makes both the mesh the player sees and the collider the bullets and bodies
// stop on, so the picture and the physics can never drift apart. Sites,
// spawns and the waypoint graph the bots walk are data too.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { segmentBlocked } from './physics.js';

// [x, z, width, depth, height, material] — y is height / 2 unless a row of
// RAISED gives a base height (lintels and the crane beam).
const BOXES = [
  // Perimeter.
  [0, -24.5, 70, 1, 5, 'dark'], [0, 24.5, 70, 1, 5, 'dark'],
  [-34.5, 0, 1, 50, 5, 'dark'], [34.5, 0, 1, 50, 5, 'dark'],
  // Breach spawn yard (south-west) dressing.
  [-24, 10, 2, 2, 1.1, 'crate'], [-18, 18, 2.4, 1.2, 1.1, 'crate'], [-27, 20, 1.2, 1.2, 2.2, 'steel'],
  // West yard and its container.
  [-22, -2, 7, 2.6, 2.6, 'rust'], [-14, 2, 1.6, 1.6, 1.6, 'crate'],
  [-15.5, -6, 2, 1.2, 1.1, 'crate'], [-10.5, -4, 1, 8, 1.15, 'concrete'],
  // A long: the north corridor's south wall, with the long door gap at x -4..-1.
  [-18.5, -16, 29, 1, 4.2, 'concrete'], [6.5, -16, 15, 1, 4.2, 'concrete'],
  [-8, -20, 2.4, 1.2, 1.1, 'crate'], [-20, -19.5, 1.2, 1.2, 3.4, 'steel'],
  // Foundry hall: west wall (door gap z -12..-9), south wall (door gap x 4..7),
  // east wall (wide opening z -13..-8 toward site A), pillars and the smelter.
  [-2, -14, 1, 4, 4.2, 'concrete'], [-2, -7.5, 1, 3, 4.2, 'concrete'],
  [1, -6, 6, 1, 4.2, 'concrete'], [10.5, -6, 7, 1, 4.2, 'concrete'],
  [14, -14.5, 1, 3, 4.2, 'concrete'], [14, -7, 1, 2, 4.2, 'concrete'],
  [4, -11, 1.4, 1.4, 4.2, 'steel'], [10, -11, 1.4, 1.4, 4.2, 'steel'],
  [6, -13.5, 3.4, 2.2, 2.6, 'rust'],
  // Site A (Kiln): the furnace block, stacks and a low wall across the middle.
  [24, -16, 6, 4.5, 4.6, 'rust'], [19, -10, 2, 2, 1.1, 'crate'],
  [29, -19, 2.2, 1.2, 1.1, 'crate'], [30, -9.5, 1.6, 1.6, 1.6, 'steel'],
  [24, -11.5, 5, 0.8, 1.15, 'concrete'],
  // Mid yard: the central smelter and crate cover; the mid door wall at x 14
  // (gap z -2..1) is the Wardens' rotation door.
  [3, 1, 5, 3.6, 3.2, 'steel'], [-4, -3, 1.8, 1.8, 1.8, 'crate'],
  [9, 5, 2, 1.2, 1.1, 'crate'], [-5, 6, 2.4, 1.2, 1.1, 'crate'],
  [11, -4, 1.6, 1.6, 1.6, 'crate'],
  [14, -4, 1, 4, 4.2, 'concrete'], [14, 4.5, 1, 7, 4.2, 'concrete'],
  // The east corridor between the sites: the Wardens' highway.
  [20, 0, 2, 2, 2.2, 'steel'], [26, 4, 1.8, 1.2, 1.1, 'crate'], [26, -4, 1.8, 1.2, 1.1, 'crate'],
  // Walls between the corridor and each site (door gaps x 24..28 and x 22..26).
  [19, -7, 10, 1, 4.2, 'concrete'], [30.5, -7, 5, 1, 4.2, 'concrete'],
  [18, 7, 8, 1, 4.2, 'concrete'], [29.5, 7, 7, 1, 4.2, 'concrete'],
  // B tunnels (the Cut): north wall with a door at x -20..-17, east wall with
  // the exit gap at z 17..20, pillars inside.
  [-26.5, 14, 13, 1, 3.6, 'dark'], [-11.5, 14, 11, 1, 3.6, 'dark'],
  [-6, 15.5, 1, 3, 3.6, 'dark'], [-6, 21, 1, 2, 3.6, 'dark'],
  [-24, 18, 1.2, 1.2, 3.6, 'steel'], [-13, 18, 1.2, 1.2, 3.6, 'steel'],
  [-29, 20, 1.8, 1.2, 1.1, 'crate'],
  // B short yard: a teal container, crates, the run up to site B.
  [4, 15, 7, 2.6, 2.6, 'teal'], [10, 10, 1.6, 1.6, 1.6, 'crate'], [-3, 12, 2, 1.2, 1.1, 'crate'],
  // Site B (Vault): the vault block, a rust container, stacks, a low wall.
  [26, 15, 5, 6, 3.8, 'steel'], [19, 20, 6, 2.6, 2.6, 'rust'],
  [20, 9.5, 2, 2, 1.1, 'crate'], [30, 10, 1.8, 1.8, 1.8, 'crate'],
  [24, 12, 4, 0.8, 1.15, 'concrete'],
];
// [x, z, width, depth, height, material, baseY] — boxes that start above the floor.
const RAISED = [
  [3, 1, 10, 0.8, 0.8, 'dark', 8.6], // the crane beam over mid yard
  [-30, -19.5, 8, 0.7, 0.7, 'dark', 6.4], // a pipe run over A long
  [24, -15, 9, 0.7, 0.7, 'dark', 6.4], // a pipe run over site A
];
// Round drums: [x, z] — drawn as cylinders, collided as 0.9 m boxes.
const DRUMS = [[-31, -12], [-12, -13], [16, -20], [12, 20], [-8, -8], [32, 20]];

export const SITES = {
  A: { name: 'KILN', minX: 15, maxX: 33, minZ: -23, maxZ: -7, plant: { x: 22, z: -13 } },
  B: { name: 'VAULT', minX: 15, maxX: 33, minZ: 7, maxZ: 23, plant: { x: 21, z: 15 } },
};

export const SPAWNS = {
  breach: [
    { x: -28, z: 10 }, { x: -26, z: 12 }, { x: -30, z: 8 }, { x: -24, z: 9 }, { x: -27, z: 5 },
  ],
  ward: [
    { x: 25, z: 0 }, { x: 28, z: 3 }, { x: 28, z: -3 }, { x: 22, z: 1 }, { x: 30, z: 0 },
  ],
};
export const BUY_ZONE = { x: -27, z: 9, radius: 10 };

// Waypoints the bots walk: [name, x, z]. Edges are earned, not listed — two
// nodes link when they are close and a low line between them is clear, so the
// graph can never promise a path through a crate.
const NODE_ROWS = [
  ['spawn', -27, 9], ['west', -20, 0], ['upperWest', -16, -13], ['westDoor', -9, -2],
  ['longW', -26, -19.5], ['longM', -14, -19.5], ['longE', -4, -19.5],
  ['hallW', -4, -10.5], ['hall', 2, -11], ['hallS', 8, -8.5], ['hallA', 12, -10.5],
  ['midW', -6, 1], ['mid', 0, 5], ['midE', 6, -2], ['midDoor', 13, -0.5], ['midS', 8, 6],
  ['corrW', 17, -0.5], ['corr', 22, 0], ['corrE', 29, 0], ['aDoor', 26, -8.5], ['bDoor', 24, 8.5],
  ['aW', 18, -19], ['aBack', 24, -20.5], ['aE', 30, -14], ['aS', 20, -9.5], ['aPlant', 22, -13],
  ['bW', 18, 12], ['bS', 24, 19.5], ['bE', 30, 17], ['bPlant', 21, 15], ['bN', 31, 9.5],
  ['shortW', -4, 10], ['short', 0, 11], ['shortE', 8, 18], ['shortN', 13, 12],
  ['tunDoorOut', -18.5, 11.5], ['tunDoor', -18.5, 17], ['tunW', -29, 18],
  ['tunM', -21, 19], ['tunE', -10, 18], ['tunExit', -4, 18.5],
  // Threading nodes: the lane rows above sit on straight lines that the
  // map's own cover cuts (a pillar on A-long, the mid-door jamb, the
  // vault block on B). These extra points sit in the actual gaps beside
  // that cover, so the graph the edges are earned from stays one piece.
  ['doorLow', -10.4, 2.4], ['westUp', -17.5, 0.3],
  ['longS1', -20, -16.8], ['longS2', -8, -17.6], ['longS3', 4, -17.5], ['aLong', 10, -18.5],
  ['bVaultE', 30, 15], ['bNE', 32, 12.5], ['tunW2', -25, 15.5],
];
// Defender posts: node names to hold, per site, with the yaw (radians) to watch.
export const HOLD_POSTS = {
  A: [['aS', 2.6], ['aE', 3.1], ['aBack', 0.4]],
  B: [['bN', -2.2], ['bPlant', 2.9], ['bW', 1.8]],
  mid: [['corrW', 3.14], ['corr', -1.4]],
};

function canvasTexture(draw, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function buildMaterials() {
  const concreteTex = canvasTexture((g, s) => {
    g.fillStyle = PALETTE.concrete; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i += 1) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)';
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  });
  concreteTex.repeat.set(2, 2);
  const floorTex = canvasTexture((g, s) => {
    g.fillStyle = PALETTE.asphalt; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 5200; i += 1) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.04)';
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
    g.strokeRect(1, 1, s - 2, s - 2);
    g.fillStyle = 'rgba(232,163,61,0.16)';
    g.fillRect(0, s / 2 - 3, s, 6);
  }, 512);
  floorTex.repeat.set(9, 7);
  const ribbed = (colour) => canvasTexture((g, s) => {
    g.fillStyle = colour; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 32) {
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, 0, 7, s);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 7, 0, 4, s);
    }
  });
  const std = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.05, ...opts });
  return {
    concrete: std({ map: concreteTex, color: '#bdbcb4' }),
    dark: std({ color: PALETTE.concreteDark }),
    steel: std({ color: PALETTE.steel, roughness: 0.55, metalness: 0.45 }),
    rust: std({ map: ribbed(PALETTE.rust), color: '#e8e2d6' }),
    teal: std({ map: ribbed(PALETTE.teal), color: '#e8e2d6' }),
    crate: std({ color: PALETTE.crate, roughness: 0.95 }),
    floor: std({ map: floorTex, color: '#cfcfc8' }),
  };
}

function siteFloorTexture(letter, colour) {
  return canvasTexture((g, s) => {
    g.fillStyle = '#3f4045'; g.fillRect(0, 0, s, s);
    g.strokeStyle = colour; g.lineWidth = 10; g.strokeRect(8, 8, s - 16, s - 16);
    g.fillStyle = colour;
    g.font = `700 ${s * 0.52}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, s / 2, s / 2 + s * 0.03);
  });
}

export function createMap(scene) {
  const materials = buildMaterials();
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  function addBox(x, z, w, d, h, mat, baseY = 0) {
    const mesh = new THREE.Mesh(unitBox, materials[mat]);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, baseY + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const box = new THREE.Box3(
      new THREE.Vector3(x - w / 2, baseY, z - d / 2),
      new THREE.Vector3(x + w / 2, baseY + h, z + d / 2),
    );
    colliders.push(box);
    shootables.push(mesh);
    return mesh;
  }
  for (const [x, z, w, d, h, mat] of BOXES) addBox(x, z, w, d, h, mat);
  for (const [x, z, w, d, h, mat, baseY] of RAISED) addBox(x, z, w, d, h, mat, baseY);

  const drumGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.95, 14);
  for (const [x, z] of DRUMS) {
    const drum = new THREE.Mesh(drumGeo, materials.steel);
    drum.position.set(x, 0.475, z);
    drum.castShadow = true;
    drum.receiveShadow = true;
    group.add(drum);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - 0.45, 0, z - 0.45),
      new THREE.Vector3(x + 0.45, 0.95, z + 0.45),
    ));
    shootables.push(drum);
  }

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 50), materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Painted site floors: the letter and the border are the objective, readable
  // from anywhere on the site.
  for (const [key, site] of Object.entries(SITES)) {
    const w = site.maxX - site.minX;
    const d = site.maxZ - site.minZ;
    const paint = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({
        map: siteFloorTexture(key, key === 'A' ? PALETTE.gold : PALETTE.teal),
        roughness: 0.95, transparent: true, opacity: 0.9,
      }),
    );
    paint.rotation.x = -Math.PI / 2;
    paint.position.set((site.minX + site.maxX) / 2, 0.02, (site.minZ + site.maxZ) / 2);
    paint.receiveShadow = true;
    group.add(paint);
    site.center = { x: (site.minX + site.maxX) / 2, z: (site.minZ + site.maxZ) / 2 };
  }

  // Distant silhouettes and lamp posts: depth beyond the walls, warmth inside.
  const silhouette = new THREE.MeshStandardMaterial({ color: '#171b20', roughness: 1 });
  const silhouettes = [[-46, -18, 10, 16, 8], [44, 14, 12, 11, 9], [-20, -38, 16, 13, 7], [18, 36, 14, 18, 8], [48, -20, 9, 12, 10]];
  for (const [x, z, w, h, d] of silhouettes) {
    const m = new THREE.Mesh(unitBox, silhouette);
    m.scale.set(w, h, d);
    m.position.set(x, h / 2, z);
    group.add(m);
  }
  const lampGlow = new THREE.MeshBasicMaterial({ color: PALETTE.gold });
  const lampPole = new THREE.MeshStandardMaterial({ color: PALETTE.steelDark, roughness: 0.7, metalness: 0.4 });
  for (const [x, z] of [[22, -13], [21, 15], [3, 1], [-20, 0]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.6, 8), lampPole);
    pole.position.set(x + 3.4, 2.3, z + 3.4);
    group.add(pole);
    const head = new THREE.Mesh(unitBox, lampGlow);
    head.scale.set(0.5, 0.16, 0.5);
    head.position.set(x + 3.4, 4.65, z + 3.4);
    group.add(head);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.gold), 60, 17, 1.8);
    light.position.set(x + 3.4, 4.4, z + 3.4);
    scene.add(light);
  }

  // Lights: a low warm sun, a cool sky/ground gradient, one cool fill.
  const hemi = new THREE.HemisphereLight(new THREE.Color('#8fa3b8'), new THREE.Color('#2e2a24'), 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 2.0);
  sun.position.set(-26, 30, -14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -42; sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -34;
  sun.shadow.camera.far = 95;
  sun.shadow.bias = -0.0007;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7d90a8'), 0.5);
  fill.position.set(20, 18, 26);
  scene.add(fill);

  // The waypoint graph, edges earned by distance and a low clear line.
  const nodes = NODE_ROWS.map(([name, x, z], index) => ({ index, name, x, z, edges: [] }));
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const eyeA = new THREE.Vector3();
  const eyeB = new THREE.Vector3();
  for (const a of nodes) {
    for (const b of nodes) {
      if (b.index <= a.index) continue;
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist > 13.5) continue;
      eyeA.set(a.x, 0.55, a.z);
      eyeB.set(b.x, 0.55, b.z);
      if (!segmentBlocked(eyeA, eyeB, colliders)) {
        a.edges.push(b.index);
        b.edges.push(a.index);
      }
    }
  }

  function nearestNode(x, z) {
    let best = nodes[0];
    let bestDist = Infinity;
    for (const node of nodes) {
      const dist = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (dist < bestDist) { bestDist = dist; best = node; }
    }
    return best;
  }

  /** A* over the waypoint graph; returns node indices from start to goal. */
  function findPath(fromIndex, toIndex) {
    if (fromIndex === toIndex) return [fromIndex];
    const open = new Set([fromIndex]);
    const came = new Map();
    const cost = new Map([[fromIndex, 0]]);
    const goal = nodes[toIndex];
    const heuristic = (n) => Math.hypot(n.x - goal.x, n.z - goal.z);
    const score = new Map([[fromIndex, heuristic(nodes[fromIndex])]]);
    while (open.size > 0) {
      let current = -1;
      let bestScore = Infinity;
      for (const index of open) {
        if (score.get(index) < bestScore) { bestScore = score.get(index); current = index; }
      }
      if (current === toIndex) {
        const path = [current];
        while (came.has(current)) {
          current = came.get(current);
          path.unshift(current);
        }
        return path;
      }
      open.delete(current);
      for (const next of nodes[current].edges) {
        const stepCost = Math.hypot(nodes[current].x - nodes[next].x, nodes[current].z - nodes[next].z);
        const total = cost.get(current) + stepCost;
        if (total < (cost.get(next) ?? Infinity)) {
          came.set(next, current);
          cost.set(next, total);
          score.set(next, total + heuristic(nodes[next]));
          open.add(next);
        }
      }
    }
    return [fromIndex];
  }

  return {
    colliders, shootables, nodes, byName, nearestNode, findPath,
    siteAt(x, z) {
      for (const [key, site] of Object.entries(SITES)) {
        if (x >= site.minX && x <= site.maxX && z >= site.minZ && z <= site.maxZ) return key;
      }
      return null;
    },
  };
}
