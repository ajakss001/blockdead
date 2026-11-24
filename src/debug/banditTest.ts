import './domStub';
import { Scene } from 'three';
import { StaticBatch } from '../render/StaticBatch';
import { applyZonalArmor } from '../systems/Armor';
import { BANDIT_BODY_ID, Bandits, type BanditWorld } from '../systems/Bandits';
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
  spawnBot(rx: number, sy: number, rz: number, faction: 'scavs' | 'pmc' | 'snipers', spawnKind: 'street' | 'indoor' | 'sniper', weapon: string, isGun: boolean, mods?: string[]): void;
}

export async function main(): Promise<number> {
  await loadCharactersNode();

  const createHarness = () => {
    const scene = new Scene();
    const world = new CollisionWorld();
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
    // Player pressed near the partition wall inside Bedroom (z ~ 5.5, x ~ 5.45).
    const px = 5.45;
    const py = 0;
    const pz = 5.5;
    assert(!h.bandits.hasLineOfSight(bot.pos.x, bot.pos.y + 1.5, bot.pos.z, px, py + 1.56, pz), 'Bot sees through 0.12m house partition wall');
    bot.state = 'combat';
    bot.reactT = 0;
    for (let i = 0; i < 180; i++) {
      h.bandits.update(1 / 60, px, py, pz, false, false);
    }
    assert(h.playerDmg === 0, `Bot damaged player through house partition (${h.playerDmg} dmg)`);
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
    // Solid wall at z = 0 with a 1.0 m doorway gap [-0.5, 0.5]
    h.world.addBox(-5, -0.1, -0.5, 0.1, 0, 3);
    h.world.addBox(0.5, -0.1, 5, 0.1, 0, 3);
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

  console.log('[banditTest] ALL 6 SUITES PASSED (wall/floor/roof/door LOS, no live loot, 2x HP, unified zonal armor).');
  return 0;
}
