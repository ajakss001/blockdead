import './domStub';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { type Gait, Sound, type StepSurface, sfx } from '../audio/Sound';
import { type SampleGroup, Samples } from '../audio/samples';
import { InputManager } from '../input/InputManager';
import { PlayerController } from '../player/PlayerController';
import { Viewmodel } from '../player/Viewmodel';
import { Particles } from '../render/Particles';
import { Firearms, type FirearmsWorld } from '../systems/Firearms';
import { Inventory } from '../systems/Inventory';
import { type ZombieWorld, ZombieSim } from '../systems/zombies';
import { giveLoadout } from '../weapons/give';
import type { GunId } from '../weapons/guns';
import type { CollisionWorld } from '../world/CollisionWorld';

type FsMod = {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc?: string): unknown;
};
type PathMod = { resolve(...p: string[]): string; join(...p: string[]): string };
const proc = (globalThis as unknown as { process: { getBuiltinModule(m: string): unknown } }).process;
const fs = proc.getBuiltinModule('node:fs') as FsMod;
const path = proc.getBuiltinModule('node:path') as PathMod;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

interface PlayedSample {
  group: SampleGroup;
  rate: number;
  startTime: number;
}

interface CreatedPanner {
  panningModel: string;
  distanceModel: string;
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
  x: number;
  y: number;
  z: number;
}

function makeParam(initial = 0) {
  return {
    value: initial,
    setValueAtTime(v: number) { this.value = v; return this; },
    linearRampToValueAtTime(v: number) { this.value = v; return this; },
    exponentialRampToValueAtTime(v: number) { this.value = v; return this; },
    setTargetAtTime(v: number) { this.value = v; return this; },
    setValueCurveAtTime(vs: Float32Array) { if (vs.length) this.value = vs[vs.length - 1]; return this; },
  };
}

function createMockWebAudio() {
  const played: PlayedSample[] = [];
  const panners: CreatedPanner[] = [];
  const bufToGroup = new Map<object, SampleGroup>();
  let time = 1.0;

  const baseNode = (ac: unknown) => ({
    context: ac,
    connect(dest: unknown) { return dest; },
    disconnect() {},
  });

  const ac = {
    get currentTime() { return time; },
    set currentTime(v: number) { time = v; },
    sampleRate: 32000,
    state: 'running' as AudioContextState,
    destination: { context: null as unknown },
    listener: {
      positionX: makeParam(0),
      positionY: makeParam(0),
      positionZ: makeParam(0),
      forwardX: makeParam(0),
      forwardY: makeParam(0),
      forwardZ: makeParam(-1),
      upX: makeParam(0),
      upY: makeParam(1),
      upZ: makeParam(0),
    },
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
    createGain() {
      return { ...baseNode(this), gain: makeParam(1) };
    },
    createBiquadFilter() {
      return { ...baseNode(this), type: 'lowpass', frequency: makeParam(350), Q: makeParam(1) };
    },
    createDynamicsCompressor() {
      return {
        ...baseNode(this),
        threshold: makeParam(-24),
        knee: makeParam(30),
        ratio: makeParam(12),
        attack: makeParam(0.003),
        release: makeParam(0.25),
      };
    },
    createWaveShaper() {
      return { ...baseNode(this), curve: null as Float32Array | null, oversample: 'none' };
    },
    createConvolver() {
      return { ...baseNode(this), buffer: null as AudioBuffer | null };
    },
    createPanner() {
      const rec: CreatedPanner = {
        panningModel: 'equalpower',
        distanceModel: 'inverse',
        refDistance: 1,
        maxDistance: 10000,
        rolloffFactor: 1,
        x: 0,
        y: 0,
        z: 0,
      };
      panners.push(rec);
      const px = { get value() { return rec.x; }, set value(v: number) { rec.x = v; }, setValueAtTime(v: number) { rec.x = v; } };
      const py = { get value() { return rec.y; }, set value(v: number) { rec.y = v; }, setValueAtTime(v: number) { rec.y = v; } };
      const pz = { get value() { return rec.z; }, set value(v: number) { rec.z = v; }, setValueAtTime(v: number) { rec.z = v; } };
      return {
        ...baseNode(this),
        get panningModel() { return rec.panningModel; },
        set panningModel(v: string) { rec.panningModel = v; },
        get distanceModel() { return rec.distanceModel; },
        set distanceModel(v: string) { rec.distanceModel = v; },
        get refDistance() { return rec.refDistance; },
        set refDistance(v: number) { rec.refDistance = v; },
        get maxDistance() { return rec.maxDistance; },
        set maxDistance(v: number) { rec.maxDistance = v; },
        get rolloffFactor() { return rec.rolloffFactor; },
        set rolloffFactor(v: number) { rec.rolloffFactor = v; },
        positionX: px,
        positionY: py,
        positionZ: pz,
        setPosition(x: number, y: number, z: number) { rec.x = x; rec.y = y; rec.z = z; },
      };
    },
    createBuffer(channels: number, length: number, sampleRate: number) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (c: number) => data[c],
      };
    },
    createBufferSource() {
      const node = {
        ...baseNode(this),
        buffer: null as AudioBuffer | null,
        loop: false,
        playbackRate: makeParam(1),
        start(when = 0) {
          if (node.buffer) {
            const grp = bufToGroup.get(node.buffer);
            if (grp) played.push({ group: grp, rate: node.playbackRate.value, startTime: when });
          }
        },
        stop() {},
      };
      return node;
    },
    createOscillator() {
      return {
        ...baseNode(this),
        type: 'sine',
        frequency: makeParam(440),
        start() {},
        stop() {},
      };
    },
  };
  ac.destination.context = ac;

  return {
    ac: ac as unknown as AudioContext,
    played,
    panners,
    bufToGroup,
    advance(dt: number) { time += dt; },
  };
}

