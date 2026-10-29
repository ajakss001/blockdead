import { BoxGeometry, type BufferGeometry, ConeGeometry, CylinderGeometry, Group, type Material, Mesh } from 'three';
import { bladeMaterial, characterMaterial } from '../render/look/materials';

/** Things that go in the hands: weapons and tools, plus the flashlight (left hand). */
export type HeldId = 'knife' | 'axe' | 'bat' | 'crowbar' | 'hammer' | 'torch';

type V3 = readonly [number, number, number];

/**
 * A hand's place on the handle (grip_main / grip_off): `along` from the butt, and the hand's turn about
 * the handle. The hand frame at the socket: its grip axis (+Y, thumb side) along the handle towards the
 * head, its reach (−Z, wrist → knuckles) the item's −Z turned by `roll` about the handle (rad, about +Y).
 * The hand is rigid with its socket: when the item turns, the hand turns with it as one piece.
 */
export interface Socket {
  along: number;
  roll: number;
  /** Where the hand slides to along the handle in poses with `slide` 1 (the top hand of an axe chop runs down to the bottom one). */
  slide?: number;
}

/** Pose of an item in viewmodel-camera space: where its anchor socket is, the handle (+Y) and edge (−Z) directions. */
export interface Key {
  at: V3;
  axis: V3;
  edge: V3;
  /** Turn of the shoulders (torso) about the chest, a rotation vector (rad); none by default. */
  body?: V3;
  /** 0..1: how far the main hand has slid along the handle towards `main.slide`. */
  slide?: number;
}

/**
 * Key poses of an item: rest, sprint, lowered (switching), and the swing — windup → strike → recover → rest.
 * `anchor` names the socket whose position the keys give, so items of different lengths share the poses.
 */
export interface KeySet {
  anchor: 'main' | 'off';
  idle: Key;
  sprint: Key;
  lowered: Key;
  windup?: Key;
  strike?: Key;
  /** Waypoint of the return after the blow (its own path, not the strike played backwards). */
  recover?: Key;
  /**
   * A swing along a path instead of windup/strike/recover keys: the waypoints between rest and rest —
   * [windup half, windup top, strike half, contact, follow-through end, recover half]. The head runs
   * through them on cubic Bézier segments (Catmull-Rom tangents, zero where it turns back: at the top and
   * at the end of the follow-through), the item's edge faces along the arc.
   */
  swing?: SwingPoint[];
  /** A thrust (knife): the item points along the path, tip first, its edge kept down — not along the arc. */
  stab?: boolean;
}

/** One waypoint of a swing path, viewmodel-camera space. */
export interface SwingPoint {
  /** The top of the handle (at the height of HeldConfig.head) here. */
  head: V3;
  /** The anchor hand here: the handle runs from it to the head. */
  hand: V3;
  /** Extra turn of the edge about the handle (rad). */
  roll?: number;
  /** Turn of the shoulders, as in Key. */
  body?: V3;
  /** 0..1 slide of the main hand (as in Key). */
  slide?: number;
  /** Camera pitch (rad, + looks up): the windup leans back, the blow forward. */
  pitch?: number;
}

/**
 * How an item is held. Every model is authored the same way: the handle runs along +Y from the
 * butt at y = 0, the blade / striking face points to −Z ("forward", away from the holder).
 * A new item is a config — sockets, key poses, timing; the arms are solved for it (player/armRig).
 */
export interface HeldConfig {
  /** Both hands on the handle (the flashlight goes to the head). */
  twoHanded: boolean;
  /** The main (right) hand; the item is its child. */
  main: Socket;
  /** The other (left) hand of two-handed items, brought to the handle by IK. */
  off?: Socket;
  keys: KeySet;
  /** The striking end in the item frame: stays in the frame through every animation (test:anim). */
  head: V3;
  /**
   * Swing timing, seconds. Keyed swings: the blow lands at the start of `strike`. Path swings: windup →
   * strike → contact (the blow lands, hit check) → follow-through (`follow`) → recover.
   */
  windup: number;
  strike: number;
  follow?: number;
  recover: number;
  /** How loud a swing is, 0..1. */
  noise: number;
  /** Damage of a blow to a zombie (of 100 HP), min–max; a blow to the head counts double. */
  damage: readonly [number, number];
  /** How far a blow reaches from the eye, m. */
  reach: number;
}

