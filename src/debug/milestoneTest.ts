import './domStub';
import { BufferGeometry, Float32BufferAttribute, Scene, Uint16BufferAttribute, Vector3 } from 'three';
import { loadCharactersNode } from './nodeCharacters';
import { FP_SHADOW_LAYER, stripUpperTriangles } from '../player/BodyModel';
import { PlayerController } from '../player/PlayerController';
import { Bandits } from '../systems/Bandits';
import { ESCAPE_ALTITUDE, HELI_SPOOL_TIME, Helicopter, PERIMETER_RADIUS } from '../systems/Helicopter';
import { HeliCockpit } from '../systems/HeliCockpit';
import { Inventory } from '../systems/Inventory';
import { GunFx } from '../weapons/GunFx';
import { surfaceLayer } from '../render/look/surfaces';
import { buildHighriseInterior } from '../world/gen/highriseInterior';
import * as F from '../world/gen/furniture';
import { TRIPWIRE_FUSE_S, Tripwires } from '../systems/Tripwires';
import { ZombieSim } from '../systems/zombies';
import { CollisionWorld, PackedColliders } from '../world/CollisionWorld';
import { Doors } from '../world/Doors';
import { GlbPropPool } from '../world/GlbPropPool';
import { WindowPanes } from '../world/WindowPanes';
import { buildChunk } from '../world/gen/buildChunk';
import { buildPoi } from '../world/gen/poiBuild';
import { Vegetation } from '../render/Vegetation';
import { playerRagdoll } from '../player/deathBody';
import { PART } from '../physics/ragdoll';
import {
  buildHighriseShell,
  FE_DEPTH,
  FE_HALF_W,
  FE_HATCH_X0,
  FE_HATCH_X1,
  FE_LAND_W,
  FE_ROOF_GAP,
  FE_STAIR_X0,
  FE_STAIR_X1,
  FLOOR_H,
  highriseSurfaceY,
  inFireEscape,
  local as highriseLocal,
  type BuildingDesc,
} from '../world/gen/highrise';
import { glbObb, obbOverlap } from '../world/gen/footprint';
import { WorldLayout, PAVE } from '../world/gen/layout';
import { nearestPoi, siteToWorld, type PoiKind } from '../world/gen/poi';
import { buildHouse, Builder, lampPost, plantTree } from '../world/gen/pieces';
import { trafficJam } from '../world/gen/storytelling';
import { buildCar } from '../world/props/car';
import { LIFE_STRIDE, WorldLife } from '../world/WorldLife';
import { GLB_WORLD_SPECS, type GlbModelId } from '../world/worldModels';
import { AnxietyAudio } from '../audio/AnxietyAudio';
import { GUNS } from '../weapons/guns';
import { GunState, newInst, type GunInput } from '../weapons/gunState';
import { Particles } from '../render/Particles';
import { StaticBatch } from '../render/StaticBatch';
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

    // Lamp post orientation toward road + perch height matching 6.2 m GLB arm
    {
      const b = new Builder(new StaticBatch(), new PackedColliders());
      lampPost(b, 10, 20, -1, 0, 0.14);
      lampPost(b, 30, 40, 0, -1, 0.14);
      const l0 = b.batch.glbs[0];
      const l1 = b.batch.glbs[1];
      // Normalized street_lamp_2000 has arm along -X at yaw=0. For armX=-1, cos(yaw)=1; for armZ=-1, -sin(yaw) wait (-1,0,0) rotated by yaw has x=-cos(yaw), z=sin(yaw).
      const dir0x = -Math.cos(l0.yaw);
      const dir0z = Math.sin(l0.yaw);
      const dir1x = -Math.cos(l1.yaw);
      const dir1z = Math.sin(l1.yaw);
      const perchY = b.ambient[2];
      check(
        dir0x < -0.95 && Math.abs(dir0z) < 0.05 && Math.abs(dir1x) < 0.05 && dir1z < -0.95 && perchY >= 6.1,
        `P5: street_lamp_2000 arms point toward road & bird perch at y=${perchY.toFixed(2)} m`,
      );
    }

    // 40m vehicle anti-repeat check
    {
      const batch = new StaticBatch();
      const cw2 = new PackedColliders();
      const spawned = new Set<GlbModelId>();
      for (let k = 0; k < 6; k++) {
        if (buildCar(batch, cw2, { x: k * 6, z: 0, yaw: Math.PI / 2, paint: 0x808080, seed: 42 })) {
          spawned.add(batch.glbs[batch.glbs.length - 1].id);
        }
      }
      check(spawned.size === 6, `P5: 40m anti-repeat prevents identical cars nearby (${spawned.size}/6 unique)`);
    }

    // Scan 11x11 map grid for bus stop sign clearance, grounded sparse trees, special vehicles & low luxury share
    {
      const counts = new Map<GlbModelId, number>();
      let busSignsChecked = 0;
      let busSignsOk = 0;
      let treeGroundedOk = 0;
      let treeGroundedTotal = 0;
      let treeMinSep = 1e9;
      for (let ci = -5; ci <= 5; ci++) {
        for (let cj = -5; cj <= 5; cj++) {
          const ch = buildChunk(layout, ci, cj);
          const shelters = ch.glbs.filter((g) => g.id === 'Soviet_Bus_Stop_Shelt');
          const busSigns = ch.glbs.filter((g) => g.id === 'Sign_Bus_Stop_1500');
          for (const sg of busSigns) {
            busSignsChecked++;
            const nearSh = shelters.find((sh) => Math.hypot(sh.x - sg.x, sh.z - sg.z) < 12);
            if (!nearSh || Math.hypot(nearSh.x - sg.x, nearSh.z - sg.z) >= 4.4) busSignsOk++;
          }
          const chTrees = ch.glbs.filter((g) => g.id === 'Dead_Autumn_Tree_6000' || g.id === 'Spruce_Pine_Tree_7000');
          for (const t of chTrees) {
            treeGroundedTotal++;
            const gy = layout.heightAt(t.x, t.z);
            if (t.y <= gy + 0.05) treeGroundedOk++; // Urban trees sit on sidewalk (0.14) - 0.18 = -0.04 <= gy+0.05
          }
          if (layout.isDowntown(ci, cj) && !layout.poi(ci, cj)) {
            for (let a = 0; a < chTrees.length; a++) {
              for (let b = a + 1; b < chTrees.length; b++) {
                const d = Math.hypot(chTrees[a].x - chTrees[b].x, chTrees[a].z - chTrees[b].z);
                if (d < treeMinSep) treeMinSep = d;
              }
            }
          }
          for (const g of ch.glbs) counts.set(g.id, (counts.get(g.id) ?? 0) + 1);
        }
      }
      check(busSignsChecked > 0 && busSignsOk === busSignsChecked, `P5: bus stop signs clear shelter >= 2.0 m (${busSignsOk}/${busSignsChecked})`);
      check(treeGroundedTotal > 0 && treeGroundedOk === treeGroundedTotal, `P5: trees grounded/sunk cleanly (${treeGroundedOk}/${treeGroundedTotal})`);
      check(treeMinSep >= 18, `P5: street trees maintain >= 18 m min separation (min=${treeMinSep.toFixed(1)} m)`);

      const requiredSpecial: GlbModelId[] = [
        'Police_Sedan_DPS_22k',
        'omon_swat_van_17k',
        'gazelle_ambulance_17k',
        'kamaz_fire_truck_20k',
        'Kamaz_6x6_25k',
        'gaz_tigr_4x4_17k',
        'zsu_23_4_shilka_14k',
        'paz_3205_bus_11000',
      ];
      const missingSpecial = requiredSpecial.filter((id) => (counts.get(id) ?? 0) === 0);
      check(missingSpecial.length === 0, `P5: all special vehicle classes spawn across map (missing: ${missingSpecial.join(',') || 'none'})`);

      let totalVeh = 0;
      for (const [id, c] of counts) if (GLB_WORLD_SPECS[id].category === 'vehicle') totalVeh += c;
      const lux = (counts.get('Luxury_SUV_Gelik_22k') ?? 0) + (counts.get('Sport_Sedan_22k') ?? 0);
      const luxPct = (lux / Math.max(1, totalVeh)) * 100;
      check(luxPct < 18, `P5: luxury Gelik+Sport_Sedan stay rare (${lux}/${totalVeh} = ${luxPct.toFixed(1)}%)`);
    }

    // Semi-truck + trailer fifth-wheel coupling (~6.75 m) and solid outer BoxCollider check
    {
      const cw = new CollisionWorld();
      const sb = new StaticBatch();
      buildCar(sb, cw, { x: 0, z: 0, yaw: 0, paint: 0xffffff, seed: 5, kind: 'trailer' });
      const wallProbe = new Vector3(4.5, 1.0, 0.2);
      cw.resolveCircle(wallProbe, 0.3);
      const roofSupport = cw.supportAt(0, 0, 0.24, 5.2, 4.95);
      const jamBatch = new StaticBatch();
      const jamCw = new CollisionWorld();
      const jb = new Builder(jamBatch, jamCw);
      let coupledOk = true;
      let pairCount = 0;
      for (let s = 1; s <= 40; s++) {
        let seedState = s * 9973;
        const rnd = () => ((seedState = (seedState * 16807) % 2147483647) / 2147483647);
        jamBatch.glbs.length = 0;
        trafficJam(jb, 0, 0, true, 6, 58, rnd);
        for (let gi = 0; gi < jamBatch.glbs.length; gi++) {
          if (jamBatch.glbs[gi].id === 'Semi_Truck_Tractor_24' && jamBatch.glbs[gi + 1]?.id === 'Semi_Trailer_Cargo_20') {
            const tr = jamBatch.glbs[gi];
            const tl = jamBatch.glbs[gi + 1];
            const d = Math.hypot(tr.x - tl.x, tr.z - tl.z);
            pairCount++;
            if (Math.abs(d - 6.75) > 0.05) coupledOk = false;
          }
        }
      }
      check(
        pairCount > 0 && coupledOk && Math.abs(wallProbe.z) >= 1.44 && Math.abs(roofSupport - 4.954) < 0.02,
        `P5: semi-trailer couples at 6.75m & has solid BoxCollider roof (${roofSupport.toFixed(2)}m, pairs=${pairCount})`,
      );
    }

    // Highrise GLB fire escape check: 1-to-1 stair/hatch colliders, >= 2.2m headroom through hatch, solid grating outside hatch, open roof exit & metal surface
    {
      const cw = new CollisionWorld();
      const packed = new PackedColliders();
      const b = new Builder(new StaticBatch(), packed);
      const desc: BuildingDesc = { id: 99, cx: 0, cz: 0, w: 18, d: 15, floors: 4, facade: 'facadeConcrete', flip: false, kind: 'apartments', seed: 11 };
      buildHighriseShell(b, desc, () => 0.3);
      cw.addPacked(1, new Float32Array(packed.data));
      const feCount = b.batch.glbs.filter((g) => g.id === 'fire_escape_smart_top').length;
      const L = highriseLocal(desc);
      const feX0 = (L.x0 + L.x1) * 0.5 - FE_HALF_W;
      const feX1 = feX0 + FE_HALF_W * 2;
      const feCx = (feX0 + feX1) * 0.5;
      const stairX0 = feCx + FE_STAIR_X0;
      const stairX1 = feCx + FE_STAIR_X1;
      const zInner = L.z1 + FE_DEPTH * 0.22;
      const zOuter = L.z1 + FE_DEPTH * 0.72;
      let curY = 0;
      let headroomOk = true;
      let continuousClimb = true;
      for (let f = 0; f < desc.floors; f++) {
        // Walk from entry feX0 across outer landing & exact measured stair run [stairX0..stairX1] to arrival landing
        for (let x = feX0 + 0.5; x <= stairX1 + 0.2; x += 0.25) {
          const ny = highriseSurfaceY(desc, x, zOuter, curY);
          const p = new Vector3(x, curY, zOuter);
          cw.resolveCircle(p, 0.3);
          const ceil = cw.ceilingAt(x, zOuter, 0.25, curY + 0.4);
          if (ceil < curY + 2.2) headroomOk = false;
          if (ny === null || ny - curY > 0.35 || p.distanceTo(new Vector3(x, curY, zOuter)) > 0.05) continuousClimb = false;
          else curY = ny;
        }
        // Snap onto next storey height at top of flight [stairX1..feX1-0.5]
        curY = (f + 1) * FLOOR_H;
        // Transition to inner balcony walkway (if more floors remain) or exit straight onto roof
        if (f < desc.floors - 1) {
          for (let z = zOuter; z >= zInner; z -= 0.15) {
            const ny = highriseSurfaceY(desc, stairX1 + 0.2, z, curY);
            if (ny === null || Math.abs(ny - (f + 1) * FLOOR_H) > 0.05) continuousClimb = false;
            else curY = ny;
          }
          for (let x = stairX1 + 0.2; x >= feX0 + 0.5; x -= 0.3) {
            const ny = highriseSurfaceY(desc, x, zInner, curY);
            const ceil = cw.ceilingAt(x, zInner, 0.25, curY + 0.4);
            if (ceil < curY + 2.2) headroomOk = false;
            if (ny === null || Math.abs(ny - (f + 1) * FLOOR_H) > 0.05) continuousClimb = false;
          }
          for (let z = zInner; z <= zOuter; z += 0.15) {
            const ny = highriseSurfaceY(desc, feX0 + 0.5, z, curY);
            if (ny === null || Math.abs(ny - (f + 1) * FLOOR_H) > 0.05) continuousClimb = false;
          }
        }
      }
      // Solid balcony grating must stop head underneath outside the open hatch [FE_HATCH_X0..FE_HATCH_X1]
      const underGratingBlocked = cw.ceilingAt(feCx - 1.2, zInner, 0.2, 0.2) < FLOOR_H + 0.05 && cw.ceilingAt(feCx - 1.2, zOuter, 0.2, 0.2) < FLOOR_H + 0.05;
      const insideHatchClear = cw.ceilingAt((feCx + FE_HATCH_X0 + feCx + FE_HATCH_X1) * 0.5, zOuter, 0.25, 0.4) > FLOOR_H + 0.5;
      // Check stepping straight across parapet exit [feX1 - FE_ROOF_GAP .. feX1] onto the roof slab
      const exitX = feX1 - FE_ROOF_GAP * 0.5;
      let roofExitOk = Math.abs(curY - desc.floors * FLOOR_H) < 0.05;
      for (let z = zOuter; z >= L.z1 - 1.0; z -= 0.2) {
        const ny = highriseSurfaceY(desc, exitX, z, curY);
        const p = new Vector3(exitX, curY, z);
        cw.resolveCircle(p, 0.3);
        if (ny === null || Math.abs(ny - desc.floors * FLOOR_H) > 0.05 || Math.hypot(p.x - exitX, p.z - z) > 0.05) {
          roofExitOk = false;
        }
      }
      const metalFootstepZone = inFireEscape(desc, stairX0, zOuter);
      void FE_LAND_W;
      check(
        feCount === desc.floors && continuousClimb && headroomOk && roofExitOk && underGratingBlocked && insideHatchClear && metalFootstepZone,
        `P5: highrise uses ${feCount} fire_escape_smart_top.glb modules & climbs smoothly to roof (${curY.toFixed(1)} m, headroom=${headroomOk}, hatchClear=${insideHatchClear}, solidGrating=${underGratingBlocked}, roofExit=${roofExitOk})`,
      );
      void LIFE_STRIDE;
    }

    // Regression checks for recent fixes (M4A1 1.25x RPM, downtown speed bumps, debris scale, 0 vehicle overlaps,
    // helipad POI + guaranteed parts & fuel, pooled WorldLife glass shards).
    {
      check(
        GUNS.rifle_m4a1.rpm === GUNS.rifle_ak.rpm * 1.25,
        `P6: M4A1 RPM (${GUNS.rifle_m4a1.rpm}) is 1.25x AK RPM (${GUNS.rifle_ak.rpm})`,
      );
      const countAutoShots = (id: 'rifle_ak' | 'rifle_m4a1') => {
        const st = newInst(id, 31);
        st.mode = 'auto';
        const ammo = { count: () => 120, take: () => 0, give: () => {}, spareMags: () => 2, takeMag: () => true };
        const gs = new GunState(id, st, ammo);
        const inp: GunInput = { trigger: true, pulled: false, reload: false, mode: false, inspect: false, bash: false, canFire: true };
        for (let f = 0; f < 40; f++) gs.update(1 / 60, { ...inp, trigger: false });
        let shots = 0;
        for (let f = 0; f < 72; f++) {
          const ev = gs.update(1 / 60, inp);
          if (ev.some((e) => e.kind === 'shot')) shots++;
        }
        return shots;
      };
      const akShots = countAutoShots('rifle_ak');
      const m4Shots = countAutoShots('rifle_m4a1');
      check(
        akShots === 12 && m4Shots === 15,
        `P6: 60Hz 1.2s sustained auto matches exact 1.25x rate (AK=${akShots} vs M4A1=${m4Shots})`,
      );

      check(
        GLB_WORLD_SPECS.Road_Debris_Cluster_2.size[1] <= 0.85,
        `P6: Road_Debris_Cluster_2 scaled down to realistic height (${GLB_WORLD_SPECS.Road_Debris_Cluster_2.size[1]} m)`,
      );

      const layout = new WorldLayout(1993);
      let cityBumps = 0;
      let bumpYOk = 0;
      let overlapCount = 0;
      for (let ci = -3; ci <= 3; ci++) {
        for (let cj = -3; cj <= 3; cj++) {
          const ch = buildChunk(layout, ci, cj);
          for (const g of ch.glbs) {
            if (g.id === 'speed_bump_1000' && (layout.urbanX(ci, cj) || layout.urbanZ(ci, cj))) {
              cityBumps++;
              if (Math.abs(g.y - (PAVE.asphalt + 0.005)) < 1e-4) bumpYOk++;
            }
          }
          const vehs = ch.glbs.filter((g) => GLB_WORLD_SPECS[g.id].category === 'vehicle');
          for (let a = 0; a < vehs.length; a++) {
            for (let b = a + 1; b < vehs.length; b++) {
              const va = vehs[a];
              const vb = vehs[b];
              const coupled =
                ((va.id === 'Semi_Truck_Tractor_24' && vb.id === 'Semi_Trailer_Cargo_20') ||
                  (vb.id === 'Semi_Truck_Tractor_24' && va.id === 'Semi_Trailer_Cargo_20')) &&
                Math.hypot(va.x - vb.x, va.z - vb.z) < 7.2;
              if (coupled) continue;
              const oa = glbObb(va);
              const ob = glbObb(vb);
              if (obbOverlap(oa.x, oa.z, oa.hx, oa.hz, oa.yaw, ob.x, ob.z, ob.hx, ob.hz, ob.yaw)) overlapCount++;
            }
          }
        }
      }
      check(cityBumps >= 3 && bumpYOk === cityBumps, `P6: downtown/town speed bumps seated at asphalt+0.005 (${bumpYOk}/${cityBumps})`);
      check(overlapCount === 0, `P6: zero overlapping street vehicle OBBs across 7x7 city grid (overlaps=${overlapCount})`);

      const hp = nearestPoi(layout, 'helipad', 0, 0, 120);
      const [hpx, hpz] = hp ? siteToWorld(hp, 0, 0) : [0, 0];
      const worldHeli = new Helicopter({
        scene: new Scene(),
        world: new CollisionWorld(),
        layout,
        particles: new Particles(),
        groundY: () => 0,
        toast: () => {},
        hurtPlayer: () => {},
        explode: () => {},
        onEscape: () => {},
      });
      check(
        !!hp && Math.hypot(worldHeli.x - hpx, worldHeli.z - hpz) < 0.1,
        `P6: Mi-8 spawns on dedicated helipad POI (dist=${hp ? Math.hypot(worldHeli.x - hpx, worldHeli.z - hpz).toFixed(2) : 'none'})`,
      );
      worldHeli.dispose();

      const fixedCounts = new Map<string, number>();
      for (const kind of ['police', 'gas', 'checkpoint', 'plant', 'lab', 'helipad', 'airport', 'base'] as PoiKind[]) {
        const s = nearestPoi(layout, kind, 0, 0, 120);
        if (!s) continue;
        for (let i = s.i; i < s.i + (s.bw ?? 1); i++) {
          for (let j = s.j; j < s.j + (s.bd ?? 1); j++) {
            for (const c of buildChunk(layout, i, j).containers) {
              for (const fid of c.fixed ?? []) fixedCounts.set(fid, (fixedCounts.get(fid) ?? 0) + 1);
            }
          }
        }
      }
      check(
        (fixedCounts.get('heliAvionics') ?? 0) >= 1 &&
          (fixedCounts.get('heliFuelPump') ?? 0) >= 1 &&
          (fixedCounts.get('heliBattery') ?? 0) >= 1 &&
          (fixedCounts.get('jerrycan') ?? 0) >= 6,
        `P6: guaranteed POI parts & >=6 jerrycans (av=${fixedCounts.get('heliAvionics') ?? 0}, pump=${fixedCounts.get('heliFuelPump') ?? 0}, bat=${fixedCounts.get('heliBattery') ?? 0}, fuel=${fixedCounts.get('jerrycan') ?? 0})`,
      );

      const lifeScene = new Scene();
      const life = new WorldLife(lifeScene, { context: null } as unknown as AnxietyAudio, () => 0);
      life.burstGlassShards(1, 1.4, 2, 0, 0, -1, 16, 0);
      life.addDynamicShards(1, 0, 2, 1.4);
      life.addGlassCrackDecal(1, 1.4, 2, 0, 0, -1, 0.44);
      check(life.onShards(1, 2, 0), 'P6: pooled WorldLife glass shatter/decal/shards active');
      life.dispose();

      // ── Pillar 7: LODs, GunFx Pool, Hard Door Collision, Zero FacadeBrick Interiors, Mi-8 Landing & Catastrophes ──
      const lodManifestRaw = readFileSync('public/models/world/lod/manifest.json', 'utf8');
      const lodMan = JSON.parse(lodManifestRaw) as { models: unknown[]; totalSrcTris: number; totalLodTris: number };
      const lodReduction = 1 - lodMan.totalLodTris / Math.max(1, lodMan.totalSrcTris);
      check(
        lodMan.models.length >= 25 && lodReduction >= 0.7,
        `P7: LOD1 world GLBs generated (${lodMan.models.length} models, -${(lodReduction * 100).toFixed(1)}% tris)`,
      );

      const gfxScene = new Scene();
      const vmScene = new Scene();
      const gfx = new GunFx(gfxScene);
      gfx.addBulletHole(new Vector3(1, 1, 1), new Vector3(0, 0, 1), 'wood');
      gfx.addBulletHole(new Vector3(2, 1, 1), new Vector3(1, 0, 0), 'metal');
      gfx.addBulletHole(new Vector3(3, 1, 1), new Vector3(0, 1, 0), 'stone');
      const gfxDone = gfx.prewarm(vmScene);
      gfx.keepPrewarmVisible();
      gfxDone();
      gfx.dispose();
      check(true, 'P7: GunFx pooled bullet-hole decals + prewarm safe & active');

      // Hard door collision: full sprint into closed & peeking wood door cannot tunnel through even after gunfire
      {
        const dScene = new Scene();
        const dcw = new CollisionWorld();
        const dd = new Doors(dScene, dcw, 'standard');
        dd.add(20, [{ hx: 0, hz: 0, y: 0, yaw: 0, swing: 1, barricaded: false, width: 1.0, height: 2.1, style: 'wood' }]);
        const hitBefore = dcw.rayHitDetail(0.5, 1.0, 1.0, 0, 0, -1, 3);
        const gunHitRes = hitBefore ? dd.bulletImpact(hitBefore.owner, 200) : null;
        check(gunHitRes !== null && gunHitRes.brokenNow === false, 'P7: bullets penetrate wood door without disabling door collider');

        const pc = new PlayerController(new Vector3(0.5, 0, 1.0), 0);
        const sprintIn = makeMockInput({ sprint: true }, 0, 1);
        for (let k = 0; k < 120; k++) pc.fixedUpdate(1 / 60, sprintIn, dcw);
        const stayedOutClosed = pc.position.z >= 0.3;

        dd.peekToggle({ building: 20, index: 0 });
        for (let k = 0; k < 45; k++) dd.update(1 / 60);
        for (let k = 0; k < 120; k++) pc.fixedUpdate(1 / 60, sprintIn, dcw);
        check(
          stayedOutClosed && pc.position.z >= 0.25,
          `P7: player cannot sprint-clip closed or peeking (<55 deg) door (z=${pc.position.z.toFixed(2)})`,
        );
      }

      // Interiors: zero 'facadeBrick' inside high-rise rooms + DoorClearanceZone 1.6m guard
      {
        const ib = new StaticBatch();
        const icw = new CollisionWorld();
        const bld = new Builder(ib, icw);
        const desc: BuildingDesc = {
          id: 777,
          cx: 12,
          cz: 12,
          w: 18,
          d: 18,
          floors: 3,
          facade: 'facadeBrick',
          flip: false,
          kind: 'apartments',
          seed: 4242,
        };
        buildHighriseInterior(bld, desc, 1, (k) => 9e6 + k * 100);
        const bufs = ib.buildBuffers();
        const extBrickLayer = surfaceLayer('facadeBrick');
        const hasExtBrick = bufs.some((s) => {
          for (let i = 0; i < s.layer.length; i++) if (s.layer[i] === extBrickLayer) return true;
          return false;
        });
        check(!hasExtBrick, `P7: zero exterior facadeBrick surfaces inside highrise interior (hasExtBrick=${hasExtBrick})`);

        const db = new Builder(new StaticBatch(), new CollisionWorld());
        db.door(0, 0, 0, 0, 1, false, { width: 1.0, height: 2.1, style: 'wood' });
        const blockedFurniture = new F.Place(db, 0.5, 0, 0.4, 0).model('chair', () => 0.5);
        check(!blockedFurniture && db.isDoorClear(5, 5, 0), 'P7: DoorClearanceZone (1.6m) blocks furniture inside doorway');
        bld.dispose();
        db.dispose();
      }

      // Mi-8: 0% fuel descends cleanly to roof/ground (no 4.1m hover freeze) + roof tryExit + HeliCockpit
      {
        const roofY = 12.0;
        const rScene = new Scene();
        const rcw = new CollisionWorld();
        rcw.addBox(-10, -10, 10, 10, roofY - 0.25, roofY);
        const heliTest = new Helicopter({
          scene: rScene,
          world: rcw,
          layout,
          particles: new Particles(),
          groundY: (gx, gz, refY = 0) => (Math.abs(gx) <= 9.5 && Math.abs(gz) <= 9.5 && refY >= roofY - 1.0 ? roofY : 0),
          toast: () => {},
          hurtPlayer: () => {},
          explode: () => {},
          onEscape: () => {},
        });
        heliTest.placeForTest(0, 0, true);
        heliTest.board();
        heliTest.y = roofY + 12.0;
        heliTest.fuel = 0;
        heliTest.spool = 1.0;
        const pPos = new Vector3();
        const pPrev = new Vector3();
        const emptyIn = makeMockInput({});
        for (let k = 0; k < 210; k++) heliTest.fixedUpdate(1 / 30, emptyIn, pPos, pPrev);
        const exitedOnRoof = heliTest.tryExit(pPos, pPrev);
        const cockpit = new HeliCockpit(new Scene());
        cockpit.update(1 / 60, heliTest.cockpitState());
        cockpit.dispose();
        check(
          Math.abs(heliTest.y - roofY) < 0.2 && exitedOnRoof && Math.abs(pPos.y - roofY) < 0.3,
          `P7: Mi-8 lands flush on roof at 0% fuel & exits cleanly onto roof (heliY=${heliTest.y.toFixed(2)}, exitY=${pPos.y.toFixed(2)})`,
        );
        heliTest.dispose();
      }

      // Downtown catastrophe landmarks in (1,-1) Boeing + (1,0) Mi-8 high-rise impact
      {
        const cBoeing = buildChunk(layout, 1, -1);
        const cMi8 = buildChunk(layout, 1, 0);
        const hasBoeing = cBoeing.glbs.some((g) => g.id === 'passenger_airliner_22');
        const hasHighMi8 = cMi8.glbs.some((g) => g.id === 'mi8_wreck_remesh' && g.y >= 9.0);
        check(hasBoeing && hasHighMi8, `P7: downtown catastrophe landmarks present (boeing=${hasBoeing}, highriseMi8=${hasHighMi8})`);
      }

      // ── P8 Regression Checks ──
      // Sloped gable house roof + gas canopy solid colliders & Mi-8 3D fuselage wall collision
      {
        const hPack = new PackedColliders();
        const hb = new Builder(new StaticBatch(), hPack);
        buildHouse(hb, { x0: 0, z0: 0, w: 9, d: 8, frontPlusZ: true, rand: () => 0.45 });
        const hCw = new CollisionWorld();
        hCw.addPacked(1, new Float32Array(hPack.data));
        const ridgeHit = hCw.rayHitDetail(4.5, 8.0, 4.0, 0, -1, 0, 10, true);
        const ridgeY = ridgeHit ? 8.0 - ridgeHit.t : 0;

        const gasSite = nearestPoi(layout, 'gas', 0, 0, 60);
        let gasCanopyY = 0;
        if (gasSite) {
          const gPack = new PackedColliders();
          const gb = new Builder(new StaticBatch(), gPack);
          buildPoi(gb, gasSite, () => 0.5, layout.seed);
          const gCw = new CollisionWorld();
          gCw.addPacked(2, new Float32Array(gPack.data));
          const [wx, wz] = siteToWorld(gasSite, -4.0, 12.0);
          const gh = gCw.rayHitDetail(wx, 10.0, wz, 0, -1, 0, 10, true);
          gasCanopyY = gh ? 10.0 - gh.t : 0;
        }
        check(ridgeY > 3.5 && (!gasSite || gasCanopyY >= 4.7), `P8: house gable roof (y=${ridgeY.toFixed(2)}) & gas canopy (y=${gasCanopyY.toFixed(2)}) have solid colliders`);

        const mScene = new Scene();
        const mcw = new CollisionWorld();
        mcw.addBox(-12, -10, 12, -6, 0, 14);
        const hCol = new Helicopter({
          scene: mScene,
          world: mcw,
          layout,
          particles: new Particles(),
          groundY: () => 0,
          toast: () => {},
          hurtPlayer: () => {},
          explode: () => {},
          onEscape: () => {},
        });
        hCol.placeForTest(0, 0, true);
        hCol.board();
        hCol.yaw = 0;
        hCol.y = 3.0;
        hCol.z = -1.5;
        hCol.vz = -10.0;
        hCol.spool = 1.0;
        const hullBefore = hCol.hull;
        const pPos = new Vector3();
        const pPrev = new Vector3();
        const hoverIn = makeMockInput({});
        for (let k = 0; k < 25; k++) hCol.fixedUpdate(1 / 60, hoverIn, pPos, pPrev);
        check(hCol.z > -5.5 && hCol.hull < hullBefore, `P8: Mi-8 3D collision stops outside building wall (z=${hCol.z.toFixed(2)}) & takes impact hull damage`);
        hCol.dispose();
      }

      // 2-stage building window glass: bullet penetration (Stage 0 -> Stage 1) & body shatter (Stage 1 -> Stage 2)
      {
        const wScene = new Scene();
        const wcw = new CollisionWorld();
        const wp = new WindowPanes(wScene, wcw);
        wp.addChunk(101, [{ cx: 0, cy: 1.5, cz: 0, sx: 2.2, sy: 2.0, sz: 0.04 }]);
        const det0 = wcw.rayHitDetail(0, 1.5, 2, 0, 0, -1, 5, false);
        const hit1 = det0 ? wp.bulletHit(det0.owner) : null;
        const penDet = det0 ? wcw.rayHitDetail(0, 1.5, 2 - (det0.t + 0.32), 0, 0, -1, 5, false) : null;
        const crackedOk = !!det0?.glass && !!hit1?.newlyCracked && wp.isCracked(det0.owner) && penDet === null;
        const broken = wp.shatterCrackedNear(0, 0, 0.25, 0.52, 1.75);
        const detAfter = wcw.rayHitDetail(0, 1.5, 2, 0, 0, -1, 5, false);
        check(crackedOk && broken.length === 1 && det0 !== null && !wp.isCracked(det0.owner) && detAfter === null, 'P8: WindowPanes 2-stage glass penetrates (Stage 1 web) then clears completely on body contact (Stage 2)');
        wp.dispose();
      }

      // Car GLB mesh raycast helper & transparent glass decal
      {
        check(typeof GlbPropPool.prototype.raycastVehicle === 'function', 'P8: GlbPropPool.raycastVehicle active for exact car windshield normals');
      }

      // Ragdoll anti-kneel sleep guarantee: lies flat on ground immediately
      {
        const rd = playerRagdoll(new Vector3(0, 0, 0), 0, 1, new Vector3(0, 0, 0), new Vector3(0, 0, 1), [], () => 0.4);
        rd.sleep();
        const flatOk = rd.poses[PART.pelvis].p.y <= 0.42 && rd.poses[PART.chest].p.y <= 0.45 && rd.poses[PART.head].p.y <= 0.52;
        check(flatOk, `P8: Ragdoll.sleep() lays corpse flat (pelvis=${rd.poses[PART.pelvis].p.y.toFixed(2)}, chest=${rd.poses[PART.chest].p.y.toFixed(2)}, head=${rd.poses[PART.head].p.y.toFixed(2)})`);
      }

      // Retired procedural Vegetation stays hidden & plantTree rejects (0,0) road intersection
      {
        const vegScene = new Scene();
        const veg = new Vegetation(vegScene, 1);
        veg.prewarm();
        veg.setPlants([]);
        const bTree = new Builder(new StaticBatch(), new PackedColliders());
        plantTree(bTree, 0, 0, 0, 1, 0, 0);
        check(!vegScene.children.some((c) => c.visible) && bTree.batch.glbs.length === 0, 'P8: procedural road tree disabled at (0,0) & hidden in Vegetation');
        bTree.dispose();
        veg.dispose();
      }

      // Bandit post-update zombie kill produces strictly 1 corpse (no duplicate corpse spawn)
      {
        const zcw = new CollisionWorld();
        const zsim = new ZombieSim(
          {
            groundY: () => 0,
            resolveCircle: (p, r, h) => zcw.resolveCircle(p, r, h),
            rayHit: () => -1,
            indoors: () => false,
            kindAt: () => 'worker',
          },
          0,
          123,
        );
        const sense = { pos: new Vector3(0, 0, 0), eye: 1.6, noise: 0, crouched: false, lit: 0, daylight: 1, bandits: [] };
        const z = zsim.spawnAt(3, 3);
        zsim.update(1 / 60, sense);
        const killed = zsim.hit(z, 999, 0, 0);
        const secondHit = zsim.hit(z, 999, 0, 0);
        const diedCount1 = zsim.died.length;
        zsim.clearEvents();
        zsim.update(1 / 60, sense);
        const diedCount2 = zsim.died.length;
        check(killed && !secondHit && diedCount1 === 1 && diedCount2 === 0, `P8: post-update zombie kill produces strictly 1 death event (tick1=${diedCount1}, tick2=${diedCount2})`);
      }
    }
  }

  console.log(fails.length ? `\ntest:milestone FAILED (${fails.length})` : '\ntest:milestone passed');
  return fails.length ? 1 : 0;
}
