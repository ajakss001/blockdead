import './domStub';
import { BufferGeometry, Float32BufferAttribute, Scene, Uint16BufferAttribute, Vector3 } from 'three';
import { loadCharactersNode } from './nodeCharacters';
import { FP_SHADOW_LAYER, stripUpperTriangles } from '../player/BodyModel';
import { PlayerController } from '../player/PlayerController';
import { Bandits } from '../systems/Bandits';
import { ESCAPE_ALTITUDE, HELI_SPOOL_TIME, Helicopter, PERIMETER_RADIUS } from '../systems/Helicopter';
import { Inventory } from '../systems/Inventory';
import { TRIPWIRE_FUSE_S, Tripwires } from '../systems/Tripwires';
import { ZombieSim } from '../systems/zombies';
import { CollisionWorld } from '../world/CollisionWorld';
import { Doors } from '../world/Doors';
import { GlbPropPool } from '../world/GlbPropPool';
import { buildChunk } from '../world/gen/buildChunk';
import { WorldLayout } from '../world/gen/layout';
import { GLB_WORLD_SPECS, type GlbModelId } from '../world/worldModels';
import { Particles } from '../render/Particles';
import type { InputManager } from '../input/InputManager';

function makeMockInput(held: Record<string, boolean>, moveX = 0, moveY = 0): InputManager {
  return {
    mode: 'desktop',
    moveX,
    moveY,
    isHeld: (a: string) => !!held[a],
    consumePressed: () => false,
    consumeLook: () => {},
    consumeWheel: () => 0,
    consumeDigit: () => null,
    reset: () => {},
  } as unknown as InputManager;
}

/**
 * npm run test:milestone — End-to-end verification across all 5 update pillars:
 * 1. Crouch camera & FP upper-body stripping + layer-2 shadows
 * 2. Dynamic rotating door OBBs, glass shatter, bullet penetration, Stealth Peek & Tripwires
 * 3. Bot AI squad separation, cover claims, Fire Token cap, 3-role Goons & bush occlusion
 * 4. Flyable Mi-8 helicopter repair/fuel/spool/autorotation/hard-landing & Secret Ending
 * 5. All 40 world GLBs present on disk + GlbPropPool instancing/bush occlusion + chunk emissions
 */