const key = (at: V3, axis: V3, edge: V3, body?: V3, slide?: number): Key => ({ at, axis, edge, body, slide });

/**
 * Two-handed poses (axe, bat, crowbar), anchored on the lower (left) hand at the end of the handle: it
 * always stays low left in the frame, the right hand and the head sit further up by each weapon's length.
 * Diagonally across the body: the head up on the right, the handle down to the left hand, below the crosshair.
 * Poses come from the tuner (debug/animTune.ts) within the wrist limits; edit them through it, then test:anim.
 */
const TWO_HANDED: KeySet = {
  anchor: 'off',
  idle: key([-0.157, -0.388, -0.713], [0.525, 0.709, 0.47], [-0.104, 0.601, -0.792], [-0.473, 0.081, 0.435]),
  sprint: key([-0.251, -0.298, -0.637], [0.826, 0.545, 0.14], [-0.2, 0.517, -0.832], [-0.31, 0.054, 0.362]),
  lowered: key([-0.157, -0.788, -0.563], [0.525, 0.845, -0.098], [-0.104, -0.05, -0.993], [-0.473, 0.081, 0.435]),
  // Wound up: the head lifted high on the right, the edge leading.
  windup: key([0.089, -0.382, -0.697], [0.292, 0.943, 0.156], [-0.245, 0.232, -0.941], [-0.124, -0.194, 0.324]),
  // End of the chop: across to the left, the top hand slid down to the bottom one, edge forward.
  strike: key([0.269, -0.381, -0.698], [-0.851, 0.408, 0.331], [-0.378, -0.037, -0.925], [-0.718, -0.595, 0.21], 1),
  // On the way back: low across the front, the top hand sliding back up.
  recover: key([0.258, -0.403, -0.732], [-0.806, 0.398, 0.439], [-0.338, 0.299, -0.892], [-0.83, -0.552, 0.104], 0.6),
};

/**
 * Axe: a diagonal chop from over the right shoulder down to the left through the middle of the screen.
 * Windup — back and up over the right shoulder (the head partly over the top right edge), the top hand at
 * the head; strike — down along the arc, the edge leading, the top hand sliding down to the bottom one;
 * contact — the edge through the crosshair about 1 m out; follow-through — on down-left, braking below the
 * middle of the screen; recover — a low arc back to rest, the top hand back up.
 */
const AXE: KeySet = {
  ...TWO_HANDED,
  swing: [
    { head: [0.263, 0.124, -0.403], hand: [-0.125, -0.479, -0.749], roll: -0.603, body: [-0.152, -0.71, -0.078], pitch: 0.02 },
    { head: [0.291, 0.18, -0.414], hand: [-0.059, -0.198, -0.548], roll: 0.455, body: [0.07, 0.44, 0.09], pitch: 0.04 },
    { head: [0.151, 0.302, -0.869], hand: [0.022, -0.339, -0.605], roll: -0.163, body: [-0.124, 0.245, 0.219], slide: 0.526, pitch: 0.01 },
    { head: [-0.026, 0.054, -0.966], hand: [0.343, -0.307, -0.36], roll: -1.237, body: [0.419, -0.155, 0.364], slide: 1, pitch: -0.02 },
    { head: [-0.354, -0.139, -1.002], hand: [0.372, -0.447, -0.5], roll: -1.136, body: [-0.478, 0.172, -0.39], slide: 1, pitch: -0.01 },
    { head: [-0.013, 0.303, -0.76], hand: [0.06, -0.296, -0.647], roll: -0.37, body: [-0.226, 0.18, -0.132], slide: 0.55 },
  ],
};

