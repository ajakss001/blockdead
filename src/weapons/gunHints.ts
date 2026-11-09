/**
 * Where things are on each firearm model (Meshy GLBs as they come: normalised to ~0.96 along X, the muzzle
 * at −X, up +Y, the side seen from +Z is the gun's left). Read off the gridded side views (tools/import-assets
 * prints them with `--grid`): points [x, y] in those model units. The import turns them into the game's gun
 * frame; with no model the game builds a low-poly stand-in from the same numbers (src/weapons/gunModel).
 *
 * grip: the pistol grip's axis, bottom → top (the right hand's socket, grip_main, sits `main` of the way up).
 * fore: the left hand's place (grip_off) — on the handguard / pump / the RPG's rear grip; pistols: none
 *       (the left hand cups the right).
 * sightF / sightR: the tops of the front sight and of the rear notch: the sight line.
 * muzzle, eject (the port on the right), light (under the barrel), bolt (what the hand pulls), load (where
 * shells go in), mag: the box cut out as the magazine (and its top = the magazine socket).
 * parts: boxes cut out to move on their own (slide, pump, rocket).
 * strip: boxes taken off the model (what blocks the sights): a triangle goes if its middle is in one, or any corner
 *        is in one marked `all`. rail: a rail section built there (base x × y × z, teeth `pitch` apart up to `top`),
 *        coloured as the model at `uv` (a point of its own rail).
 */
type P = readonly [number, number];
type Box = { readonly x: P; readonly y: P };

/** One firearm's model hints (see above). */
export interface GunHint {
  length: number;
  grip: readonly [P, P];
  main: number;
  fore?: P;
  /** A second pistol grip for the left hand (the RPG's), bottom → top. */
  foreGrip?: readonly [P, P];
  sightF: P;
  sightR: P;
  muzzle: P;
  eject: P;
  light: P;
  bolt: P;
  load?: P;
  mag?: Box;
  /** Pistols: the magazine rides up the grip along this line (bottom → top); it is not cut from the model. */
  magWell?: readonly [P, P];
  parts?: Readonly<Record<string, Box>>;
  strip?: readonly (Box & { readonly all?: boolean })[];
  rail?: { readonly x: P; readonly y: P; readonly z: P; readonly top: number; readonly pitch: number; readonly uv: P };
}

export const HINTS: Readonly<Record<string, GunHint>> = {
  pistol_g17: {
    length: 0.186,
    grip: [[0.33, -0.27], [0.24, 0.1]],
    main: 0.55,
    sightF: [-0.435, 0.29],
    sightR: [0.362, 0.29],
    muzzle: [-0.48, 0.21],
    eject: [0.1, 0.24],
    light: [-0.3, 0.13],
    bolt: [0.36, 0.23],
    parts: { slide: { x: [-0.5, 0.43], y: [0.168, 0.5] } },
    magWell: [[0.33, -0.27], [0.24, 0.1]],
  },
  pistol_m1911: {
    length: 0.216,
    grip: [[0.35, -0.27], [0.27, 0.13]],
    main: 0.55,
    sightF: [-0.43, 0.292],
    sightR: [0.315, 0.292],
    muzzle: [-0.48, 0.225],
    eject: [0.08, 0.25],
    light: [-0.3, 0.14],
    bolt: [0.33, 0.24],
    parts: { slide: { x: [-0.5, 0.39], y: [0.152, 0.5] } },
    magWell: [[0.35, -0.27], [0.27, 0.13]],
  },
  rifle_m4a1: {
    length: 0.84,
    grip: [[0.245, -0.085], [0.185, 0.01]],
    main: 0.5,
    fore: [-0.12, 0.066],
    sightF: [-0.23, 0.128],
    sightR: [0.19, 0.128],
    muzzle: [-0.48, 0.068],
    eject: [0.1, 0.075],
    light: [-0.16, 0.035],
    bolt: [0.09, 0.05],
    mag: { x: [0.008, 0.102], y: [-0.17, 0.024] },
    // The rear sight (in the way in the sights) off, and its base; the top rail carried on over it.
    strip: [{ x: [0.152, 0.232], y: [0.106, 0.2], all: true }, { x: [0.152, 0.22], y: [0.096, 0.2] }],
    rail: { x: [0.15, 0.222], y: [0.086, 0.101], z: [-0.01, 0.018], top: 0.105, pitch: 0.02, uv: [0.11, 0.104] },
  },
  rifle_ak: {
    length: 0.88,
    grip: [[0.21, -0.065], [0.175, 0.03]],
    main: 0.5,
    fore: [-0.12, 0.08],
    sightF: [-0.4, 0.124],
    sightR: [-0.015, 0.121],
    muzzle: [-0.48, 0.075],
    eject: [0.07, 0.09],
    light: [-0.14, 0.05],
    bolt: [0.1, 0.085],
    mag: { x: [-0.078, 0.099], y: [-0.145, 0.053] },
  },
  shotgun_pump: {
    length: 1.0,
    grip: [[0.31, -0.055], [0.235, 0.03]],
    main: 0.5,
    fore: [-0.15, 0.035],
    sightF: [-0.458, 0.079],
    sightR: [0.05, 0.079],
    muzzle: [-0.48, 0.065],
    eject: [0.1, 0.06],
    light: [-0.38, 0.045],
    load: [0.1, 0.0],
    bolt: [-0.2, 0.035],
    parts: { pump: { x: [-0.335, -0.07], y: [-0.005, 0.06] } },
  },
  rifle_hunting: {
    length: 1.1,
    grip: [[0.3, -0.045], [0.235, 0.03]],
    main: 0.5,
    fore: [-0.12, 0.035],
    sightF: [-0.46, 0.066],
    sightR: [-0.065, 0.064],
    muzzle: [-0.48, 0.05],
    eject: [0.13, 0.06],
    light: [-0.3, 0.025],
    bolt: [0.18, 0.055],
    load: [0.13, 0.06],
  },
  launcher_rpg: {
    length: 1.3,
    grip: [[-0.025, -0.09], [-0.035, 0.0]],
    main: 0.5,
    fore: [0.075, -0.04],
    foreGrip: [[0.075, -0.075], [0.075, 0.0]],
    sightF: [-0.17, 0.08],
    sightR: [0.075, 0.098],
    muzzle: [-0.205, 0.02],
    eject: [0.48, 0.02],
    light: [-0.1, -0.01],
    bolt: [-0.205, 0.02],
    load: [-0.205, 0.02],
    parts: { rocket: { x: [-0.5, -0.2], y: [-0.5, 0.5] } },
  },
};

/** The modules: real size of the longest side (m); magazines stand upright (their top at y max). */
export const MOD_HINTS: Readonly<Record<string, { length: number }>> = {
  mod_suppressor: { length: 0.165 },
  mod_ext_mag_m4: { length: 0.27 },
  mod_ext_mag_ak: { length: 0.29 },
  mod_ext_mag_g17: { length: 0.16 },
  mod_flashlight: { length: 0.11 },
};
