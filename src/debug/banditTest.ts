import './domStub';
import { Quaternion, Scene, Vector3 } from 'three';
import { StaticBatch } from '../render/StaticBatch';
import { applyZonalArmor } from '../systems/Armor';
import {
  areFactionsHostile,
  BANDIT_BODY_ID,
  type Bandit,
  Bandits,
  type BanditWorld,
  type FactionId,
  type SpawnBotOptions,
  type SpawnKind,
} from '../systems/Bandits';
import { Containers, type ContainerRef } from '../systems/Containers';
import { ZombieSim, type ZombieWorld } from '../systems/zombies';
import { CollisionWorld } from '../world/CollisionWorld';
import { Doors } from '../world/Doors';
import { type BuildingDesc, buildHighriseShell, FLOOR_H, local } from '../world/gen/highrise';
import { buildHighriseInterior } from '../world/gen/highriseInterior';
import { buildHouse, Builder } from '../world/gen/pieces';
import { mulberry32 } from '../core/random';
import { loadCharactersNode } from './nodeCharacters';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

interface SpawnFn {
  spawnBot(
    rx: number,
    sy: number,
    rz: number,
    faction: FactionId,
    spawnKind: SpawnKind,
    weapon: string,
    isGun: boolean,
    mods?: string[],
    opts?: SpawnBotOptions,
  ): Bandit;
}

