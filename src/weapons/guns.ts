/**
 * Firearms: every number of a gun is here (damage, rate, spread, recoil, capacity, calibre, noise, weight,
 * durability, the timings of its animations), and which modules fit which gun. The models and their sockets:
 * weapons/gunHints + gunFrame (import: tools/import-assets.mjs); the logic: weapons/gunState; the hands:
 * player/gunPose. Names without trademarks (G17, M1911, M4A1, AK), no markings on the models.
 *
 * Balance (CLAUDE.md «Огнестрельное оружие»): a shot is heard far — pistols ~40 m, rifles ~60, the shotgun ~50,
 * the RPG ~120 — and the zombies come to it; ammunition is rare. Shooting is dangerous.
 */

export type GunId = 'pistol_g17' | 'pistol_m1911' | 'shotgun_pump' | 'rifle_m4a1' | 'rifle_ak' | 'rifle_hunting' | 'launcher_rpg';
export const GUN_IDS: readonly GunId[] = ['pistol_g17', 'pistol_m1911', 'shotgun_pump', 'rifle_m4a1', 'rifle_ak', 'rifle_hunting', 'launcher_rpg'];

export type AmmoId = 'ammo_9mm' | 'ammo_45' | 'ammo_12' | 'ammo_556' | 'ammo_762' | 'ammo_308' | 'rocket_rpg';
export type MagId = 'mag_g17' | 'mag_m1911' | 'mag_m4' | 'mag_ak';
export type ModId = 'mod_suppressor' | 'mod_ext_mag_m4' | 'mod_ext_mag_ak' | 'mod_ext_mag_g17' | 'mod_flashlight';
export const MOD_IDS: readonly ModId[] = ['mod_suppressor', 'mod_ext_mag_m4', 'mod_ext_mag_ak', 'mod_ext_mag_g17', 'mod_flashlight'];
/** Where a module goes on the gun (one per slot). */
export type ModSlot = 'muzzle' | 'mag' | 'rail';

export type FireMode = 'semi' | 'auto';
/**
 * How it is fed: a detachable magazine (pistols, rifles), a tube loaded a shell at a time (the pump), an
 * internal magazine loaded a round at a time (the bolt rifle), one rocket at the muzzle.
 */
export type Feed = 'mag' | 'tube' | 'internal' | 'rocket';
/** What works the action between shots: nothing (self-loading), the pump, the bolt; the RPG is reloaded. */
export type Action = 'auto' | 'pump' | 'bolt' | 'single';
/** Which hold poses it shares: one-handed-looking pistols, long guns at the shoulder, the tube on the shoulder. */
export type GunClass = 'pistol' | 'long' | 'launcher';

export interface GunTimes {
  /** Draw / put away (switching), s. */
  draw: number;
  holster: number;
  /** To the sights and back. */
  aim: number;
  /** Reload with rounds still in (the one in the chamber stays: capacity + 1) and from empty. */
  reload: number;
  reloadEmpty: number;
  /** One at a time (tube, internal): getting ready, each round, finishing. */
  loadStart?: number;
  loadOne?: number;
  loadEnd?: number;
  /** Pump / bolt after a shot. */
  cycle?: number;
  /** Clearing a jam (slap the magazine, rack the action). */
  unjam: number;
  inspect: number;
  /** Fire-mode switch (the thumb on the selector). */
  mode: number;
}

