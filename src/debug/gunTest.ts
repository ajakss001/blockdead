import './domStub';
import { PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { InputManager } from '../input/InputManager';
import { Viewmodel, type ViewmodelFrame } from '../player/Viewmodel';
import { Particles } from '../render/Particles';
import { Firearms, type FirearmsWorld } from '../systems/Firearms';
import { Inventory } from '../systems/Inventory';
import { type ZombieWorld, ZombieSim } from '../systems/zombies';
import { giveLoadout } from '../weapons/give';
import { capacityOf, damageOf, GUN_IDS, type GunId, GUNS, type ModId, noiseOf } from '../weapons/guns';
import { type AmmoSource, type GunInput, GunState, newInst } from '../weapons/gunState';
import { gunAnimations } from './animCheck';
import { gunLook, HAND_CIRCLE } from './gunChecks';
import { gunParts } from './gunParts';
import { loadCharactersNode } from './nodeCharacters';

/**
 * npm run test:guns — the firearms (CLAUDE.md «Огнестрельное оружие»): damage and the head ×2, the rounds
 * counted (tactical reload +1 in the chamber, from empty none), the suppressor's noise radius (zombies inside
 * come, outside don't), extended magazines, a shot cutting the shotgun's loading short, the front sight in the
 * middle of the screen in the sights (±2 px at 1080p) for every gun, the gun never through a wall, every gun
 * has its reload and inspect animations, pause freezes the shots' bodies and the rockets, import:assets with
 * no files leaves a working build. How each gun is held, on what is drawn (debug/gunChecks): no roll at the
 * hip and in the sights (< 2°), no pixel of a hand in the circle round the middle in the sights (15% of the
 * height across), the left hand under the bore axis, the hip low and to the right; and every model's parts
 * where they belong (debug/gunParts: no piece off the gun, the whole as long as the source model).
 */

type Fs = { existsSync(p: string): boolean; mkdtempSync(p: string): string; readFileSync(p: string, e: string): string; rmSync(p: string, o: object): void };
type Cp = { spawnSync(cmd: string, args: string[], o: object): { status: number | null; stderr: { toString(): string } } };
type Os = { tmpdir(): string };
const proc = (globalThis as unknown as { process: { getBuiltinModule(m: string): unknown; execPath: string; env: Record<string, string> } }).process;

const none: GunInput = { trigger: false, pulled: false, reload: false, mode: false, inspect: false, bash: false, canFire: true };
const frame = (o: Partial<ViewmodelFrame> = {}): ViewmodelFrame => ({ lookX: 0, lookY: 0, stepPhase: 0, speed: 0, sprinting: false, flashlightOn: false, ...o });

/** A pool of rounds and magazines the tests can count. */
function pool(rounds: number, mags: number): AmmoSource & { rounds: number; mags: number } {
  const p = {
    rounds,
    mags,
    count: () => p.rounds,
    take: (_a: string, n: number) => {
      const k = Math.min(n, p.rounds);
      p.rounds -= k;
      return k;
    },
    give: (_a: string, n: number) => {
      p.rounds += n;
    },
    spareMags: () => p.mags,
    takeMag: () => (p.mags > 0 ? (p.mags--, true) : false),
  };
  return p;
}

function runUntilIdle(gs: GunState, inp: Partial<GunInput> = {}, max = 900): void {
  gs.update(1 / 60, { ...none, ...inp });
  for (let i = 0; i < max && gs.busy; i++) gs.update(1 / 60, none);
}

/** A flat test ground with one wall across the view at z = −wallZ (or none). */
function testWorld(): { world: ZombieWorld; wallZ: { v: number } } {
  const wallZ = { v: -1 };
  return {
    wallZ,
    world: {
      groundY: () => 0,
      resolveCircle() {},
      rayHit(_ox, _oy, oz, _dx, _dy, dz, max) {
        if (wallZ.v < 0 || dz > -1e-6) return -1;
        const t = (oz + wallZ.v) / -dz;
        return t > 0 && t < max ? t : -1;
      },
    },
  };
}

export async function main(): Promise<number> {
  await loadCharactersNode();
  const fails: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) fails.push(what);
  };

  // ── The world for Firearms: a real viewmodel, inventory, zombies, a camera at the eye looking −Z. ──
  const { world, wallZ } = testWorld();
  const vm = new Viewmodel();
  vm.setBody('male', 1);
  vm.setAspect(16 / 9);
  const input = new InputManager('kbm', new EventBus<GameEvents>());
  input.setActive(true);
  const inv = new Inventory(999);
  const sim = new ZombieSim(world, 0);
  const camera = new PerspectiveCamera(70, 16 / 9, 0.05, 500);
  camera.position.set(0, 1.6, 0);
  const scene = new Scene();
  scene.add(camera);
  camera.updateMatrixWorld(true);
  const ctl = { sprinting: false, pitch: 0, yaw: 0, speed: 0, addNoise() {} };
  const player = { viewmodel: vm, controller: ctl, busy: false, zoom: 1, shake() {} };
  let selfHurt = 0;
  const w: FirearmsWorld = {
    input,
    player: player as never,
    inventory: inv,
    zombies: sim,
    particles: new Particles(),
    scene,
    camera,
    toast() {},
    rayHit: (o, d, max) => world.rayHit(o.x, o.y, o.z, d.x, d.y, d.z, max),
    surface: () => 'concrete' as never,
    noise: (x, y, z, r) => sim.noiseAt(x, y, z, r),
    groundY: () => 0,
    hurtSelf: (hp) => (selfHurt += hp),
    igniteCars() {},
    carHit() {},
    handling: () => 1,
    place: () => 'street',
  };
  const fa = new Firearms(w);
  /** One fixed step of the world with the gun (and the arms' frame). */
  const step = (f: Partial<ViewmodelFrame> = {}) => {
    vm.fixedUpdate(1 / 60, false);
    fa.fixedUpdate(1 / 60);
    vm.update(1 / 60, frame(f));
    fa.render(1 / 60);
  };
  const draw = (id: GunId, mods: ModId[] = []) => {
    inv.restore({ stacks: [], hand: null });
    giveLoadout(inv, [id, ...mods].join(','));
    vm.equip(id);
    for (let i = 0; i < 120; i++) step();
  };
  const fire = () => {
    input.press('attack');
    step();
    input.release('attack');
    step();
  };
  const exact = fa as unknown as { spread(id: GunId): number };
  const spread = exact.spread.bind(fa);

  // 1. Damage: the body takes the gun's damage, the head twice it; zombies and the player have 100 HP.
  exact.spread = () => 0;
  for (const id of GUN_IDS) {
    if (GUNS[id].cls === 'launcher') continue;
    const g = GUNS[id];
    draw(id);
    const [lo, hi] = damageOf(id, []);
    const n = g.pellets ?? 1;
    const z = sim.spawnAt(0, -5, 'idle', 'worker');
    z.yaw = 0;
    check(z.hp === 100, `${id}: zombie has 100 HP (${z.hp})`);
    // The chest: the eye at 1.6 looks level; drop the zombie so the ray meets its chest.
    z.pos.y = 1.6 - 1.25 * ZombieSim.scale(z);
    z.hp = 1e4;
    fire();
    const body = 1e4 - z.hp;
    z.pos.y = 1.6 - 1.62 * ZombieSim.scale(z);
    z.hp = 1e4;
    for (let i = 0; i < 150; i++) step();
    fire();
    const head = 1e4 - z.hp;
    check(body >= lo * n - 1e-6 && body <= hi * n + 1e-6, `${id}: body ${body.toFixed(1)} in [${lo * n}, ${hi * n}]`);
    check(head >= 2 * lo * n - 1e-6 && head <= 2 * hi * n + 1e-6, `${id}: head ${head.toFixed(1)} = ×2 [${2 * lo * n}, ${2 * hi * n}]`);
    z.state = 'dead';
    sim.list.length = 0;
    for (let i = 0; i < 90; i++) step();
  }
  // The RPG's blast: zombies near are killed, the survivor close by hurt (of 100), far not.
  {
    draw('launcher_rpg');
    const near = sim.spawnAt(0, -10, 'idle', 'worker');
    const far = sim.spawnAt(0, -30, 'idle', 'worker');
    fa.explode(new Vector3(0, 0.5, -10));
    check(near.state === 'dead' && far.state !== 'dead', 'RPG: the blast kills within its radius, not beyond');
    selfHurt = 0;
    fa.explode(new Vector3(0, 1, -3));
    check(selfHurt > 0 && selfHurt < 100, `RPG: the survivor 3 m from the blast hurt ${selfHurt.toFixed(0)} of 100`);
    selfHurt = 0;
    fa.explode(new Vector3(0, 1, -20));
    check(selfHurt === 0, 'RPG: 20 m away — unhurt');
    sim.list.length = 0;
  }
  exact.spread = spread;

  // 2. The rounds counted: tactical reload +1 in the chamber, from empty none; nothing lost or made.
  for (const id of GUN_IDS) {
    const g = GUNS[id];
    if (g.feed !== 'mag') continue;
    const cap = g.capacity;
    const p = pool(100, 3);
    const inst = newInst(id, cap + 1);
    const gs = new GunState(id, inst, p);
    runUntilIdle(gs);
    // Shoot some.
    for (let i = 0; i < 5; i++) {
      runUntilIdle(gs, { pulled: true, trigger: true });
      for (let k = 0; k < 30; k++) gs.update(1 / 60, none);
    }
    const before = p.rounds + gs.loaded;
    runUntilIdle(gs, { reload: true });
    check(gs.loaded === cap + 1, `${id}: tactical reload → ${gs.loaded} = ${cap} + 1 in the chamber`);
    check(p.rounds + gs.loaded === before, `${id}: tactical reload counts every round (${before} → ${p.rounds + gs.loaded})`);
    // Empty it.
    for (let i = 0; i < 200 && gs.loaded > 0; i++) {
      gs.update(1 / 60, { ...none, pulled: true, trigger: true });
      gs.update(1 / 60, none);
      for (let k = 0; k < 20; k++) gs.update(1 / 60, none);
    }
    const mags = p.mags;
    const pre = p.rounds;
    runUntilIdle(gs, { reload: true });
    check(gs.loaded === cap && inst.chamber && inst.mag === cap - 1, `${id}: empty reload → ${gs.loaded} = ${cap}, no +1`);
    check(pre - p.rounds === cap && p.mags === mags - 1, `${id}: empty reload takes ${cap} rounds and a spare magazine (the empty one drops)`);
  }

  // 3. The suppressor: zombies inside its radius come, outside don't; without it both do.
  {
    const id: GunId = 'rifle_m4a1';
    const loud = noiseOf(id, []);
    const quiet = noiseOf(id, ['mod_suppressor']);
    check(Math.abs(quiet - loud * 0.3) < 1e-6, `suppressor: noise ${loud} → ${quiet} m (−70%)`);
    check(Math.abs(damageOf(id, ['mod_suppressor'])[0] - damageOf(id, [])[0] * 0.9) < 1e-6, 'suppressor: damage −10%');
    for (const mods of [['mod_suppressor'], []] as ModId[][]) {
      sim.list.length = 0;
      draw(id, mods);
      // Behind the survivor (the shot is not at them) at 0.6 and 1.4 of the suppressed radius.
      const a = sim.spawnAt(0, quiet * 0.6, 'idle', 'worker');
      const b = sim.spawnAt(0, quiet * 1.4, 'idle', 'worker');
      fire();
      const tag = mods.length ? 'suppressed' : 'loud';
      check(a.state === 'investigate', `${tag}: zombie at ${(quiet * 0.6).toFixed(0)} m comes to the shot`);
      if (mods.length) check(b.state !== 'investigate' && b.state !== 'chase', `suppressed: zombie at ${(quiet * 1.4).toFixed(0)} m doesn't hear it`);
      else check(b.state === 'investigate', `loud: zombie at ${(quiet * 1.4).toFixed(0)} m comes too`);
    }
    sim.list.length = 0;
  }

  // 4. Extended magazines.
  for (const [id, mod, n] of [
    ['rifle_m4a1', 'mod_ext_mag_m4', 40],
    ['rifle_ak', 'mod_ext_mag_ak', 40],
    ['pistol_g17', 'mod_ext_mag_g17', 33],
  ] as [GunId, ModId, number][]) {
    const p = pool(200, 2);
    const inst = newInst(id, 0);
    inst.mods = [mod];
    const gs = new GunState(id, inst, p);
    runUntilIdle(gs);
    runUntilIdle(gs, { reload: true });
    check(capacityOf(id, inst.mods) === n && gs.loaded === n, `${MOD_NAME(mod)}: ${id} holds ${gs.loaded} (want ${n})`);
    runUntilIdle(gs, { reload: true });
    check(gs.loaded === n + 1, `${MOD_NAME(mod)}: tactical reload ${gs.loaded} = ${n} + 1`);
  }

  // 5. A shot cuts the shotgun's loading short (after the shell in hand); the pump after each shot.
  {
    const id: GunId = 'shotgun_pump';
    const p = pool(50, 0);
    const inst = newInst(id, 2);
    const gs = new GunState(id, inst, p);
    runUntilIdle(gs);
    gs.update(1 / 60, { ...none, reload: true });
    let shot = false;
    let t = 0;
    let pulled = false;
    let loadedAtPull = 0;
    const acts = new Set<string>();
    for (let i = 0; i < 900 && !shot; i++) {
      const pull = !pulled && gs.action === 'loadOne' && gs.t > gs.duration * 0.3;
      if (pull) {
        pulled = true;
        loadedAtPull = gs.loaded;
      }
      for (const e of gs.update(1 / 60, { ...none, pulled: pull, trigger: pull || (pulled && !shot) })) if (e.kind === 'shot') shot = true;
      acts.add(gs.action);
      t += 1 / 60;
    }
    check(shot && loadedAtPull + 1 < GUNS[id].capacity, `shotgun: a pull while loading fires after the shell in hand (${loadedAtPull + 1} of ${GUNS[id].capacity} loaded, ${t.toFixed(2)} s)`);
    let pumped = false;
    for (let i = 0; i < 120; i++) {
      gs.update(1 / 60, none);
      if (gs.action === 'cycle') pumped = true;
    }
    check(pumped, 'shotgun: the pump after the shot');
  }
  // The bolt after each shot of the hunting rifle.
  {
    const gs = new GunState('rifle_hunting', newInst('rifle_hunting', 5), pool(10, 0));
    runUntilIdle(gs);
    let bolt = 0;
    for (let s = 0; s < 3; s++) {
      gs.update(1 / 60, { ...none, pulled: true, trigger: true });
      let was = gs.action;
      for (let i = 0; i < 120; i++) {
        gs.update(1 / 60, none);
        if (gs.action === 'cycle' && was !== 'cycle') bolt++;
        was = gs.action;
      }
    }
    check(bolt === 3, `hunting rifle: the bolt after each of 3 shots (${bolt})`);
  }

  // 6. The front sight in the middle of the screen in the sights: ±2 px at 1920×1080, every gun.
  {
    const W = 1920;
    const H = 1080;
    for (const id of GUN_IDS) {
      draw(id);
      vm.gunView.ads = true;
      vm.gunView.wall = 0;
      let worst = 0;
      for (let i = 0; i < 90; i++) {
        vm.fixedUpdate(1 / 60, false);
        vm.update(1 / 60, frame());
        if (i < 40) continue;
        const gm = vm.gunModel!;
        gm.root.updateWorldMatrix(true, false);
        const s = new Vector3(...gm.sockets.sightF).applyMatrix4(gm.root.matrixWorld);
        vm.camera.updateMatrixWorld(true);
        const v = s.clone().project(vm.camera);
        worst = Math.max(worst, Math.hypot((v.x * W) / 2, (v.y * H) / 2));
      }
      check(worst <= 2, `${id}: front sight in the sights ${worst.toFixed(2)} px from the middle (≤ 2)`);
      vm.gunView.ads = false;
    }
  }

  // 6b. How it is held (the rules), at the hip and in the sights, every gun.
  for (const id of GUN_IDS) {
    draw(id);
    vm.gunView.wall = 0;
    for (const ads of [false, true]) {
      vm.gunView.ads = ads;
      for (let i = 0; i < 90; i++) {
        vm.fixedUpdate(1 / 60, false);
        vm.update(1 / 60, frame());
      }
      const l = gunLook(vm, id);
      const tag = `${id} ${ads ? 'sights' : 'hip'}`;
      check(Math.abs(l.roll) < 2, `${tag}: roll ${l.roll.toFixed(2)}° (< 2°)`);
      if (ads) check(Math.abs(l.roll) < 1 && Math.abs(l.pitch) < 1, `${tag}: roll ${l.roll.toFixed(2)}°, pitch ${l.pitch.toFixed(2)}° (both < 1°)`);
      check(l.nearCut === 0, `${tag}: arm triangles cut by the near plane in the frame ${l.nearCut} (nearest ${l.nearest} m)`);
      if (ads) check(l.handPx === 0, `${tag}: hand pixels in the middle circle (r ${HAND_CIRCLE.toFixed(0)} px at 1080p) ${l.handPx}`);
      check(l.palmBelow > 0.02, `${tag}: left palm ${(l.palmBelow * 100).toFixed(1)} cm under the bore axis`);
      if (!ads && GUNS[id].cls !== 'launcher') check(l.muzzle[0] > 0 && l.muzzle[1] < 0, `${tag}: muzzle in the lower right quarter (${l.muzzle.join(', ')})`);
    }
    vm.gunView.ads = false;
  }
  // 6c. The models' parts together (no piece off the gun, the whole the source's size).
  for (const r of await gunParts()) check(r.ok, r.what);

  // 7. Never through a wall: walking up to a wall, the muzzle stays on this side (hip and sights).
  for (const id of GUN_IDS) {
    draw(id);
    let worst = -1;
    let worstAt = '';
    for (const ads of [false, true]) {
      vm.gunView.ads = ads;
      input[ads ? 'press' : 'release']('aim');
      // From 1.6 m to the closest the body lets the eye come (the player's radius).
      for (let d = 1.6; d >= 0.3; d -= 0.01) {
        wallZ.v = d;
        step();
        const gm = vm.gunModel!;
        gm.root.updateWorldMatrix(true, false);
        const m = gm.muzzle(new Vector3()).applyMatrix4(gm.root.matrixWorld);
        // In the arms' space the eye is the origin looking −Z: depth beyond the wall's plane.
        if (-m.z - d > worst) (worst = -m.z - d), (worstAt = `${ads ? 'sights' : 'hip'}, wall at ${d.toFixed(2)} m`);
      }
      // And at the wall, no shot: the trigger does nothing.
      const before = fa.state!.loaded;
      fire();
      check(fa.state!.loaded === before, `${id}${ads ? ' (sights)' : ''}: no shot against a wall`);
    }
    input.release('aim');
    wallZ.v = -1;
    check(worst < 0, `${id}: the muzzle never through the wall (${(worst * 100).toFixed(1)} cm${worst >= 0 ? `, ${worstAt}` : ''})`);
  }

  // 8. Every gun has its reload, inspect, checkMag, and checkChamber animations (and checks preserve ammo).
  for (const id of GUN_IDS) {
    const a = gunAnimations(vm, id);
    const reload = GUNS[id].feed === 'mag' ? ['reload', 'reloadEmpty'] : GUNS[id].feed === 'rocket' ? ['reload'] : ['load'];
    const req = [...reload, 'inspect', 'checkMag', 'checkChamber'];
    check(req.every((k) => (a[k]?.length ?? 0) > 10), `${id}: animations ${req.join(', ')}`);
  }
  {
    const p = pool(90, 3);
    const inst = newInst('rifle_ak', 22);
    const gs = new GunState('rifle_ak', inst, p);
    runUntilIdle(gs);
    const before = gs.loaded;
    const evMag: string[] = [];
    let dropped = false;
    gs.update(1 / 60, { ...none, checkMag: true }).forEach((e) => evMag.push(e.kind));
    for (let i = 0; i < 400 && gs.busy; i++) {
      for (const e of gs.update(1 / 60, none)) {
        evMag.push(e.kind);
        if (e.kind === 'magOut' && e.drop) dropped = true;
      }
    }
    check(gs.loaded === before && p.rounds === 90 && !dropped && evMag.includes('magCheckRead') && evMag.includes('magIn'), 'checkMag preserves ammo, never drops mag, emits magCheckRead + magIn');
    let readLoaded = false;
    const evCh: string[] = [];
    gs.update(1 / 60, { ...none, checkChamber: true }).forEach((e) => evCh.push(e.kind));
    for (let i = 0; i < 400 && gs.busy; i++) {
      for (const e of gs.update(1 / 60, none)) {
        evCh.push(e.kind);
        if (e.kind === 'chamberCheckRead') readLoaded = e.loaded && !e.jammed;
      }
    }
    check(gs.loaded === before && readLoaded && evCh.includes('chamberPull') && evCh.includes('chamberClose'), 'checkChamber preserves ammo & reports live chamber status');
  }

  // 9. Pause: no world time — the cases, magazines and rockets hold still, the gun's action doesn't go on.
  {
    draw('rifle_ak');
    fa.fx.eject(new Vector3(0, 1.5, -0.5), new Vector3(1, 0, 0), new Vector3(0, 1, 0), false);
    fa.fx.dropMag(new Vector3(0, 1.4, -0.4), new Quaternion(), new Vector3());
    const fx = fa.fx as unknown as { cases: { pos: Vector3 }[]; mags: { pos: Vector3 }[] };
    for (let i = 0; i < 3; i++) {
      fire();
      for (let k = 0; k < 10; k++) step();
    }
    input.press('reload');
    step();
    input.release('reload');
    step();
    const c0 = fx.cases.at(-1)!.pos.clone();
    const m0 = fx.mags.at(-1)!.pos.clone();
    const gs = fa.state!;
    const t0 = gs.t;
    for (let i = 0; i < 300; i++) fa.render(0);
    check(fx.cases.at(-1)!.pos.equals(c0) && fx.mags.at(-1)!.pos.equals(m0), 'pause: cases and magazines hold still');
    check(gs.t === t0 && gs.busy, 'pause: the reload waits (no fixed steps while paused)');
    // Rockets: a launch, paused frames, it stays.
    draw('launcher_rpg');
    const rk = fa as unknown as { rockets: { pos: Vector3 }[]; launch(): void };
    rk.launch();
    const r0 = rk.rockets[0].pos.clone();
    for (let i = 0; i < 300; i++) fa.render(0);
    check(rk.rockets[0].pos.equals(r0), 'pause: the rocket holds in the air');
    rk.rockets.length = 0;
  }

  // 11. The RPG's one loaded state: the rocket in the tube, the HUD and the trigger agree at every step.
  {
    draw('launcher_rpg');
    const id: GunId = 'launcher_rpg';
    const rocketShown = () => (vm as unknown as { guns: Map<GunId, { model: { parts: { rocket: { visible: boolean } } } }> }).guns.get(id)!.model.parts.rocket.visible;
    const view = (tag: string) => {
      const h = fa.hud()!;
      const reloadMsg = h.mag === 0 && !h.reloading && h.reserve > 0;
      return { tag, loaded: fa.state!.inst.chamber, rocket: rocketShown(), mag: h.mag, reserve: h.reserve, reloadMsg, reloading: h.reloading };
    };
    const agree = (v: ReturnType<typeof view>, loaded: boolean) =>
      check(
        v.loaded === loaded && v.rocket === loaded && v.mag === (loaded ? 1 : 0) && v.reloadMsg === (!loaded && !v.reloading),
        `RPG ${v.tag}: loaded ${v.loaded}, rocket ${v.rocket ? 'shown' : 'hidden'}, HUD ${v.reloadMsg ? '«Перезарядка»' : `${v.mag} / ${v.reserve}`}`,
      );
    agree(view('drawn'), true);
    const fired0 = fa.state!.inst.chamber;
    fire();
    for (let i = 0; i < 20; i++) step();
    agree(view('after the shot'), false);
    check(fired0 && !fa.state!.inst.chamber, 'RPG: the shot fired from the loaded state');
    fire();
    for (let i = 0; i < 5; i++) step();
    check(!fa.state!.inst.chamber && (fa as unknown as { rockets: unknown[] }).rockets.length === 1, 'RPG: empty — the trigger does nothing');
    input.press('reload');
    step();
    input.release('reload');
    step();
    check(fa.state!.busy, 'RPG: R starts the reload');
    // Every frame of the reload: the model and the HUD read the same state.
    let mismatch = 0;
    for (let i = 0; i < 60 * 6 && fa.state!.busy; i++) {
      step();
      const v = view('reload');
      if (v.rocket !== v.loaded && !(vm as unknown as { gunView: { action: string } }).gunView.action.startsWith('reload')) mismatch++;
      if (v.mag !== (v.loaded ? 1 : 0)) mismatch++;
    }
    for (let i = 0; i < 30; i++) step();
    check(mismatch === 0, `RPG reload: HUD and loaded state agree every frame (${mismatch} mismatches)`);
    agree(view('after the reload'), true);
    (fa as unknown as { rockets: unknown[] }).rockets.length = 0;
    fire();
    for (let i = 0; i < 20; i++) step();
    agree(view('after the second shot'), false);
    (fa as unknown as { rockets: unknown[] }).rockets.length = 0;
  }

  // 10. import:assets with no files: the stand-ins, a manifest, no failure.
  {
    const fs = proc.getBuiltinModule('node:fs') as Fs;
    const cp = proc.getBuiltinModule('node:child_process') as Cp;
    const os = proc.getBuiltinModule('node:os') as Os;
    const empty = fs.mkdtempSync(`${os.tmpdir()}/bd-in-`);
    const out = fs.mkdtempSync(`${os.tmpdir()}/bd-out-`);
    const r = cp.spawnSync(proc.execPath, ['tools/import-assets.mjs'], { env: { ...proc.env, WEAPONS_IN: empty, WEAPONS_OUT: out }, encoding: 'utf8' });
    const manifest = `${out}/weapons.json`;
    const ok = r.status === 0 && fs.existsSync(manifest);
    let parsed = false;
    try {
      JSON.parse(fs.readFileSync(manifest, 'utf8'));
      parsed = true;
    } catch {
      /* checked below */
    }
    check(ok && parsed, `import:assets with no files: exit ${r.status}, manifest ${parsed ? 'written' : 'missing'}${r.status ? ' — ' + r.stderr.toString().slice(0, 200) : ''}`);
    fs.rmSync(empty, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }

  fa.dispose();
  vm.dispose();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  return fails.length ? 1 : 0;
}

function MOD_NAME(m: ModId): string {
  return m.replace('mod_', '');
}