/** Knife: a stab — straight forward through the crosshair, tip first. */
const KNIFE: KeySet = {
  anchor: 'main',
  idle: key([-0.005, -0.181, -0.362], [0.764, 0.637, -0.104], [-0.617, 0.673, -0.408], [0.148, -0.139, -0.121]),
  sprint: key([0.103, -0.282, -0.644], [-0.4, 0.721, 0.566], [-0.475, 0.365, -0.8], [-0.054, 0.121, 0.025]),
  lowered: key([-0.005, -0.581, -0.212], [0.764, 0.42, -0.49], [-0.617, 0.252, -0.746], [0.148, -0.139, -0.121]),
  windup: key([0.178, -0.116, -0.503], [0.006, 0.898, 0.44], [-0.611, 0.352, -0.709], [-0.06, 0, 0.044]),
  strike: key([-0.037, -0.234, -0.596], [-0.185, 0.728, 0.66], [-0.711, 0.365, -0.602], [0.024, 0.186, -0.076]),
  recover: key([-0.01, -0.296, -0.615], [-0.171, 0.793, 0.585], [-0.709, 0.313, -0.632], [-0.141, 0.033, 0.061]),
  // Stab: the hand pulls back by the hip, the knife already pointing forward; a straight thrust, the tip
  // leading, through the crosshair ~0.75 m out, a little past, pulled back. The edge stays down.
  stab: true,
  swing: [
    { head: [0.137, -0.045, -0.505], hand: [-0.001, -0.298, -0.374], roll: 0.358, body: [0.145, 0.061, 0.049] },
    { head: [0.205, -0.041, -0.53], hand: [0.228, -0.285, -0.362], roll: 0.492, body: [0.149, -0.144, -0.032] },
    { head: [0.073, -0.026, -0.617], hand: [0.142, -0.136, -0.502], roll: 0.168, body: [0.005, 0.043, -0.001] },
    { head: [-0.002, -0.007, -0.772], hand: [0.078, -0.17, -0.585], roll: 0.038, body: [0.212, 0.116, 0.092] },
    { head: [0.008, 0.002, -0.734], hand: [0.147, -0.177, -0.523], roll: -0.48, body: [0.175, -0.134, 0.147] },
    { head: [0.114, 0.027, -0.514], hand: [0.164, -0.41, -0.432], roll: 0.258, body: [0.213, 0.446, -0.183], slide: 0.006 },
  ],
};

/** Hammer: the knife's arc with a heavier head. */
const HAMMER: KeySet = {
  anchor: 'main',
  idle: key([0.191, -0.173, -0.363], [-0.947, 0.303, -0.102], [0.191, 0.28, -0.941], [0.243, 0.388, 0.672]),
  sprint: key([0.104, -0.27, -0.582], [-0.429, 0.637, 0.64], [-0.523, 0.403, -0.751], [0.091, 0.055, 0.047]),
  lowered: key([0.191, -0.573, -0.213], [-0.947, 0.166, -0.273], [0.191, -0.392, -0.9], [0.243, 0.388, 0.672]),
  windup: key([0.163, -0.046, -0.584], [-0.383, 0.744, 0.548], [-0.396, 0.404, -0.825], [0.007, -0.092, -0.11]),
  strike: key([-0.046, -0.271, -0.68], [-0.488, 0.784, 0.383], [-0.431, 0.166, -0.887], [0.146, 0.339, -0.044]),
  recover: key([0.093, -0.309, -0.602], [-0.452, 0.717, 0.531], [-0.542, 0.253, -0.801], [0.1, 0.001, -0.224]),
};