function readWavMetrics(filePath: string) {
  const buf = fs.readFileSync(filePath) as Uint8Array;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const riff = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  const wave = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
  assert(riff === 'RIFF' && wave === 'WAVE', `Invalid WAV header: ${filePath}`);
  const audioFmt = view.getUint16(20, true);
  const ch = view.getUint16(22, true);
  const sr = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  const dataLen = view.getUint32(40, true);
  assert(audioFmt === 1 && ch === 1 && sr === 32000 && bits === 16, `Unexpected PCM params in ${filePath}: fmt=${audioFmt} ch=${ch} sr=${sr} bits=${bits}`);

  const n = Math.floor(dataLen / 2);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = view.getInt16(44 + i * 2, true) / 32768;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  const leadThresh = Math.max(0.012, peak * 0.04);
  let leadSamples = n;
  for (let i = 0; i < n; i++) {
    if (Math.abs(view.getInt16(44 + i * 2, true) / 32768) >= leadThresh) {
      leadSamples = i;
      break;
    }
  }
  return {
    dur: n / sr,
    peak,
    rms,
    leadMs: (leadSamples / sr) * 1000,
    tailPeakAfter156: (() => {
      const i0 = Math.floor(1.56 * sr);
      let tp = 0;
      for (let i = i0; i < n; i++) {
        const a = Math.abs(view.getInt16(44 + i * 2, true) / 32768);
        if (a > tp) tp = a;
      }
      return tp;
    })(),
  };
}

