import './domStub';
import { type Group, Vector3 } from 'three';
import { loadBody } from '../characters/assets';
import { Viewmodel, type ViewmodelFrame } from '../player/Viewmodel';
import { capacityOf, GUN_IDS, GUNS } from '../weapons/guns';
import { type AmmoSource, type GunInput, GunState, newInst } from '../weapons/gunState';
import { gunLook } from './gunChecks';
import { loadCharactersNode } from './nodeCharacters';

/**
 * Automated sequence check across all 7 firearms on SWAT sleeved rig:
 *  1) ADS pose: sight alignment & roll/pitch, left/right elbow below eye ceiling, zero near-plane cut, RMB + R cancels ADS.
 *  2) Reload & ReloadEmpty: elbow ceiling held, mag clearly in left hand and inside camera frame (4 mag guns),
 *     5-round brass clip in left hand (rifle_hunting), red shell in left hand (shotgun_pump).
 *  3) checkMag: mag detached in left hand inside viewport, live visible brass rounds (>0 full, 0 + follower empty),
 *     and top brass cartridge projected cleanly in view; rifle_hunting shows open breech + visible rounds.
 */

const none: GunInput = { trigger: false, pulled: false, reload: false, mode: false, inspect: false, bash: false, canFire: true };
const idleFrame: ViewmodelFrame = { lookX: 0, lookY: 0, stepPhase: 0, speed: 0, sprinting: false, flashlightOn: false };
const plenty = (): AmmoSource => ({ count: () => 999, take: (_a, n) => n, give: () => {}, spareMags: () => 9, takeMag: () => true });

function projectCamera(vm: Viewmodel, worldPos: Vector3): Vector3 {
  vm.camera.updateMatrixWorld(true);
  return worldPos.clone().project(vm.camera);
}

function insideView(ndc: Vector3, maxX = 0.85, minY = -0.82, maxY = 0.78): boolean {
  return Number.isFinite(ndc.x) && Number.isFinite(ndc.y) && Math.abs(ndc.x) < maxX && ndc.y >= minY && ndc.y <= maxY && ndc.z < 1;
}