/** Fists: a short jab; the "handle" is the fist's own grip axis. */
const FIST: KeySet = {
  anchor: 'main',
  idle: key([0.092, -0.153, -0.383], [-0.161, -0.446, 0.88], [-0.891, -0.318, -0.324], [-0.351, 0.102, 0.016]),
  sprint: key([-0.004, -0.193, -0.522], [-0.417, 0.865, 0.279], [-0.199, 0.212, -0.957], [0.124, -0.315, 0.128]),
  lowered: key([0.092, -0.553, -0.233], [-0.161, 0.226, 0.961], [-0.891, -0.452, -0.043], [-0.351, 0.102, 0.016]),
  windup: key([0.164, -0.196, -0.457], [-0.334, 0.598, 0.729], [-0.457, 0.574, -0.68], [-0.066, 0.186, 0.318]),
  strike: key([-0.039, -0.179, -0.678], [-0.838, 0.064, 0.542], [-0.494, 0.334, -0.803], [-0.172, -0.101, 0.387]),
  recover: key([0.119, -0.192, -0.513], [-0.696, 0.69, 0.198], [-0.337, -0.07, -0.939], [0.411, 0.036, 0.138]),
  // Jab: pulled back by the shoulder, straight out to the crosshair, a little past it, back low.
  swing: [
    { head: [0.15, -0.136, -0.376], hand: [0.204, -0.213, -0.453], roll: -0.039, body: [-0.014, -0.116, 0.185] },
    { head: [0.15, -0.137, -0.376], hand: [0.101, -0.258, -0.394], roll: 0.483, body: [0.048, -0.08, -0.038] },
    { head: [0.094, -0.082, -0.508], hand: [0.076, -0.114, -0.529], roll: 0.121, body: [0.105, 0.047, 0.096], slide: 0.11 },
    { head: [0, 0, -0.665], hand: [-0.074, -0.112, -0.697], roll: -0.12, body: [-0.157, 0.011, 0.007] },
    { head: [-0.009, -0.037, -0.674], hand: [-0.048, -0.148, -0.727], roll: -0.121, body: [-0.082, 0.212, 0.021], slide: 0.084 },
    { head: [0.069, -0.128, -0.479], hand: [0.121, -0.143, -0.604], roll: 0.244, body: [-0.22, 0.113, -0.001], slide: 0.053 },
  ],
};

/** Flashlight in the left hand: raised (on) or lowered out of view (off). */
const TORCH: KeySet = {
  anchor: 'main',
  idle: key([-0.145, -0.169, -0.348], [0.546, -0.075, -0.834], [-0.395, 0.855, -0.335], [0.452, 0.357, -0.528]),
  sprint: key([-0.193, -0.274, -0.586], [0.287, 0.51, -0.811], [-0.782, -0.365, -0.506], [0.38, -0.011, -0.381]),
  lowered: key([-0.145, -0.569, -0.198], [0.546, -0.594, -0.59], [-0.395, 0.438, -0.807], [0.452, 0.357, -0.528]),
};

const DEG = Math.PI / 180;
/** Two-handed grips: the right hand up the handle (the bat: hands together at the knob), the left at the butt, both thumbs towards the head. */
const ROLL_R = -3.2 * DEG;
const ROLL_L = -34.8 * DEG;
/** The axe's own grips (its path swing is tuned apart from the bat and the crowbar). */
const AXE_R = 1.0 * DEG;
const AXE_L = -50.4 * DEG;

export const HELD: Readonly<Record<HeldId, HeldConfig>> = {
  knife: { twoHanded: false, main: { along: 0.05, roll: 0 }, keys: KNIFE, head: [0, 0.27, 0.01], windup: 7 / 60, strike: 5 / 60, follow: 3 / 60, recover: 12 / 60, noise: 0.2, damage: [10, 15], reach: 1.3 },
  hammer: { twoHanded: false, main: { along: 0.07, roll: 0 }, keys: HAMMER, head: [0, 0.31, -0.02], windup: 0.16, strike: 0.09, recover: 0.3, noise: 0.4, damage: [15, 20], reach: 1.4 },
  axe: { twoHanded: true, main: { along: 0.52, roll: AXE_R, slide: 0.2 }, off: { along: 0.06, roll: AXE_L }, keys: AXE, head: [0, 0.72, -0.075], windup: 16 / 60, strike: 9 / 60, follow: 6 / 60, recover: 21 / 60, noise: 0.5, damage: [35, 45], reach: 1.8 },
  bat: { twoHanded: true, main: { along: 0.16, roll: ROLL_R }, off: { along: 0.06, roll: ROLL_L }, keys: TWO_HANDED, head: [0, 0.72, 0], windup: 0.28, strike: 0.12, recover: 0.36, noise: 0.45, damage: [20, 30], reach: 1.8 },
  crowbar: { twoHanded: true, main: { along: 0.36, roll: ROLL_R, slide: 0.18 }, off: { along: 0.05, roll: ROLL_L }, keys: TWO_HANDED, head: [0, 0.66, -0.06], windup: 0.3, strike: 0.12, recover: 0.38, noise: 0.5, damage: [20, 25], reach: 1.7 },
  torch: { twoHanded: false, main: { along: 0.06, roll: 0 }, keys: TORCH, head: [0, 0.197, 0], windup: 0, strike: 0, recover: 0, noise: 0, damage: [0, 0], reach: 1 },
};