function auditAllAudioAssets(): Record<SampleGroup, string[]> {
  const manifestPath = path.resolve('public/audio/manifest.json');
  assert(fs.existsSync(manifestPath), `Missing manifest: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8') as string) as Record<SampleGroup, string[]>;
  const groups = Object.keys(manifest) as SampleGroup[];
  assert(groups.length >= 60, `Expected >= 60 groups in manifest.json, got ${groups.length}`);

  let clipCount = 0;
  for (const grp of groups) {
    const files = manifest[grp];
    assert(files.length > 0, `Empty file list for group ${grp}`);
    for (const rel of files) {
      const full = path.resolve('public/audio', rel);
      assert(fs.existsSync(full), `Missing audio WAV for ${grp}: ${full}`);
      const m = readWavMetrics(full);
      assert(m.dur >= 0.08, `Clip too short (${m.dur.toFixed(3)}s): ${rel}`);
      assert(m.peak >= 0.2 && m.peak <= 0.995, `Peak out of range (${m.peak.toFixed(3)}): ${rel}`);
      assert(m.rms >= 0.01, `RMS too quiet (${m.rms.toFixed(4)}): ${rel}`);
      assert(m.leadMs <= 25, `Leading silence too long (${m.leadMs.toFixed(1)}ms): ${rel}`);
      if (grp === 'gunReloadRifle') {
        assert(m.dur <= 1.65, `reload_rifle.wav still too long (${m.dur.toFixed(3)}s) — bolt rack tail must be trimmed`);
        assert(m.tailPeakAfter156 === 0, `reload_rifle.wav has signal past 1.56s`);
      }
      if (grp === 'gunMagOut' || grp === 'gunMagIn') {
        assert(m.peak >= 0.6, `${grp} clip weak: peak=${m.peak.toFixed(3)}`);
      }
      clipCount++;
    }
  }
  console.log(`[audioTest] Part 1 PASS: ${clipCount} WAV clips across ${groups.length} groups audited cleanly (0 silent/delayed clips).`);
  return manifest;
}

function testSoundEngineAndAllEvents(manifest: Record<SampleGroup, string[]>): void {
  const mock = createMockWebAudio();
  const bank = new Samples(mock.ac);
  for (const grp of Object.keys(manifest) as SampleGroup[]) {
    const buf = mock.ac.createBuffer(1, 32000, 32000);
    mock.bufToGroup.set(buf, grp);
    bank.seedForTest(grp, [buf]);
  }
  // Seed legacy sounds referenced as fallbacks
  for (const leg of ['rattle', 'magDrop', 'dry', 'swing', 'hitMetal', 'heavyHit', 'bulletMetal', 'explosion'] as SampleGroup[]) {
    const buf = mock.ac.createBuffer(1, 16000, 32000);
    mock.bufToGroup.set(buf, leg);
    bank.seedForTest(leg, [buf]);
  }

  const s = new Sound();
  s.initWithContext(mock.ac, bank);
  s.setListener(0, 1.6, 0, 0, 0, -1);

  const diag = s.getDiagnostics();
  assert(diag.ready, 'Sound not initialized');
  assert(diag.buses.weapons && diag.buses.footsteps && diag.buses.foley && diag.buses.env && diag.buses.music && diag.buses.ui, 'Missing mixer buses');
  assert(diag.panningModel === 'HRTF', 'Panner must default to HRTF');
  assert((diag.mastering.limiterRatio ?? 0) >= 18, `Brickwall limiter ratio too low: ${diag.mastering.limiterRatio}`);
  assert(diag.mastering.shaperMaxAbs <= 0.892, `Ceiling shaper exceeds -1.0 dBFS: ${diag.mastering.shaperMaxAbs}`);

  // Saturate MAX_VOICES (22) with spatial phoneRing sounds on an isolated Sound instance,
  // then prove player footsteps NEVER get dropped even when voice cap is full.
  const sSat = new Sound();
  sSat.initWithContext(mock.ac, bank);
  sSat.setListener(0, 1.6, 0, 0, 0, -1);
  for (let i = 0; i < 28; i++) sSat.phoneRing({ x: 8, y: 0, z: -3 });
  assert(sSat.getDiagnostics().activeVoices >= 22, 'Expected MAX_VOICES saturation');

  const surfaces: StepSurface[] = ['asphalt', 'concrete', 'tile', 'wood', 'metal', 'glass', 'grass', 'water'];
  const gaits: Gait[] = ['walk', 'run', 'crouch'];
  const stepsBefore = sSat.getDiagnostics().playerStepsPlayed;
  for (const surf of surfaces) {
    for (const gait of gaits) {
      sSat.step(surf, gait, { x: 0, y: 0.05, z: 0 }, 1, true);
    }
  }
  const stepsAfter = sSat.getDiagnostics().playerStepsPlayed;
  assert(stepsAfter - stepsBefore === surfaces.length * gaits.length, `Player footsteps dropped under MAX_VOICES saturation (${stepsAfter - stepsBefore}/${surfaces.length * gaits.length})`);

  // Verify HRTF panningModel on all 3D voices
  assert(mock.panners.length > 0 && mock.panners.every((p) => p.panningModel === 'HRTF'), 'All 3D PannerNodes must use HRTF');

  // Ensure each event group triggers cleanly with realistic spacing between non-simultaneous triggers.
  const expectPlayed = (fn: () => void, expectedGroup: SampleGroup, label: string) => {
    const startIdx = mock.played.length;
    fn();
    mock.advance(2.5);
    const slice = mock.played.slice(startIdx).map((p) => p.group);
    assert(slice.includes(expectedGroup), `${label}: expected ${expectedGroup}, got [${slice.join(', ')}]`);
  };

  expectPlayed(() => s.gunShot('ak', null, false, 'street'), 'shotAk', 'AK shot');
  expectPlayed(() => s.gunShot('rifle', null, false, 'indoor'), 'shotM4', 'M4 shot');
  expectPlayed(() => s.gunShot('shotgun', null, false, 'alley'), 'shotShotgun', 'Shotgun shot');
  expectPlayed(() => s.gunShot('pistol', null, false, 'street'), 'shotPistol', 'Pistol shot');
  expectPlayed(() => s.gunShot('pistol45', null, false, 'street'), 'shotPistol', 'Pistol .45 shot');
  expectPlayed(() => s.gunShot('hunting', null, false, 'street'), 'shotHunting', 'Hunting rifle shot');
  expectPlayed(() => s.gunShot('rpg', null, false, 'street'), 'shotRpg', 'RPG shot');
  expectPlayed(() => s.gunShot('ak', { x: 10, y: 0, z: -5 }, true, 'indoor'), 'shotRifleSup', 'Suppressed rifle shot');
  expectPlayed(() => s.gunShot('pistol', { x: -6, y: 0, z: 2 }, true, 'alley'), 'shotPistolSup', 'Suppressed pistol shot');
  expectPlayed(() => s.explosion({ x: 12, y: 0, z: -4 }), 'rpgExplosion', 'RPG explosion');
  expectPlayed(() => s.armorHit(), 'armorHit', 'Armor vest hit');

  // Weapons mechanics, ADS, casings, doors, glass, stamina, loot
  expectPlayed(() => s.gunMech('dry'), 'gunDry', 'Dry click');
  expectPlayed(() => s.gunMech('pump'), 'gunPump', 'Shotgun pump');
  expectPlayed(() => s.gunMech('bolt'), 'gunBolt', 'Hunting bolt');
  expectPlayed(() => s.gunMech('magCheck'), 'gunMagCheck', 'Mag check');
  expectPlayed(() => s.gunMech('reloadRifle'), 'gunReloadRifle', 'Rifle reload');
  expectPlayed(() => s.gunMech('magOut', 1.15), 'gunMagOut', 'Pistol magOut');
  expectPlayed(() => s.gunMech('magIn', 1.15), 'gunMagIn', 'Pistol magIn');
  expectPlayed(() => s.ads(false), 'adsRifle', 'ADS rifle');
  expectPlayed(() => s.ads(true), 'adsPistol', 'ADS pistol');
  expectPlayed(() => s.casing({ x: 0, y: 0, z: 0 }, false, 'asphalt'), 'casingAsphalt', 'Casing asphalt');
  expectPlayed(() => s.casing({ x: 0, y: 0, z: 0 }, false, 'wood'), 'casingWood', 'Casing wood');
  expectPlayed(() => s.casing({ x: 0, y: 0, z: 0 }, false, 'grass'), 'casingDirt', 'Casing dirt');
  expectPlayed(() => s.casing({ x: 0, y: 0, z: 0 }, false, 'metal'), 'casingMetal', 'Casing metal');
  expectPlayed(() => s.casing({ x: 0, y: 0, z: 0 }, true, 'concrete'), 'casingShotgun', 'Casing shotgun');

  s.setOcclusionCheck(() => true);
  expectPlayed(() => s.door('wood', true, { x: 4, y: 0, z: 0 }), 'doorWood', 'Door wood');
  expectPlayed(() => s.door('metal', false, { x: -4, y: 0, z: 0 }), 'doorMetal', 'Door metal');
  s.setOcclusionCheck(null);

  expectPlayed(() => s.hit('glass', { x: 3, y: 1, z: -2 }), 'glassBreak', 'Glass break');
  expectPlayed(() => s.hit('glass', { x: 3, y: 1, z: -2 }), 'glassSettle', 'Glass settle');
  expectPlayed(() => s.crouch(true, { x: 0, y: 0, z: 0 }), 'crouchDown', 'Crouch down');
  expectPlayed(() => s.crouch(false, { x: 0, y: 0, z: 0 }), 'standUp', 'Stand up');
  expectPlayed(() => s.pivot('wood', { x: 0, y: 0, z: 0 }, true), 'pivotWood', 'Pivot wood');
  expectPlayed(() => s.pivot('concrete', { x: 0, y: 0, z: 0 }, false), 'pivotConcrete', 'Pivot concrete');
  expectPlayed(() => s.pivot('grass', { x: 0, y: 0, z: 0 }, false), 'pivotDirt', 'Pivot dirt');
  expectPlayed(() => s.jump({ x: 0, y: 0, z: 0 }), 'jumpPush', 'Jump push');
  expectPlayed(() => s.land('metal', { x: 0, y: 0, z: 0 }, 5), 'landMetal', 'Land metal');
  expectPlayed(() => s.land('concrete', { x: 0, y: 0, z: 0 }, 5), 'landHard', 'Land hard');
  expectPlayed(() => s.house('creak', { x: 2, y: 1, z: 2 }), 'buildingCreak', 'House creak');
  expectPlayed(() => s.updateStamina(0.016, 0.17, 0.8, false, false), 'breathClear', 'Breath clear');
  expectPlayed(() => s.updateStamina(0.016, 0.1, 0.2, false, false), 'heartbeat', 'Heartbeat');
  expectPlayed(() => s.updateStamina(0.016, 0.17, 0.8, true, false), 'breathMask', 'Breath mask');
  expectPlayed(() => s.setLootLoop(true), 'lootSearch', 'Loot search loop');
  s.setLootLoop(false);

  // Test Firearms reload & shotgun throttling with the real global sfx bound to mock context
  sfx.initWithContext(mock.ac, bank);
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  scene.add(camera);
  let surfaceLookups = 0;
  let heldKeys = new Set<string>();
  let pressedKeys = new Set<string>();
  const mockInput = {
    moveX: 0,
    moveY: 0,
    isHeld: (k: string) => heldKeys.has(k),
    consumePressed: (k: string) => pressedKeys.delete(k),
  } as unknown as InputManager;
  const zWorld: ZombieWorld = { groundY: () => 0, resolveCircle() {}, rayHit: () => -1 };
  const sim = new ZombieSim(zWorld, 0);

  const runGunTest = (id: GunId, mag: number, chamber: boolean, doReload: boolean, doShoot: boolean) => {
    const i2 = new Inventory();
    giveLoadout(i2, id);
    const vm2 = new Viewmodel();
    const ctrl2 = new PlayerController(new Vector3(), 0);
    const p2 = { controller: ctrl2, viewmodel: vm2, busy: false, shake() {} } as unknown as FirearmsWorld['player'];
    heldKeys = new Set<string>();
    pressedKeys = new Set<string>();
    const w2: FirearmsWorld = {
      input: mockInput,
      player: p2,
      inventory: i2,
      zombies: sim,
      particles: new Particles(),
      scene,
      toast() {},
      camera,
      rayHit: () => 5,
      surface: () => { surfaceLookups++; return 'concrete'; },
      noise() {},
      groundY: () => 0,
      hurtSelf() {},
      igniteCars() {},
      carHit() {},
      handling: () => 1,
      place: () => 'street',
      surfaceAt: () => 'asphalt',
    };
    const fa = new Firearms(w2);
    const step = () => {
      mock.advance(1 / 60);
      vm2.fixedUpdate(1 / 60, false);
      fa.fixedUpdate(1 / 60);
      vm2.update(1 / 60, { lookX: 0, lookY: 0, stepPhase: 0, speed: 0, sprinting: false, flashlightOn: false });
      fa.render(1 / 60);
    };
    vm2.equip(id);
    for (let i = 0; i < 120; i++) step();
    assert(fa.state, `Failed to equip ${id}`);
    fa.state.inst.mag = mag;
    fa.state.inst.chamber = chamber;

    const pStart = mock.played.length;
    surfaceLookups = 0;
    if (doReload) {
      pressedKeys.add('reload');
      step();
    }
    if (doShoot) {
      pressedKeys.add('attack');
      heldKeys.add('attack');
      step();
      heldKeys.delete('attack');
    }
    for (let i = 0; i < 240; i++) step();
    return { played: mock.played.slice(pStart).map((p) => p.group), surfaceLookups };
  };

  // 1) Pistol empty reload must play adsPistol, gunMagOut, gunMagIn, gunBolt
  const pRes = runGunTest('pistol_g17', 0, false, true, false);
  assert(
    pRes.played.includes('adsPistol') && pRes.played.includes('gunMagOut') && pRes.played.includes('gunMagIn') && pRes.played.includes('gunBolt'),
    `Pistol reload missing sounds: [${pRes.played.join(', ')}]`,
  );

  // 2) Rifle empty reload must play gunReloadRifle and NEVER gunBolt/rattle at the end
  const rRes = runGunTest('rifle_ak', 0, false, true, false);
  assert(rRes.played.includes('gunReloadRifle'), `Rifle reload missing gunReloadRifle: [${rRes.played.join(', ')}]`);
  assert(!rRes.played.includes('gunBolt') && !rRes.played.includes('rattle'), `Rifle reload still played trailing bolt rack: [${rRes.played.join(', ')}]`);

  // 3) Shotgun 8-pellet blast against a wall must NOT run 8 surface raycasts
  const sRes = runGunTest('shotgun_pump', 6, true, false, true);
  assert(sRes.played.includes('shotShotgun'), `Shotgun shot sound did not play: [${sRes.played.join(', ')}]`);
  assert(sRes.surfaceLookups <= 2, `Shotgun performed ${sRes.surfaceLookups} surface raycasts (expected <= 2)`);

  console.log('[audioTest] Part 2 PASS: All buses, HRTF spatialization, -1.0 dBFS limiter, priority footsteps, pistol/rifle reloads, and shotgun throttling verified.');
}

function testSprintFootstepContinuity(): void {
  const c = new PlayerController(new Vector3(0, 0, 0), 0);
  const world = {
    resolveCircle() {},
    ceilingAt: () => 20,
    supportAt: () => -1e4,
    ledgeAhead: () => -1,
  } as unknown as CollisionWorld;
  const input = {
    moveX: 0,
    moveY: 1,
    isHeld: (k: string) => k === 'sprint',
    consumePressed: () => false,
  } as unknown as InputManager;

  const stepTimes: number[] = [];
  const dt = 1 / 60;
  for (let i = 0; i < 300; i++) {
    // Inject brief 2-frame curb/step-down micro-airborne flickers at ~1.5s and ~3.2s
    if (i === 90 || i === 91 || i === 192 || i === 193) {
      c.airborne = true;
      c.vy = -0.5;
    }
    c.fixedUpdate(dt, input, world, () => 0);
    if (c.stepped) stepTimes.push(i * dt);
  }

  assert(stepTimes.length >= 8 && stepTimes.length <= 12, `Unexpected sprint footstep count in 5s: ${stepTimes.length}`);
  let maxGap = 0;
  for (let i = 1; i < stepTimes.length; i++) {
    maxGap = Math.max(maxGap, stepTimes[i] - stepTimes[i - 1]);
  }
  assert(maxGap < 0.62, `Sprint footstep dropout detected: maxGap=${maxGap.toFixed(3)}s`);
  console.log(`[audioTest] Part 3 PASS: ${stepTimes.length} uninterrupted sprint footsteps over 5.0s (maxGap=${maxGap.toFixed(3)}s).`);
}

export async function main(): Promise<number> {
  const manifest = auditAllAudioAssets();
  testSoundEngineAndAllEvents(manifest);
  testSprintFootstepContinuity();
  console.log('[audioTest] ALL AUDIO AUDITS & EVENT TESTS PASSED.');
  return 0;
}