export interface GunConfig {
  item: GunId;
  name: string;
  cls: GunClass;
  caliber: AmmoId;
  /** Rounds in the magazine / tube / internal magazine (the chamber adds one on a tactical reload). */
  capacity: number;
  feed: Feed;
  action: Action;
  /** The spare magazine item it takes (detachable magazines only). */
  mag?: MagId;
  modes: readonly FireMode[];
  /** Damage of a hit to a zombie (of 100 HP), min–max; the head takes double. Per pellet for the shotgun. */
  damage: readonly [number, number];
  pellets?: number;
  /** Shots a minute at most (the trigger finger, or the action's own rate on auto). */
  rpm: number;
  /** Cone half-angle, degrees: from the hip, in the sights; moving adds to it (×`move` at a run). */
  spread: { hip: number; aim: number; move: number };
  /**
   * Recoil per shot: the muzzle up and a random bit sideways (rad, on the view too), the gun back (m);
   * on auto it climbs by `climb` a shot in a burst; `shake` the camera's jolt.
   */
  recoil: { up: number; side: number; back: number; climb: number; shake: number };
  /** How far a shot is heard, m (zombies within come to look). */
  noise: number;
  /** Range the bullet still does full damage, then halves by `range × 2`, m. */
  range: number;
  weight: number;
  /** Shots before it is worn out; it jams more often past 70% wear. */
  durability: number;
  times: GunTimes;
  /** Area damage (the RPG): radius, damage at the centre, impulse to the ragdolls. */
  blast?: { radius: number; damage: number; impulse: number };
  /** Field of view in the sights, of the normal one. */
  zoom: number;
}