/** Bare fists: an item without a model; the fist's grip axis is its handle. */
export const FISTS: HeldConfig = { twoHanded: false, main: { along: 0, roll: 0 }, keys: FIST, head: [0, 0.05, 0], windup: 6 / 60, strike: 5 / 60, follow: 3 / 60, recover: 12 / 60, noise: 0.25, damage: [4, 7], reach: 1.1 };

/** Model of a held item in its grip frame (see HeldConfig). Geometries are collected for disposal. */
export function buildHeldModel(id: HeldId, geos: BufferGeometry[]): Group {
  const g = new Group();
  const add = (geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0) => {
    geos.push(geo);
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const shaft = (r0: number, r1: number, len: number, seg = 6) => new CylinderGeometry(r1, r0, len, seg).translate(0, len / 2, 0);
  const wood = characterMaterial('handle', 0x6e5034);
  const steel = characterMaterial('torch', 0x4a4e52);
  switch (id) {
    case 'knife': {
      add(new BoxGeometry(0.022, 0.1, 0.03), characterMaterial('handle', 0x3b2a1e), 0, 0.05, 0);
      add(new BoxGeometry(0.03, 0.012, 0.036), steel, 0, 0.105, 0);
      // Flat blade, edge forward (−Z), spine back.
      const blade = new BoxGeometry(0.005, 0.16, 0.032, 1, 2, 1);
      const pos = blade.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        // Taper to a point near the spine at the top: edge forward (−Z), spine back.
        const t = (pos.getY(i) + 0.08) / 0.16;
        pos.setZ(i, pos.getZ(i) * (1 - t * 0.85) + 0.012 * t);
      }
      blade.computeVertexNormals();
      add(blade, bladeMaterial(), 0, 0.19, 0);
      break;
    }
    case 'hammer':
      add(shaft(0.013, 0.012, 0.32), wood);
      add(new BoxGeometry(0.03, 0.032, 0.12), steel, 0, 0.31, -0.02);
      break;
    case 'axe': {
      // Fire axe: red shaft, steel head — the edge forward, the pick behind.
      add(shaft(0.017, 0.015, 0.78), characterMaterial('handle', 0x8a3a24));
      add(new BoxGeometry(0.02, 0.07, 0.07), steel, 0, 0.72, 0);
      const edge = new BoxGeometry(0.012, 0.16, 0.09);
      add(edge, bladeMaterial(), 0, 0.72, -0.075);
      const pick = new ConeGeometry(0.018, 0.12, 4).rotateX(Math.PI / 2);
      add(pick, steel, 0, 0.73, 0.09);
      break;
    }
    case 'bat':
      add(shaft(0.017, 0.036, 0.72, 8), wood);
      add(new CylinderGeometry(0.026, 0.026, 0.018, 8), wood, 0, 0.005, 0);
      // Grip tape.
      add(shaft(0.019, 0.019, 0.2, 8), characterMaterial('cuff', 0x1c1c1e), 0, 0.02, 0);
      break;
    case 'crowbar':
      add(shaft(0.011, 0.011, 0.6), characterMaterial('torch', 0x7a2a22));
      // Hooked claw at the top, bending forward.
      add(new CylinderGeometry(0.01, 0.009, 0.1, 6).rotateX(-1.0), characterMaterial('torch', 0x7a2a22), 0, 0.63, -0.04);
      // Flat chisel end at the butt.
      add(new BoxGeometry(0.012, 0.04, 0.026), characterMaterial('torch', 0x7a2a22), 0, -0.01, -0.006);
      break;
    case 'torch': {
      add(shaft(0.018, 0.018, 0.15, 8), characterMaterial('torch', 0x33363a));
      add(shaft(0.022, 0.028, 0.045, 8), characterMaterial('torch', 0x33363a), 0, 0.15, 0);
      break;
    }
  }
  return g;
}
