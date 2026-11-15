// Every number that tunes the game lives here: timings, money, weapons, grenades.
// Nothing else in the code invents a balance value, so the whole game can be
// re-tuned from this one file.

export const TIMING = {
  buySeconds: 12, // freeze + buy window at each round start
  roundSeconds: 100, // the clock a round is played against
  bombSeconds: 40, // from planted to detonation
  plantSeconds: 3.2, // hold E on a site to plant
  defuseKitSeconds: 5, // hold E on the charge with a kit
  defuseBareSeconds: 10, // ... and without one
  endSeconds: 4.5, // the banner pause between rounds
  roundsToWin: 9,
  maxRounds: 16,
};

export const ECONOMY = {
  startMoney: 800,
  maxMoney: 16000,
  killReward: 300,
  plantTeamBonus: 800,
  planterBonus: 300,
  defuserBonus: 300,
  winReward: 3250,
  lossBase: 1400,
  lossStep: 500, // each consecutive lost round adds this, up to lossMaxSteps
  lossMaxSteps: 3,
};

export const ARMOR = {
  vestPrice: 650,
  helmPrice: 1000, // vest + helmet
  wear: 0.25, // armour points lost per point of raw damage it turns
};

// Weapon table. damage is per bullet at point blank against the chest; the hit
// location multiplies it (head uses headMult, chest 1, stomach 1.25, legs 0.75),
// armour turns it by the weapon's pen, and range fades it toward falloff by
// range metres. spread is in radians at the muzzle: base + move * (ground
// speed / moveRef), tightened by crouch, ruined by air. recoil is the camera
// kick in radians per shot; recovery is how fast the bloom fades.
export const WEAPONS = {
  kestrel: {
    name: 'Kestrel P9', slot: 'sidearm', price: 0, damage: 34, pen: 0.65, headMult: 4,
    rpm: 400, auto: false, mag: 12, reserve: 100, reload: 1.6, pellets: 1,
    spreadBase: 0.006, spreadMove: 0.028, spreadAir: 0.09, recoil: 0.011,
    recovery: 7, range: 42, falloff: 0.55, zoom: 0, weight: 1.0,
  },
  hornet: {
    name: 'Hornet SMG', slot: 'primary', price: 1000, damage: 26, pen: 0.6, headMult: 4,
    rpm: 750, auto: true, mag: 32, reserve: 128, reload: 2.1, pellets: 1,
    spreadBase: 0.011, spreadMove: 0.034, spreadAir: 0.1, recoil: 0.008,
    recovery: 9, range: 34, falloff: 0.5, zoom: 0, weight: 0.94,
  },
  boar: {
    name: 'Boar 12', slot: 'primary', price: 1100, damage: 12, pen: 0.5, headMult: 3,
    rpm: 68, auto: false, mag: 7, reserve: 32, reload: 3.4, pellets: 8,
    spreadBase: 0.045, spreadMove: 0.05, spreadAir: 0.11, recoil: 0.05,
    recovery: 3.5, range: 16, falloff: 0.3, zoom: 0, weight: 0.9,
  },
  lance: {
    name: 'Lance AR', slot: 'primary', price: 2700, damage: 36, pen: 0.75, headMult: 4,
    rpm: 660, auto: true, mag: 30, reserve: 120, reload: 2.4, pellets: 1,
    spreadBase: 0.004, spreadMove: 0.032, spreadAir: 0.1, recoil: 0.013,
    recovery: 8, range: 68, falloff: 0.62, zoom: 0, weight: 0.88,
  },
  longbow: {
    name: 'Longbow DMR', slot: 'primary', price: 4300, damage: 110, pen: 0.95, headMult: 3,
    rpm: 42, auto: false, mag: 5, reserve: 30, reload: 3.1, pellets: 1,
    spreadBase: 0.0006, spreadMove: 0.06, spreadAir: 0.14, recoil: 0.055,
    recovery: 2.5, range: 120, falloff: 0.85, zoom: 2.6, weight: 0.8,
  },
};

export const GRENADES = {
  shard: { name: 'Shard Grenade', price: 300, kind: 'frag', fuse: 1.6, radius: 6.5, damage: 92 },
  flare: { name: 'Flare Grenade', price: 200, kind: 'flash', fuse: 1.4, radius: 17 },
  veil: { name: 'Veil Grenade', price: 300, kind: 'smoke', fuse: 1.1, radius: 3.4, lasts: 13 },
};

export const KIT_PRICE = 200;

// Bot callsigns, five a side. The player leads the Breachers.
export const BOT_NAMES = {
  breach: ['DAX', 'RYE', 'SOLA', 'PIKE'],
  ward: ['VOSS', 'MIRA', 'HALE', 'IBEN', 'TOMA'],
};

export const TEAM_NAMES = { breach: 'Breachers', ward: 'Wardens' };