export const GUNS: Readonly<Record<GunId, GunConfig>> = {
  pistol_g17: {
    item: 'pistol_g17',
    name: 'G17',
    cls: 'pistol',
    caliber: 'ammo_9mm',
    capacity: 17,
    feed: 'mag',
    action: 'auto',
    mag: 'mag_g17',
    modes: ['semi'],
    damage: [30, 38],
    rpm: 400,
    spread: { hip: 3.5, aim: 0.9, move: 1.8 },
    recoil: { up: 0.045, side: 0.012, back: 0.03, climb: 0, shake: 0.35 },
    noise: 40,
    range: 25,
    weight: 0.9,
    durability: 900,
    times: { draw: 0.42, holster: 0.4, aim: 0.2, reload: 1.45, reloadEmpty: 1.9, unjam: 1.4, inspect: 2.6, mode: 0.3 },
    zoom: 0.92,
  },
  pistol_m1911: {
    item: 'pistol_m1911',
    name: 'M1911',
    cls: 'pistol',
    caliber: 'ammo_45',
    capacity: 7,
    feed: 'mag',
    action: 'auto',
    mag: 'mag_m1911',
    modes: ['semi'],
    damage: [42, 50],
    rpm: 340,
    spread: { hip: 3.8, aim: 1.0, move: 1.8 },
    recoil: { up: 0.06, side: 0.015, back: 0.035, climb: 0, shake: 0.45 },
    noise: 42,
    range: 22,
    weight: 1.1,
    durability: 800,
    times: { draw: 0.42, holster: 0.4, aim: 0.2, reload: 1.5, reloadEmpty: 2.0, unjam: 1.4, inspect: 2.6, mode: 0.3 },
    zoom: 0.92,
  },
  shotgun_pump: {
    item: 'shotgun_pump',
    name: 'Помповое ружьё',
    cls: 'long',
    caliber: 'ammo_12',
    capacity: 6,
    feed: 'tube',
    action: 'pump',
    modes: ['semi'],
    damage: [9, 13],
    pellets: 8,
    rpm: 70,
    spread: { hip: 5, aim: 3.2, move: 1.4 },
    recoil: { up: 0.1, side: 0.025, back: 0.07, climb: 0, shake: 0.9 },
    noise: 50,
    range: 9,
    weight: 3.4,
    durability: 600,
    times: { draw: 0.55, holster: 0.5, aim: 0.27, reload: 0, reloadEmpty: 0, loadStart: 0.35, loadOne: 0.55, loadEnd: 0.4, cycle: 0.55, unjam: 1.6, inspect: 3, mode: 0.3 },
    zoom: 0.9,
  },
  rifle_m4a1: {
    item: 'rifle_m4a1',
    name: 'M4A1',
    cls: 'long',
    caliber: 'ammo_556',
    capacity: 30,
    feed: 'mag',
    action: 'auto',
    mag: 'mag_m4',
    modes: ['semi', 'auto'],
    damage: [36, 44],
    rpm: 750,
    spread: { hip: 4.5, aim: 0.45, move: 2.2 },
    recoil: { up: 0.022, side: 0.01, back: 0.025, climb: 0.006, shake: 0.4 },
    noise: 60,
    range: 60,
    weight: 3.1,
    durability: 1000,
    times: { draw: 0.55, holster: 0.5, aim: 0.25, reload: 2.1, reloadEmpty: 2.7, unjam: 1.7, inspect: 3.2, mode: 0.35 },
    zoom: 0.88,
  },
  rifle_ak: {
    item: 'rifle_ak',
    name: 'AK',
    cls: 'long',
    caliber: 'ammo_762',
    capacity: 30,
    feed: 'mag',
    action: 'auto',
    mag: 'mag_ak',
    modes: ['semi', 'auto'],
    damage: [44, 52],
    rpm: 600,
    spread: { hip: 5, aim: 0.7, move: 2.4 },
    recoil: { up: 0.032, side: 0.016, back: 0.03, climb: 0.009, shake: 0.55 },
    noise: 62,
    range: 50,
    weight: 3.6,
    durability: 1500,
    times: { draw: 0.55, holster: 0.5, aim: 0.26, reload: 2.2, reloadEmpty: 2.8, unjam: 1.7, inspect: 3.2, mode: 0.35 },
    zoom: 0.88,
  },
  rifle_hunting: {
    item: 'rifle_hunting',
    name: 'Охотничий карабин',
    cls: 'long',
    caliber: 'ammo_308',
    capacity: 5,
    feed: 'internal',
    action: 'bolt',
    modes: ['semi'],
    damage: [85, 100],
    rpm: 50,
    spread: { hip: 6, aim: 0.25, move: 3 },
    recoil: { up: 0.085, side: 0.015, back: 0.06, climb: 0, shake: 0.8 },
    noise: 65,
    range: 90,
    weight: 3.5,
    durability: 500,
    times: { draw: 0.58, holster: 0.52, aim: 0.3, reload: 0, reloadEmpty: 0, loadStart: 0.4, loadOne: 0.5, loadEnd: 0.45, cycle: 0.9, unjam: 1.8, inspect: 3.2, mode: 0.3 },
    zoom: 0.85,
  },
  launcher_rpg: {
    item: 'launcher_rpg',
    name: 'РПГ',
    cls: 'launcher',
    caliber: 'rocket_rpg',
    capacity: 1,
    feed: 'rocket',
    action: 'single',
    modes: ['semi'],
    damage: [300, 300],
    rpm: 20,
    spread: { hip: 2.5, aim: 0.6, move: 1.5 },
    recoil: { up: 0.04, side: 0.01, back: 0.05, climb: 0, shake: 1.4 },
    noise: 120,
    range: 150,
    weight: 7,
    durability: 50,
    times: { draw: 0.6, holster: 0.55, aim: 0.3, reload: 3, reloadEmpty: 3, unjam: 2, inspect: 3, mode: 0.3 },
    blast: { radius: 6, damage: 260, impulse: 9 },
    zoom: 0.9,
  },
};

export interface ModConfig {
  name: string;
  slot: ModSlot;
  weight: number;
  note: string;
}

export const MODS: Readonly<Record<ModId, ModConfig>> = {
  mod_suppressor: { name: 'Глушитель', slot: 'muzzle', weight: 0.35, note: 'Шум выстрела −70%, урон −10%' },
  mod_ext_mag_m4: { name: 'Магазин M4A1 на 40', slot: 'mag', weight: 0.25, note: 'M4A1: 40 патронов' },
  mod_ext_mag_ak: { name: 'Магазин AK на 40', slot: 'mag', weight: 0.35, note: 'AK: 40 патронов' },
  mod_ext_mag_g17: { name: 'Магазин G17 на 33', slot: 'mag', weight: 0.15, note: 'G17: 33 патрона' },
  mod_flashlight: { name: 'Подствольный фонарь', slot: 'rail', weight: 0.15, note: 'Светит, пока оружие в руках; ест батарейки' },
};