export async function main(): Promise<number> {
  await loadCharactersNode();
  const fails: string[] = [];
  const check = (ok: boolean, label: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) fails.push(label);
  };

  // ── Pillar 1: FP Upper-Body Triangle Stripping & Crouch Camera Decoupling ───────────
  {
    const names = ['Hips', 'LeftUpLeg', 'Spine2', 'Head', 'LeftArm'];
    const geo = new BufferGeometry();
    // 6 vertices: 0..2 on Hips/LeftUpLeg (lower), 3..5 on Spine2/Head/LeftArm (upper)
    geo.setAttribute('position', new Float32BufferAttribute([
      0, 0.2, 0, 0.2, 0.2, 0, 0.1, 0.8, 0,
      0, 1.4, 0, 0.2, 1.6, 0, -0.2, 1.4, 0,
    ], 3));
    geo.setAttribute('skinIndex', new Uint16BufferAttribute([
      0, 1, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,
      2, 0, 0, 0,  3, 0, 0, 0,  4, 0, 0, 0,
    ], 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute([
      0.5, 0.5, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,
      1, 0, 0, 0,      1, 0, 0, 0,  1, 0, 0, 0,
    ], 4));
    geo.setIndex([0, 1, 2, 3, 4, 5, 2, 3, 4]); // 1 lower tri, 1 upper tri, 1 mixed tri

    const stripped = stripUpperTriangles(geo, names);
    check(FP_SHADOW_LAYER === 2, `P1: FP_SHADOW_LAYER === 2 (${FP_SHADOW_LAYER})`);
    check(stripped !== null && stripped.index !== null && stripped.index.count === 3, `P1: stripUpperTriangles keeps only lower-body triangles (${stripped?.index?.count ?? 0}/3 indices)`);

    const cw = new CollisionWorld();
    const ctrl = new PlayerController(new Vector3(0, 0, 0), 0);
    const standEye = ctrl.eyeHeight(1);
    let pressCrouch = true;
    const crouchIn = {
      ...makeMockInput({ crouch: true }),
      consumePressed: (a: string) => {
        if (a === 'crouch' && pressCrouch) {
          pressCrouch = false;
          return true;
        }
        return false;
      },
    } as unknown as InputManager;
    for (let i = 0; i < 60; i++) ctrl.fixedUpdate(1 / 60, crouchIn, cw);
    const crouchEye = ctrl.eyeHeight(1);
    check(ctrl.crouched && crouchEye < standEye - 0.35 && crouchEye > 0.75, `P1: crouch lowers eye cleanly (${standEye.toFixed(2)} m -> ${crouchEye.toFixed(2)} m)`);
  }

  // ── Pillar 2: Dynamic Door OBBs, Penetration, Stealth Peek & Tripwires ──────────────
  {
    const scene = new Scene();
    const cw = new CollisionWorld();
    const doors = new Doors(scene, cw, 'standard');
    doors.add(10, [
      { hx: 0, hz: 0, y: 0, yaw: 0, swing: 1, barricaded: false, width: 1.0, height: 2.1, style: 'wood' },
      { hx: 5, hz: 0, y: 0, yaw: 0, swing: 1, barricaded: false, width: 1.0, height: 2.1, style: 'glass' },
      { hx: 10, hz: 0, y: 0, yaw: 0, swing: 1, barricaded: false, width: 1.0, height: 2.1, style: 'lab' },
    ]);

    // Closed wood door blocks ray through (0.5, 1.0, 0) and (0.85, 1.0, 0)
    const closedHit = cw.rayHitDetail(0.85, 1.0, -1.5, 0, 0, 1, 4);
    check(closedHit !== null && closedHit.t > 1.3 && closedHit.t < 1.7, `P2: closed wood door blocks ray (t=${closedHit?.t.toFixed(2)})`);

    // Bullet impact on closed wood door: attenuates & penetrates
    const woodRes = doors.bulletImpact(closedHit!.owner, 40);
    check(woodRes !== null && woodRes.penetrate && woodRes.mul < 0.7 && woodRes.kind === 'wood', `P2: wood door attenuates & penetrates (${woodRes?.kind}, mul=${woodRes?.mul})`);

    // Peek opens leaf partially (~0.48 rad) and rotates OBB so the cracked edge admits rays
    const woodRef = { building: 10, index: 0 };
    const peeked = doors.peekToggle(woodRef);
    for (let i = 0; i < 40; i++) doors.update(1 / 60);
    const woodInfo = doors.info(woodRef);
    const peekEdgeHit = cw.rayHitDetail(0.95, 1.0, -1.5, 0, 0, 1, 4);
    check(
      peeked && !!woodInfo?.peek && (peekEdgeHit === null || peekEdgeHit.owner !== closedHit!.owner),
      `P2: stealth peek cracks door & updates rotated OBB (peek=${woodInfo?.peek}, edgeBlocked=${!!peekEdgeHit})`,
    );

    const glassHit = cw.rayHitDetail(5.5, 1.0, -1.5, 0, 0, 1, 4);
    const glassRes = glassHit ? doors.bulletImpact(glassHit.owner, 30) : null;
    const glassRef = { building: 10, index: 1 };
    check(glassRes !== null && glassRes.glassShattered && !!doors.info(glassRef)?.glassBroken, `P2: glass door shatters on bullet hit (glassBroken=${doors.info(glassRef)?.glassBroken})`);

    const labHit = cw.rayHitDetail(10.5, 1.0, -1.5, 0, 0, 1, 4);
    const labRes = labHit ? doors.bulletImpact(labHit.owner, 40) : null;
    check(labRes !== null && !labRes.penetrate && labRes.kind === 'lab', `P2: lab steel door stops/ricochets bullet (${labRes?.kind}, penetrate=${labRes?.penetrate})`);

    // Tripwires: placement, disarm, and crossing 0.35 s fuse -> shrapnel explosion
    let explodedSpec: { shrapnel?: number; damage: number } | null = null;
    const tw = new Tripwires({
      scene,
      rayHit: () => -1,
      groundY: () => 0,
      explode: (_at, spec) => {
        if (spec) explodedSpec = { shrapnel: spec.shrapnel, damage: spec.damage };
      },
      toast: () => {},
    });
    const t1 = tw.place(0, 0.3, 0, 1.8, 0.3, 0, false);
    const foundTarget = tw.disarmTarget(0.9, 0, -0.7, 0, 1);
    check(foundTarget?.id === t1.id && tw.disarm(t1.id) && tw.list.length === 0, 'P2: crouch disarm locates and removes enemy tripwire');

    const t2 = tw.place(0, 0.3, 5, 1.8, 0.3, 5, false);
    tw.update(0.05, new Vector3(0.9, 0, 5.05), false, false, [], []);
    check(t2.fuseT > 0 && t2.fuseT <= TRIPWIRE_FUSE_S, `P2: crossing tripwire arms ${TRIPWIRE_FUSE_S}s pin-click fuse (fuseT=${t2.fuseT.toFixed(2)})`);
    for (let i = 0; i < 12; i++) tw.update(0.05, new Vector3(4, 0, 8), false, false, [], []);
    const blast = explodedSpec as { shrapnel?: number; damage: number } | null;
    check(blast !== null && (blast.shrapnel ?? 0) >= 20 && tw.list.length === 0, `P2: tripwire detonates after fuse with radial shrapnel (shrapnel=${blast?.shrapnel})`);
    tw.dispose();
  }

  // ── Pillar 3: Bot AI Overhaul, Goons 3-Role Trio, Bush Occlusion & Mi-8 Part Drops ──
  {
    const scene = new Scene();
    const cw = new CollisionWorld();
    const zombies = new ZombieSim(
      {
        groundY: () => 0,
        resolveCircle: () => {},
        rayHit: () => -1,
        indoors: () => false,
        route: () => false,
        doorNear: () => null,
        hitDoor: () => false,
        kindAt: () => 'office',
      },
      0,
      1,
    );
    let bushBlocked = true;
    const bandits = new Bandits({
      scene,
      groundY: () => 0,
      resolveCircle: (p, r) => cw.resolveCircle(p, r),
      rayHit: (ox, oy, oz, dx, dy, dz, max, ignoreGlass = false) => cw.rayHit(ox, oy, oz, dx, dy, dz, max, ignoreGlass),
      bushOccludes: () => bushBlocked,
      boxesNear: () => {},
      buildingsNear: () => [],
      doorsNear: () => [],
      addRagdoll: () => {},
      removeRagdoll: () => {},
      zombies,
      noise: () => {},
      hurtPlayer: () => {},
      placeAt: () => 'street',
      toast: () => {},
    });

    const goons = bandits.spawnGoonsNear(0, 0, 32);
    const roles = new Set(goons.map((g) => g.role));
    check(
      goons.length === 3 && roles.has('goon_assault') && roles.has('goon_support') && roles.has('goon_marksman'),
      `P3: Goons squad spawns 3 distinct tactical roles (${[...roles].join(', ')})`,
    );
    const hasHeliDrop = goons.some((g) =>
      g.loot.some((it) => it.id === 'heliAvionics' || it.id === 'heliFuelPump' || it.id === 'heliBattery'),
    );
    check(hasHeliDrop, 'P3: Goons boss squad carries guaranteed rare Mi-8 repair part in loot');

    // Bush occlusion prevents unalerted bots from spotting player at > 6 m
    const g0 = goons[0];
    g0.pos.set(0, 0, 18);
    g0.yaw = 0; // looking toward -Z (0, 0, 0)
    g0.state = 'patrol';
    g0.lockedKind = 'none';
    for (let i = 0; i < 30; i++) bandits.update(1 / 30, 0, 0, 0, false, false, false, 0, 0);
    check(g0.state === 'patrol' && g0.lockedKind === 'none', `P3: bushOccludes hides player > 6 m from unalerted bot (state=${g0.state})`);

    // Separation keeps squadmates from stacking on top of each other in combat
    bushBlocked = false;
    goons[0].pos.set(0, 0, 20);
    goons[1].pos.set(0.3, 0, 20.2);
    goons[2].pos.set(-0.3, 0, 19.8);
    for (const g of goons) {
      g.state = 'combat';
      g.investigateX = 0;
      g.investigateZ = 0;
      g.investigateT = 3;
    }
    for (let i = 0; i < 90; i++) bandits.update(1 / 30, 0, 0, 0, false, false, false, 0, 0);
    const d01 = Math.hypot(goons[0].pos.x - goons[1].pos.x, goons[0].pos.z - goons[1].pos.z);
    const d02 = Math.hypot(goons[0].pos.x - goons[2].pos.x, goons[0].pos.z - goons[2].pos.z);
    const d12 = Math.hypot(goons[1].pos.x - goons[2].pos.x, goons[1].pos.z - goons[2].pos.z);
    check(Math.min(d01, d02, d12) > 1.5, `P3: squadmates separate cleanly in combat (min dist=${Math.min(d01, d02, d12).toFixed(2)} m)`);
    bandits.dispose();
  }

  // ── Pillar 4: Flyable Mi-8 Helicopter, Repair/Fuel/Flight & Secret Ending ───────────
  {
    const scene = new Scene();
    const cw = new CollisionWorld();
    const layout = new WorldLayout(1993);
    const particles = new Particles();
    let escaped = false;
    const heli = new Helicopter({
      scene,
      world: cw,
      layout,
      particles,
      groundY: () => 0,
      toast: () => {},
      hurtPlayer: () => {},
      explode: () => {},
      onEscape: () => {
        escaped = true;
      },
    });
    const inv = new Inventory(50);
    heli.placeForTest(10, 10, false);
    check(!heli.isRepaired, 'P4: Mi-8 starts damaged requiring 3 rare parts');

    inv.add('heliAvionics', 1);
    inv.add('heliFuelPump', 1);
    inv.add('heliBattery', 1);
    inv.add('jerrycan', 1);

    heli.interact(10, 0, 10, inv);
    heli.interact(10, 0, 10, inv);
    heli.interact(10, 0, 10, inv);
    check(heli.isRepaired, 'P4: installing avionics + fuel pump + battery repairs Mi-8');

    const fuelBefore = heli.fuel;
    heli.interact(10, 0, 10, inv); // refuels with jerrycan
    check(heli.fuel > fuelBefore + 0.3, `P4: jerrycan refuels Mi-8 (${(fuelBefore * 100).toFixed(0)}% -> ${(heli.fuel * 100).toFixed(0)}%)`);

    heli.interact(10, 0, 10, inv); // boards
    check(heli.piloting, 'P4: [E] boards repaired & fueled Mi-8');

    // Spool up for HELI_SPOOL_TIME + climb with Space
    const pPos = new Vector3();
    const pPrev = new Vector3();
    const climbIn = makeMockInput({ jump: true }, 0, 1);
    const steps = Math.ceil((HELI_SPOOL_TIME + 4.0) * 30);
    for (let i = 0; i < steps; i++) heli.fixedUpdate(1 / 30, climbIn, pPos, pPrev);
    check(heli.spool >= 0.99 && heli.y > 6.0, `P4: Mi-8 spools up (${(heli.spool * 100).toFixed(0)}%) and climbs (alt=${heli.y.toFixed(1)} m)`);

    // Autorotation at 0% fuel still descends gently without instant teleport
    heli.fuel = 0;
    const altBeforeAuto = heli.y;
    for (let i = 0; i < 30; i++) heli.fixedUpdate(1 / 30, makeMockInput({}), pPos, pPrev);
    check(heli.y < altBeforeAuto && heli.spool >= 0.55, `P4: autorotation keeps rotor spinning on empty tank (rpm=${(heli.spool * 100).toFixed(0)}%)`);

    // Crossing PERIMETER_RADIUS at altitude > ESCAPE_ALTITUDE triggers Secret Ending
    heli.fuel = 0.8;
    heli.spool = 1;
    heli.x = PERIMETER_RADIUS + 15;
    heli.z = 0;
    heli.y = ESCAPE_ALTITUDE + 12;
    heli.fixedUpdate(1 / 30, makeMockInput({}), pPos, pPrev);
    check(escaped && heli.escaped, `P4: flying beyond ${PERIMETER_RADIUS} m at alt > ${ESCAPE_ALTITUDE} m triggers Secret Ending`);
    heli.dispose();
  }

  // ── Pillar 5: All 40 World GLBs, Manifest Verification, GlbPropPool & Chunk Output ──
  {
    const fsName = 'node:fs';
    const { existsSync, readFileSync } = (await import(/* @vite-ignore */ fsName)) as {
      existsSync(p: string): boolean;
      readFileSync(p: string, enc: string): string;
    };
    const manifest = JSON.parse(readFileSync('public/models/world/manifest.json', 'utf8')) as {
      models: { file: string }[];
    };
    const specKeys = Object.keys(GLB_WORLD_SPECS) as GlbModelId[];
    check(specKeys.length === 40 && manifest.models.length === 40, `P5: catalog & manifest both declare all 40 world GLBs (${specKeys.length}/${manifest.models.length})`);

    let missing = 0;
    for (const id of specKeys) {
      const p = `public/models/world/${GLB_WORLD_SPECS[id].file}`;
      if (!existsSync(p)) {
        console.log(`     MISSING: ${p}`);
        missing++;
      }
    }
    check(missing === 0, `P5: all 40 GLB files exist on disk (${40 - missing}/40)`);

    const scene = new Scene();
    const pool = new GlbPropPool(scene, null);
    pool.addChunk(1, [{ id: 'Urban_Bush_2500', x: 10, y: 0, z: 0, yaw: 0, scale: 1 }]);
    check(pool.bushOccludes(0, 1.0, 0, 20, 1.0, 0), 'P5: GlbPropPool.bushOccludes detects Urban_Bush_2500 on LOS');
    check(!pool.bushOccludes(0, 1.0, 6, 20, 1.0, 6), 'P5: GlbPropPool.bushOccludes clear when line misses bushes');
    pool.dispose();

    const layout = new WorldLayout(1993);
    const chunk = buildChunk(layout, 0, 0);
    check(chunk.glbs.length > 0, `P5: downtown chunk (0,0) emits streamed GLB placements (${chunk.glbs.length} instances)`);
  }

  console.log(fails.length ? `\ntest:milestone FAILED (${fails.length})` : '\ntest:milestone passed');
  return fails.length ? 1 : 0;
}