export async function main(): Promise<number> {
  await loadCharactersNode();

  const createHarness = (doors?: Doors, world = new CollisionWorld(), scene = new Scene()) => {
    const zWorld: ZombieWorld = {
      groundY: () => 0,
      resolveCircle: (p, r) => world.resolveCircle(p, r),
      rayHit: (ox, oy, oz, dx, dy, dz, max) => world.rayHit(ox, oy, oz, dx, dy, dz, max),
    };
    const zombies = new ZombieSim(zWorld, 0);
    const containers = new Containers(1993);
    const ragdolls: unknown[] = [];
    const lootedDrops: number[] = [];
    let playerDmg = 0;

    const bWorld: BanditWorld = {
      scene,
      groundY: (_x, _z, y = 0) => Math.max(0, Math.floor((y + 0.1) / FLOOR_H) * FLOOR_H),
      resolveCircle: (pos, r) => world.resolveCircle(pos, r),
      rayHit: (ox, oy, oz, dx, dy, dz, max) => world.rayHit(ox, oy, oz, dx, dy, dz, max),
      boxesNear: (x, z, r, out) => world.boxesNear(x, z, r, (b) => out.push(b)),
      buildingsNear: () => [],
      addRagdoll: (rd) => ragdolls.push(rd),
      removeRagdoll: () => {},
      zombies,
      noise() {},
      hurtPlayer(hp, _fx, _fz, _cause) {
        playerDmg += hp;
      },
      placeAt: () => 'indoor',
      onDropLoot: (bot) => {
        lootedDrops.push(bot.id);
        containers.addLoose(
          {
            id: BANDIT_BODY_ID + bot.id,
            type: 'bodyBandit',
            x: bot.pos.x,
            z: bot.pos.z,
            y: bot.pos.y,
            zone: 'downtown',
          },
          bot.loot,
          bot.corpse,
        );
      },
      onRemoveCorpse: (bot) => containers.removeLoose(BANDIT_BODY_ID + bot.id),
      openDoorNear: doors
        ? (x, y, z, radius = 1.7) => {
            const near = doors.closedNear(x, y, z, radius);
            return near ? doors.toggle(near.ref) : false;
          }
        : undefined,
    };

    const bandits = new Bandits(bWorld);
    return {
      scene,
      world,
      containers,
      bandits,
      spawn: (bandits as unknown as SpawnFn),
      lootedDrops,
      get playerDmg() { return playerDmg; },
      resetPlayerDmg() { playerDmg = 0; },
    };
  };

  // 1) Thin 0.12m interior wall & real buildHouse partition must completely block LOS and shots (including close to wall).
  {
    const h = createHarness();
    const b = new Builder(new StaticBatch(), h.world);
    buildHouse(b, { x0: 0, z0: 0, w: 10, d: 8, frontPlusZ: true, rand: mulberry32(42) });
    // Center dividing partition is at x ~ 5.0 (Living room on left x < 5.0, Bedroom/Kitchen on right x > 5.12).
    h.spawn.spawnBot(2.2, 0, 5.5, 'pmc', 'indoor', 'rifle_ak', true);
    const bot = h.bandits.list[0];
    // Player pressed near the partition wall inside Bedroom (z ~ 4.0, center between z=2.0 and z=6.0 doorways).
    const px = 5.45;
    const py = 0;
    const pz = 4.0;
    assert(!h.bandits.hasLineOfSight(bot.pos.x, bot.pos.y + 1.5, bot.pos.z, px, py + 1.56, pz), 'Bot sees through 0.12m house partition wall');
    bot.pos.set(2.2, 0, 4.0);
    // Seal the two partition doorways cleanly when testing 3s of continuous shooting so flanking AI cannot walk through an open doorway.
    h.world.addBox(4.94, 1.4, 5.1, 2.6, 0, 3);
    h.world.addBox(4.94, 5.4, 5.1, 6.6, 0, 3);
    bot.state = 'combat';
    bot.reactT = 0;
    for (let i = 0; i < 180; i++) {
      h.bandits.update(1 / 60, px, py, pz, false, false);
    }
    assert(
      h.playerDmg === 0,
      `Bot damaged player through house partition (${h.playerDmg} dmg, botPos=(${bot.pos.x.toFixed(2)},${bot.pos.z.toFixed(2)}), los=${h.bandits.hasLineOfSight(bot.pos.x, bot.pos.y + 1.5, bot.pos.z, px, py + 1.56, pz)})`,
    );
    h.bandits.dispose();
  }

  // 2) Highrise inter-storey slabs and roof slabs must block vertical LOS & shots between floors.
  {
    const h = createHarness();
    const desc: BuildingDesc = {
      id: 9001,
      cx: 0,
      cz: 0,
      w: 16,
      d: 14,
      floors: 3,
      facade: 'facadeConcrete',
      flip: false,
      kind: 'apartments',
      seed: 1234,
    };
    const b = new Builder(new StaticBatch(), h.world);
    buildHighriseShell(b, desc, mulberry32(77));
    buildHighriseInterior(b, desc, 1, (k) => 10000 + k * 500);
    const L = local(desc);
    const roomX = (L.ix0 + L.ix1) * 0.5;
    const roomZ = (L.iz0 + L.czA) * 0.5;

    // Bot on ground floor (y = 0), player directly above on 1st floor (y = FLOOR_H).
    h.spawn.spawnBot(roomX, 0, roomZ, 'pmc', 'indoor', 'rifle_m4a1', true);
    const floorBot = h.bandits.list[0];
    assert(!h.bandits.hasLineOfSight(floorBot.pos.x, floorBot.pos.y + 1.5, floorBot.pos.z, roomX, FLOOR_H + 1.4, roomZ), 'Bot sees upward through highrise floor slab');
    floorBot.state = 'combat';
    floorBot.reactT = 0;
    for (let i = 0; i < 120; i++) h.bandits.update(1 / 60, roomX, FLOOR_H, roomZ, false, false);
    assert(h.playerDmg === 0, `Floor-0 bot shot player through floor slab (${h.playerDmg} dmg)`);

    // Roof sniper (y = 3 * FLOOR_H), player directly below on top floor (y = 2 * FLOOR_H).
    h.spawn.spawnBot(roomX, 3 * FLOOR_H, roomZ, 'snipers', 'sniper', 'rifle_hunting', true);
    const sniper = h.bandits.list[1];
    assert(!h.bandits.hasLineOfSight(sniper.pos.x, sniper.pos.y + 1.5, sniper.pos.z, roomX, 2 * FLOOR_H + 1.4, roomZ), 'Sniper sees downward through highrise roof slab');
    sniper.state = 'combat';
    sniper.reactT = 0;
    for (let i = 0; i < 120; i++) h.bandits.update(1 / 60, roomX, 2 * FLOOR_H, roomZ, false, false);
    assert(h.playerDmg === 0, `Roof sniper shot player through roof slab (${h.playerDmg} dmg)`);
    h.bandits.dispose();
  }

  // 3) Closed door blocks LOS & damage; opening the door restores LOS.
  {
    const h = createHarness();
    // Solid wall at z = 0 with a 1.0 m doorway gap [-0.5, 0.5] and side corridor walls so flanking stays inside corridor
    h.world.addBox(-5, -0.1, -0.5, 0.1, 0, 3);
    h.world.addBox(0.5, -0.1, 5, 0.1, 0, 3);
    h.world.addBox(-1.2, -4, -0.55, 0, 0, 3);
    h.world.addBox(0.55, -4, 1.2, 0, 0, 3);
    const doors = new Doors(h.scene, h.world);
    doors.add(1, [{ hx: -0.5, hz: 0, y: 0, yaw: 0, swing: 1, barricaded: false, width: 1.0, height: 2.1, open: false }]);
    h.spawn.spawnBot(0, 0, -2.5, 'scavs', 'street', 'pistol_g17', true);
    const bot = h.bandits.list[0];
    assert(!h.bandits.hasLineOfSight(bot.pos.x, 1.5, bot.pos.z, 0, 1.4, 2.5), 'Bot sees through closed door');
    bot.state = 'combat';
    bot.reactT = 0;
    for (let i = 0; i < 120; i++) h.bandits.update(1 / 60, 0, 0, 2.5, false, false);
    assert(h.playerDmg === 0, `Bot dealt damage through closed door (${h.playerDmg})`);
    assert(doors.toggle({ building: 1, index: 0 }), 'Failed to open test door');
    assert(h.bandits.hasLineOfSight(bot.pos.x, 1.5, bot.pos.z, 0, 1.4, 2.5), 'LOS stayed blocked after opening door');
    h.bandits.dispose();
  }

  // 4) Living bots cannot be looted; dead bots drop corpse container and CAN be looted; static crates stay lootable.
  {
    const h = createHarness();
    h.spawn.spawnBot(0, 0, 0, 'scavs', 'street', 'pistol_g17', true);
    const bot = h.bandits.list[0];
    assert(bot.isDead === false, 'New bot must have isDead === false');
    assert(h.lootedDrops.length === 0, 'Living bot dropped loot on spawn');

    const fakeAliveRef: ContainerRef = { id: BANDIT_BODY_ID + bot.id, type: 'bodyBandit', x: 0, z: 0, y: 0, zone: 'downtown' };
    const crateRef: ContainerRef = { id: 42, type: 'crate', x: 2, z: 2, y: 0, zone: 'town' };
    const canLoot = (ref: ContainerRef) => {
      if (ref.type !== 'bodyBandit') return true;
      const found = h.bandits.findByBodyId(ref.id);
      return !found || (found.isDead && found.state === 'dead');
    };
    assert(canLoot(fakeAliveRef) === false, 'Living bandit ref must NOT be lootable');
    assert(canLoot(crateRef) === true, 'Static crate must remain lootable');

    // Kill bot and step updates so ragdoll settles / corpse container spawns
    const killed = bot.hit(400, 5, 5, false, 'limbs');
    const refreshed = h.bandits.list[0];
    assert(killed && refreshed.isDead && refreshed.state === 'dead', 'Bot failed to enter isDead state');
    for (let i = 0; i < 160; i++) h.bandits.update(1 / 60, 10, 0, 10, false, false);
    assert(h.lootedDrops.includes(bot.id), 'Dead bot did not register lootable corpse container');
    assert(canLoot(fakeAliveRef) === true, 'Dead bandit corpse must be lootable');
    h.bandits.dispose();
  }

  // 5) 2x HP across all factions (scavs = 180, pmc = 250, snipers = 260).
  {
    const h = createHarness();
    h.spawn.spawnBot(0, 0, 0, 'scavs', 'street', 'pistol_g17', true);
    h.spawn.spawnBot(3, 0, 0, 'pmc', 'street', 'rifle_ak', true);
    h.spawn.spawnBot(6, 0, 0, 'snipers', 'sniper', 'rifle_hunting', true);
    assert(h.bandits.list[0].maxHp === 180, `Expected scavs maxHp=180, got ${h.bandits.list[0].maxHp}`);
    assert(h.bandits.list[1].maxHp === 250, `Expected pmc maxHp=250, got ${h.bandits.list[1].maxHp}`);
    assert(h.bandits.list[2].maxHp === 260, `Expected snipers maxHp=260, got ${h.bandits.list[2].maxHp}`);
    h.bandits.dispose();
  }

  // 6) Unified zonal armor works identically for player & bandits (head->helmet only, torso->vest only, limbs->0%).
  {
    const helmetOnly = { head: 'helmetMilitary' as const, vest: null };
    const vestOnly = { head: null, vest: 'vestSwat' as const };
    const both = { head: 'helmetSwat' as const, vest: 'vestSwat' as const };

    const hArm = applyZonalArmor(100, 'head', helmetOnly);
    assert(Math.abs(hArm.reduction - 0.32) < 1e-6 && hArm.damage === 68 && hArm.armored, 'Helmet head mitigation mismatch');
    const hVestMiss = applyZonalArmor(100, 'head', vestOnly);
    assert(hVestMiss.reduction === 0 && hVestMiss.damage === 100 && !hVestMiss.armored, 'Vest must NOT protect head');
    const tVest = applyZonalArmor(100, 'torso', vestOnly);
    assert(Math.abs(tVest.reduction - 0.4) < 1e-6 && Math.abs(tVest.damage - 60) < 1e-6 && tVest.armored, 'SWAT vest torso mitigation mismatch');
    const limbUnarmored = applyZonalArmor(100, 'limbs', both);
    assert(limbUnarmored.reduction === 0 && limbUnarmored.damage === 100 && !limbUnarmored.armored, 'Limbs must not receive armor reduction');

    // Verify PMC bot takes exact same zonal damage reduction on head/torso/limbs
    const h = createHarness();
    h.spawn.spawnBot(0, 0, 0, 'pmc', 'street', 'rifle_ak', true);
    const pmc = h.bandits.list[0];
    pmc.worn = { ...pmc.worn, head: 'helmetSwat', vest: 'vestSwat' };
    pmc.wornDirt = { head: 0, vest: 0 };
    const hpBeforeHead = pmc.hp;
    pmc.hit(100, 5, 5, true, 'head');
    assert(Math.abs((hpBeforeHead - pmc.hp) - 65) < 0.01, `PMC head damage mismatch: took ${hpBeforeHead - pmc.hp}`);
    const hpBeforeTorso = pmc.hp;
    pmc.hit(100, 5, 5, false, 'torso');
    assert(Math.abs((hpBeforeTorso - pmc.hp) - 60) < 0.01, `PMC torso damage mismatch: took ${hpBeforeTorso - pmc.hp}`);
    const hpBeforeLimb = pmc.hp;
    pmc.hit(100, 5, 5, false, 'limbs');
    assert(Math.abs((hpBeforeLimb - pmc.hp) - 100) < 0.01, `PMC limb damage mismatch: took ${hpBeforeLimb - pmc.hp}`);
    h.bandits.dispose();
  }

  // 7) EFT faction hostility matrix (no cultists): factions notice, shoot, kill and drop corpse loot on cross-faction fights.
  {
    assert(areFactionsHostile('bear', 'usec') === true, 'BEAR and USEC must be hostile');
    assert(areFactionsHostile('bear', 'scavs') === true, 'BEAR and Scavs must be hostile');
    assert(areFactionsHostile('usec', 'black') === true, 'USEC and Black Raiders must be hostile');
    assert(areFactionsHostile('black', 'scavs') === true, 'Black Raiders and Scavs must be hostile');
    assert(areFactionsHostile('boss', 'bear') === true, 'Boss faction and BEAR must be hostile');
    assert(areFactionsHostile('bear', 'bear') === false, 'BEAR must not shoot own faction');
    assert(areFactionsHostile('usec', 'usec') === false, 'USEC must not shoot own faction');
    assert(areFactionsHostile('black', 'black') === false, 'Black Raiders must not shoot own faction');
    assert(areFactionsHostile('scavs', 'scavs') === false, 'Scavs must not shoot own faction');

    const h = createHarness();
    const bear = h.spawn.spawnBot(0, 0, 0, 'bear', 'street', 'rifle_ak', true);
    const usec = h.spawn.spawnBot(0, 0, 10, 'usec', 'street', 'pistol_g17', true);
    // Place observer player at 65m (outside 38m aggro sightRange, inside 96m despawn radius).
    for (let i = 0; i < 1200 && !bear.isDead && !usec.isDead; i++) {
      h.bandits.update(1 / 60, 0, 0, 65, false, false);
    }
    // Step further so settled corpse registers loot container
    for (let i = 0; i < 160; i++) h.bandits.update(1 / 60, 0, 0, 65, false, false);
    assert(bear.hp < bear.maxHp || usec.hp < usec.maxHp, 'Hostile factions did not exchange gunfire damage');
    assert(bear.isDead || usec.isDead, `Cross-faction firefight failed to produce a kill (bear=${bear.hp}, usec=${usec.hp})`);
    const deadBot = bear.isDead ? bear : usec;
    assert(h.lootedDrops.includes(deadBot.id), 'Bot killed by rival faction did not drop lootable corpse');
    h.bandits.dispose();
  }

  // 8) Tactical bots open closed doors blocking their path via openDoorNear.
  {
    const world = new CollisionWorld();
    const scene = new Scene();
    world.addBox(-5, -0.1, -0.5, 0.1, 0, 3);
    world.addBox(0.5, -0.1, 5, 0.1, 0, 3);
    const doorsInWorld = new Doors(scene, world);
    doorsInWorld.add(1, [{ hx: -0.5, hz: 0, y: 0, yaw: 0, swing: 1, barricaded: false, width: 1.0, height: 2.1, open: false }]);
    const hDoor = createHarness(doorsInWorld, world, scene);

    const bot = hDoor.spawn.spawnBot(0, 0, -1.2, 'bear', 'indoor', 'rifle_ak', true);
    bot.investigateX = 0;
    bot.investigateZ = 2.5;
    bot.investigateT = 4.0;
    assert(doorsInWorld.describe({ building: 1, index: 0 }) === 'closed', 'Door must start closed');
    for (let i = 0; i < 90; i++) {
      doorsInWorld.update(1 / 60);
      hDoor.bandits.update(1 / 60, 0, 0, 50, false, false);
    }
    assert(doorsInWorld.describe({ building: 1, index: 0 }) === 'open', 'Bot failed to open closed door on its path');
    assert(hDoor.bandits.hasLineOfSight(bot.pos.x, 1.5, bot.pos.z, 0, 1.4, 2.5), 'LOS stayed blocked after bot opened door');
    hDoor.bandits.dispose();
  }

  // 9) Indoor ambusher waits silently crouched behind cover until player enters LOS.
  {
    const h = createHarness();
    h.world.addBox(-6, 3.8, 6, 4.2, 0, 3); // Wall at z=4 blocking initial LOS
    const rat = h.spawn.spawnBot(0, 0, 0, 'scavs', 'indoor', 'shotgun_pump', true, [], { role: 'ambusher' });
    const startPos = rat.pos.clone();
    for (let i = 0; i < 40; i++) h.bandits.update(1 / 60, 0, 0, 8, false, false);
    assert(rat.crouching === true, 'Indoor ambusher must wait in crouched stance');
    assert(!rat.ambushTriggered, 'Ambusher triggered without LOS');
    assert(rat.pos.distanceTo(startPos) < 0.05, 'Ambusher abandoned ambush spot prematurely');
    assert(h.playerDmg === 0, 'Ambusher fired through wall');

    // Step player into the room with direct LOS
    for (let i = 0; i < 90; i++) h.bandits.update(1 / 60, 0, 0, 3.0, false, false);
    const ratAfter: Bandit = h.bandits.list[0];
    assert(ratAfter.ambushTriggered && ratAfter.state === 'combat', 'Ambusher failed to engage when player entered LOS');
    assert(h.playerDmg > 0, 'Ambusher failed to deal damage once ambush triggered');
    h.bandits.dispose();
  }

  // 10) Boss + Guard escort: boss has high HP, guard orbits/protects alive boss and rushes aggressively if boss dies.
  {
    const h = createHarness();
    const bossPreset = {
      id: 'komendant',
      name: 'Комендант Мороз',
      hp: 520,
      weapon: 'rifle_ak' as const,
      mods: ['mod_suppressor', 'mod_ext_mag_ak', 'mod_flashlight'] as ('mod_suppressor' | 'mod_ext_mag_ak' | 'mod_flashlight')[],
      worn: { outfit: 'outfitMilitary' as const, head: 'helmetSwat' as const, face: 'gogglesTactical' as const, mask: 'balaclava' as const, torso: null, vest: 'vestSwat' as const, hands: 'tacticalGloves' as const, legs: null, feet: 'combatBoots' as const, back: 'backpackMilitary' as const, bag: null },
      tint: 0x582422,
    };
    const boss = h.spawn.spawnBot(0, 0, 0, 'boss', 'boss', 'rifle_ak', true, bossPreset.mods, { role: 'boss', squadId: 99, bossPreset });
    const guard = h.spawn.spawnBot(14, 0, 0, 'boss', 'boss', 'rifle_ak', true, [], { role: 'guard', squadId: 99, bossId: boss.id });
    assert(boss.maxHp >= 430, `Boss maxHp too low: ${boss.maxHp}`);
    assert(guard.maxHp === 270, `Guard maxHp mismatch: ${guard.maxHp}`);

    // While patrolling out of combat (player at 65m), guard moves back toward alive boss
    const initDistToBoss = guard.pos.distanceTo(boss.pos);
    for (let i = 0; i < 120; i++) h.bandits.update(1 / 60, 0, 0, 65, false, false);
    assert(guard.pos.distanceTo(boss.pos) < initDistToBoss - 1.5, 'Escort guard failed to stay with/return to living boss');

    // Kill boss and verify guard sees player at 18m and pushes aggressively toward player
    boss.hit(2000, 0, 20, true, 'limbs');
    assert(boss.isDead, 'Boss should be dead');
    const guardStartDistToPlayer = guard.pos.distanceTo(new Vector3(guard.pos.x, 0, 20));
    for (let i = 0; i < 120; i++) h.bandits.update(1 / 60, guard.pos.x, 0, 20, false, false);
    const guardEndDistToPlayer = guard.pos.distanceTo(new Vector3(guard.pos.x, 0, 20));
    assert(guardEndDistToPlayer < guardStartDistToPlayer - 2.0, `Enraged guard did not aggressively push player after boss death (${guardStartDistToPlayer.toFixed(2)} -> ${guardEndDistToPlayer.toFixed(2)})`);
    h.bandits.dispose();
  }

  // 11) Two-handed 2-bone IK pose: elbows bend naturally and rifle barrel points at target (no zombie arms).
  {
    const h = createHarness();
    const bot = h.spawn.spawnBot(0, 0, 0, 'scavs', 'street', 'rifle_ak', true, [], {
      bossPreset: {
        id: 'ik_test',
        name: 'IKBot',
        hp: 200,
        weapon: 'rifle_ak',
        mods: [],
        worn: { outfit: null, head: null, face: null, mask: null, torso: 'hoodie', vest: null, hands: null, legs: 'jeans', feet: 'boots', back: null, bag: null },
        tint: 0x444444,
      },
    });
    bot.state = 'combat';
    bot.reactT = 0;
    bot.aiming = 1;
    // Place target directly along +Z at 12m; lock bot yaw toward target and run updates to converge aimBlend=1
    for (let i = 0; i < 35; i++) {
      bot.aiming = 1;
      bot.yaw = 0;
      h.bandits.update(1 / 60, 0, 0, 12, false, false);
    }
    const vis = bot.visual;
    assert(vis !== null && vis.gunModel !== null, 'Bot rig & gunModel missing after update');
    bot.root.updateMatrixWorld(true);
    const getPos = (name: string) => vis.rig.bone(name).getWorldPosition(new Vector3());
    const shR = getPos('RightArm');
    const elR = getPos('RightForeArm');
    const haR = getPos('RightHand');
    const shL = getPos('LeftArm');
    const elL = getPos('LeftForeArm');
    const haL = getPos('LeftHand');
    const uR = elR.clone().sub(shR).normalize();
    const fR = haR.clone().sub(elR).normalize();
    const uL = elL.clone().sub(shL).normalize();
    const fL = haL.clone().sub(elL).normalize();
    assert(Math.abs(shL.z - shR.z) > 0.04, `Torso lacks bladed twist (|shL.z - shR.z|=${Math.abs(shL.z - shR.z).toFixed(3)})`);
    assert(uR.dot(fR) < 0.96, `Right arm stiff/straight like zombie pose (dot=${uR.dot(fR).toFixed(3)})`);
    assert(uL.dot(fL) < 0.96, `Left arm stiff/straight like zombie pose (dot=${uL.dot(fL).toFixed(3)})`);

    // Check rifle barrel (-Z local on GunModel) points toward target (+Z)
    const barrelWorld = new Vector3(0, 0, -1).applyQuaternion(vis.gunModel.root.getWorldQuaternion(new Quaternion())).normalize();
    const toTarget = new Vector3(0 - bot.pos.x, 0, 12 - bot.pos.z).normalize();
    const horizBarrel = new Vector3(barrelWorld.x, 0, barrelWorld.z).normalize();
    assert(horizBarrel.dot(toTarget) >= 0.90, `Weapon barrel misaligned with target (dot=${horizBarrel.dot(toTarget).toFixed(3)})`);
    h.bandits.dispose();
  }

  console.log('[banditTest] ALL 11 SUITES PASSED (walls/doors, no live loot, 2x HP, zonal armor, factions, doors, ambushers, bosses, 2-bone IK).');
  return 0;
}