/** What fits what. */
export const MOD_FITS: Readonly<Record<ModId, readonly GunId[]>> = {
  mod_suppressor: ['pistol_g17', 'pistol_m1911', 'rifle_m4a1', 'rifle_ak', 'rifle_hunting'],
  mod_ext_mag_m4: ['rifle_m4a1'],
  mod_ext_mag_ak: ['rifle_ak'],
  mod_ext_mag_g17: ['pistol_g17'],
  mod_flashlight: ['pistol_g17', 'rifle_m4a1', 'rifle_ak', 'shotgun_pump'],
};
/** Capacity with an extended magazine. */
export const EXT_CAPACITY: Readonly<Partial<Record<ModId, number>>> = { mod_ext_mag_m4: 40, mod_ext_mag_ak: 40, mod_ext_mag_g17: 33 };
export const SUPPRESSOR = { noise: 0.3, damage: 0.9 };

export const AMMO: Readonly<Record<AmmoId, { name: string; weight: number; stack: number }>> = {
  ammo_9mm: { name: 'Патроны 9×19', weight: 0.012, stack: 50 },
  ammo_45: { name: 'Патроны .45', weight: 0.02, stack: 50 },
  ammo_12: { name: 'Патроны 12 калибра', weight: 0.045, stack: 25 },
  ammo_556: { name: 'Патроны 5.56×45', weight: 0.012, stack: 60 },
  ammo_762: { name: 'Патроны 7.62×39', weight: 0.016, stack: 60 },
  ammo_308: { name: 'Патроны .308', weight: 0.025, stack: 20 },
  rocket_rpg: { name: 'Выстрел к РПГ', weight: 2.2, stack: 3 },
};
export const AMMO_IDS = Object.keys(AMMO) as AmmoId[];

export const MAGS: Readonly<Record<MagId, { name: string; weight: number; gun: GunId }>> = {
  mag_g17: { name: 'Магазин G17', weight: 0.08, gun: 'pistol_g17' },
  mag_m1911: { name: 'Магазин M1911', weight: 0.08, gun: 'pistol_m1911' },
  mag_m4: { name: 'Магазин M4A1', weight: 0.12, gun: 'rifle_m4a1' },
  mag_ak: { name: 'Магазин AK', weight: 0.25, gun: 'rifle_ak' },
};

export const isGun = (id: string | null | undefined): id is GunId => !!id && id in GUNS;
export const isMod = (id: string | null | undefined): id is ModId => !!id && id in MODS;

/** The capacity of a gun with these modules. */
export function capacityOf(id: GunId, mods: readonly ModId[]): number {
  for (const m of mods) {
    const c = EXT_CAPACITY[m];
    if (c && MOD_FITS[m].includes(id)) return c;
  }
  return GUNS[id].capacity;
}

/** How far a shot is heard with these modules, m. */
export function noiseOf(id: GunId, mods: readonly ModId[]): number {
  return GUNS[id].noise * (mods.includes('mod_suppressor') ? SUPPRESSOR.noise : 1);
}

/** The damage range of a hit (per pellet) with these modules. */
export function damageOf(id: GunId, mods: readonly ModId[]): readonly [number, number] {
  const d = GUNS[id].damage;
  const k = mods.includes('mod_suppressor') ? SUPPRESSOR.damage : 1;
  return [d[0] * k, d[1] * k];
}

/** Damage at a distance: full to `range`, then down to half at twice it. */
export function falloff(id: GunId, dist: number): number {
  const r = GUNS[id].range;
  return dist <= r ? 1 : Math.max(0.5, 1 - (0.5 * (dist - r)) / r);
}