export async function main(): Promise<number> {
  await loadCharactersNode();
  await loadBody('swat_m');

  const fails: string[] = [];
  const check = (ok: boolean, msg: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
    if (!ok) fails.push(msg);
  };

  for (const id of GUN_IDS) {
    const g = GUNS[id];
    const vm = new Viewmodel();
    vm.setBody('swat_m', 1);
    vm.setAspect(16 / 9);
    vm.setDaylight(1);
    vm.equip(id);

    const inst = newInst(id, g.capacity + 1);
    const gs = new GunState(id, inst, plenty());
    const step = (inp: Partial<GunInput> = {}) => {
      gs.update(1 / 60, { ...none, ...inp });
      const gv = vm.gunView;
      gv.action = gs.action;
      gv.t = gs.t;
      gv.duration = gs.duration;
      gv.open = gs.open;
      gv.chamber = inst.chamber;
      gv.mag = inst.mag;
      gv.capacity = capacityOf(id, inst.mods);
      vm.fixedUpdate(1 / 60, false);
      vm.update(1 / 60, idleFrame);
    };

    for (let i = 0; i < 90; i++) step();

    // 1. ADS check + ADS cancellation on reload
    vm.gunView.ads = true;
    for (let i = 0; i < 60; i++) step();
    const lookAds = gunLook(vm, id);
    const elbowAdsR = vm.rig.right.pose.elbow.y;
    const elbowAdsL = vm.rig.left.pose.elbow.y;
    check(
      Math.abs(lookAds.roll) < 1 && Math.abs(lookAds.pitch) < 1 && Math.abs(lookAds.yaw) < 1,
      `${id} ADS alignment ok (roll=${lookAds.roll.toFixed(2)}°, pitch=${lookAds.pitch.toFixed(2)}°, yaw=${lookAds.yaw.toFixed(2)}°)`,
    );
    check(lookAds.nearCut === 0, `${id} ADS nearCut=${lookAds.nearCut}`);
    check(
      elbowAdsL <= -0.12 && elbowAdsR <= -0.12,
      `${id} ADS elbows below eye ceiling (L=${elbowAdsL.toFixed(3)}, R=${elbowAdsR.toFixed(3)}, swL=${(vm.rig.left.pose.swivel * 57.3).toFixed(1)}°, wL=${vm.rig.left.pose.elbow.z.toFixed(3)})`,
    );

    if (g.feed === 'mag') {
      inst.mag = Math.max(0, Math.floor(g.capacity / 2));
    } else if (g.feed === 'tube' || g.feed === 'internal') {
      inst.mag = Math.max(0, g.capacity - 1);
      inst.chamber = true;
    } else {
      inst.chamber = false;
    }
    step({ reload: true });
    for (let i = 0; i < 35; i++) step();
    check(vm.ads < 0.1, `${id} holding ADS during reload exits ADS cleanly (ads=${vm.ads.toFixed(3)})`);
    vm.gunView.ads = false;
    for (let i = 0; i < 350 && gs.busy; i++) step();

    // 2. Reload & ReloadEmpty sequence checks
    const runs = g.feed === 'mag' ? [false, true] : [true];
    for (const empty of runs) {
      if (empty) {
        inst.mag = 0;
        inst.chamber = false;
      } else {
        inst.mag = Math.max(0, Math.floor(g.capacity / 2));
        inst.chamber = true;
      }
      for (let i = 0; i < 20; i++) step();
      step({ reload: true });
      let maxElbL = -99, maxElbR = -99, maxReachErr = 0, badNan = false, badReachAt = '';
      let sawInsertMag = false, magDistOk = false, magInView = false;
      let sawClipInHand = false, clipInView = false;
      let sawShellInHand = false, shellInView = false;

      const vmPriv = vm as unknown as { shell: Group; rifleClip: Group };

      for (let i = 0; i < 500 && gs.busy; i++) {
        step();
        maxElbL = Math.max(maxElbL, vm.rig.left.pose.elbow.y);
        maxElbR = Math.max(maxElbR, vm.rig.right.pose.elbow.y);
        const k = gs.duration > 0 ? gs.t / gs.duration : 0;
        if (vm.rig.left.pose.reachErr > maxReachErr) {
          maxReachErr = vm.rig.left.pose.reachErr;
          badReachAt = `${gs.action}@${k.toFixed(2)}`;
        }
        const out = vm.gunPose;
        if (!Number.isFinite(out.pos.x) || !Number.isFinite(out.leftGrip.x) || !Number.isFinite(out.magPos.x)) badNan = true;

        if (g.feed === 'mag' && (gs.action === 'reload' || gs.action === 'reloadEmpty') && k >= 0.48 && k <= 0.60) {
          sawInsertMag = true;
          if (!out.magOnGun && out.magShown && out.left === 'mag') {
            if (out.leftGrip.distanceTo(out.magPos) < 0.16) magDistOk = true;
            const ndcTop = projectCamera(vm, out.magPos);
            const ndcMid = projectCamera(vm, out.magPos.clone().add(new Vector3(0, -0.05, 0)));
            if (insideView(ndcTop) || insideView(ndcMid)) magInView = true;
          }
        }
        if (id === 'rifle_hunting' && gs.action === 'loadOne' && k >= 0.30 && k <= 0.50) {
          sawClipInHand = vmPriv.rifleClip.visible && !vmPriv.shell.visible;
          const wp = new Vector3();
          vmPriv.rifleClip.getWorldPosition(wp);
          if (insideView(projectCamera(vm, wp))) clipInView = true;
        }
        if (id === 'shotgun_pump' && gs.action === 'loadOne' && k >= 0.30 && k <= 0.48) {
          sawShellInHand = vmPriv.shell.visible && !vmPriv.rifleClip.visible;
          if (insideView(projectCamera(vm, out.leftGrip), 0.85, -0.82, 0.82)) shellInView = true;
        }
      }

      const tag = `${id} ${empty ? 'empty' : 'tactical'}`;
      check(!badNan && maxReachErr < 0.05, `${tag}: no NaN & reachErr=${maxReachErr.toFixed(4)} (< 0.05, ${badReachAt})`);
      check(maxElbL <= -0.10 && maxElbR <= -0.10, `${tag}: elbows low (L=${maxElbL.toFixed(3)}, R=${maxElbR.toFixed(3)})`);
      if (g.feed === 'mag') {
        check(sawInsertMag && magDistOk && magInView, `${tag}: left hand holds visible mag inside viewport during insert`);
      } else if (id === 'rifle_hunting') {
        check(sawClipInHand && clipInView, `${tag}: 5-round .308 clip visible in left hand inside viewport`);
      } else if (id === 'shotgun_pump') {
        check(sawShellInHand && shellInView, `${tag}: 12g shell visible in left hand inside viewport`);
      }
    }

    // 3. checkMag: mag + cartridges visible in left hand (full) and empty follower (0)
    if (g.feed === 'mag') {
      inst.mag = g.capacity;
      inst.chamber = true;
      for (let i = 0; i < 20; i++) step();
      step({ checkMag: true });
      let checked = false;
      for (let i = 0; i < 300 && gs.busy; i++) {
        step();
        const k = gs.duration > 0 ? gs.t / gs.duration : 0;
        if (gs.action === 'checkMag' && k >= 0.48 && !checked) {
          checked = true;
          const out = vm.gunPose;
          const gm = vm.gunModel!;
          gm.root.updateWorldMatrix(true, true);
          const magNdc = projectCamera(vm, out.magPos);
          const topRound = gm.magAmmoGroup.children.find((c) => c.visible);
          const roundWp = new Vector3();
          if (topRound) topRound.getWorldPosition(roundWp);
          const roundNdc = topRound ? projectCamera(vm, roundWp) : new Vector3(99, 99, 99);
          check(
            !out.magOnGun && out.magShown && out.left === 'mag' && insideView(magNdc, 0.85, -0.78, 0.78),
            `${id} checkMag (full): mag detached in left hand inside view (ndc=${magNdc.x.toFixed(2)},${magNdc.y.toFixed(2)})`,
          );
          check(
            gm.visibleMagRounds > 0 && !gm.followerVisible && insideView(roundNdc, 0.85, -0.78, 0.78),
            `${id} checkMag (full): brass cartridges visible (${gm.visibleMagRounds}) inside view (ndc=${roundNdc.x.toFixed(2)},${roundNdc.y.toFixed(2)})`,
          );
        }
      }
      for (let i = 0; i < 30; i++) step();
      inst.mag = 0;
      inst.chamber = true;
      step({ checkMag: true });
      let checkedEmpty = false;
      for (let i = 0; i < 300 && gs.busy; i++) {
        step();
        const k = gs.duration > 0 ? gs.t / gs.duration : 0;
        if (gs.action === 'checkMag' && k >= 0.48 && !checkedEmpty) {
          checkedEmpty = true;
          const gm = vm.gunModel!;
          check(
            gm.visibleMagRounds === 0 && gm.followerVisible,
            `${id} checkMag (empty): 0 rounds & follower visible (rounds=${gm.visibleMagRounds}, follower=${gm.followerVisible})`,
          );
        }
      }
    } else if (id === 'rifle_hunting') {
      inst.mag = 5;
      inst.chamber = true;
      for (let i = 0; i < 20; i++) step();
      step({ checkMag: true });
      let checked = false;
      for (let i = 0; i < 300 && gs.busy; i++) {
        step();
        const k = gs.duration > 0 ? gs.t / gs.duration : 0;
        if (gs.action === 'checkMag' && k >= 0.48 && !checked) {
          checked = true;
          const out = vm.gunPose;
          const gm = vm.gunModel!;
          check(
            out.boltLift > 0.8 && out.slide > 0.02 && gm.visibleBreechRounds > 0,
            `${id} checkMag: open breech shows .308 rounds (lift=${out.boltLift.toFixed(2)}, slide=${out.slide.toFixed(3)}, rounds=${gm.visibleBreechRounds})`,
          );
        }
      }
    }
  }

  console.log(`\nreloadSeqTest: ${fails.length} failures`);
  return fails.length === 0 ? 0 : 1;
}
