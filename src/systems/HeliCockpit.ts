import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  type Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type Scene,
  SRGBColorSpace,
} from 'three';
import { PERIMETER_RADIUS } from './Helicopter';

export interface HeliCockpitState {
  altitude: number;
  speedKmh: number;
  vsi: number;
  rpmPct: number;
  fuel: number;
  hull: number;
  yaw: number;
  pitch: number;
  roll: number;
  x: number;
  z: number;
  stickFwd: number;
  stickRight: number;
  distToPerimeter: number;
}

/**
 * First-person 3D Mi-8 cockpit overlay mounted in the depth-cleared viewmodel scene:
 * matte charcoal instrument console, thin canopy frame, animated cyclic stick (РУС),
 * and two live `CanvasTexture` MFDs (Left: КПИ artificial horizon & flight tapes; Right: tactical perimeter radar).
 */
export class HeliCockpit {
  readonly root = new Group();
  private readonly stickPivot = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly textures: CanvasTexture[] = [];

  private kpiCtx: CanvasRenderingContext2D | null = null;
  private kpiTex: CanvasTexture | null = null;

  private mapCtx: CanvasRenderingContext2D | null = null;
  private mapTex: CanvasTexture | null = null;

  private redrawAccum = 1;
  private blinkPhase = 0;

  constructor(parentScene: Scene) {
    this.root.visible = false;
    this.root.name = 'heliCockpit';
    parentScene.add(this.root);

    const regG = <T extends BufferGeometry>(g: T): T => {
      this.geometries.push(g);
      return g;
    };
    const regM = <T extends Material>(m: T): T => {
      this.materials.push(m);
      return m;
    };

    const consoleMat = regM(new MeshStandardMaterial({ color: 0x1a1e23, roughness: 0.9, metalness: 0.14 }));
    const frameMat = regM(new MeshStandardMaterial({ color: 0x15181c, roughness: 0.85, metalness: 0.22 }));
    const trimMat = regM(new MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.72, metalness: 0.35 }));
    const rubberMat = regM(new MeshStandardMaterial({ color: 0x111214, roughness: 0.96, metalness: 0.04 }));
    const accentRedMat = regM(new MeshStandardMaterial({ color: 0x9c2824, roughness: 0.55, metalness: 0.15 }));
    const glassMat = regM(
      new MeshBasicMaterial({
        color: 0x8db2c8,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
        fog: false,
      }),
    );

    const addPart = (g: BufferGeometry, m: Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Mesh => {
      const mesh = new Mesh(regG(g), m);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      this.root.add(mesh);
      return mesh;
    };

    // Main angled dashboard housing & hooded glare shield
    addPart(new BoxGeometry(1.16, 0.28, 0.36), consoleMat, 0, -0.35, -0.86, -0.36, 0, 0);
    addPart(new BoxGeometry(1.22, 0.045, 0.42), frameMat, 0, -0.19, -0.84, -0.18, 0, 0);
    // Center switch pedestal below dash
    addPart(new BoxGeometry(0.24, 0.24, 0.44), frameMat, 0, -0.52, -0.74, -0.12, 0, 0);

    // Slim cockpit windshield struts (pillars kept thin & high/wide for maximum street & rooftop visibility)
    addPart(new BoxGeometry(0.026, 0.86, 0.036), frameMat, 0, 0.21, -0.96, -0.32, 0, 0);
    addPart(new BoxGeometry(0.055, 0.92, 0.055), frameMat, -0.60, 0.19, -0.78, -0.30, 0, -0.16);
    addPart(new BoxGeometry(0.055, 0.92, 0.055), frameMat, 0.60, 0.19, -0.78, -0.30, 0, 0.16);
    // Overhead brow beam
    addPart(new BoxGeometry(1.24, 0.075, 0.14), consoleMat, 0, 0.56, -0.58, 0.16, 0, 0);
    // Subtle translucent windshield sheen panel
    addPart(new PlaneGeometry(1.14, 0.72), glassMat, 0, 0.16, -0.88, -0.32, 0, 0);

    // Animated Cyclic Stick (РУС) mounted lower-center
    this.stickPivot.position.set(0, -0.60, -0.55);
    this.root.add(this.stickPivot);
    const addStickPart = (g: BufferGeometry, m: Material, x: number, y: number, z: number, rx = 0) => {
      const mesh = new Mesh(regG(g), m);
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx;
      this.stickPivot.add(mesh);
    };
    addStickPart(new CylinderGeometry(0.048, 0.068, 0.09, 10), rubberMat, 0, 0.03, 0);
    addStickPart(new CylinderGeometry(0.014, 0.016, 0.26, 8), trimMat, 0, 0.17, -0.02, -0.12);
    addStickPart(new BoxGeometry(0.044, 0.095, 0.055), rubberMat, 0, 0.30, -0.04, 0.18);
    addStickPart(new CylinderGeometry(0.008, 0.008, 0.018, 6), accentRedMat, 0, 0.32, -0.068, Math.PI * 0.5);

    // MFD setup (Left: КПИ artificial horizon, Right: Tactical perimeter map)
    if (typeof document !== 'undefined') {
      const makeMfd = (xPos: number, rotY: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 384;
        const ctx = canvas.getContext('2d');
        const tex = new CanvasTexture(canvas);
        tex.colorSpace = SRGBColorSpace;
        this.textures.push(tex);
        const bezel = new Mesh(regG(new BoxGeometry(0.32, 0.24, 0.03)), trimMat);
        bezel.position.set(xPos, -0.255, -0.735);
        bezel.rotation.set(-0.34, rotY, 0, 'YXZ');
        this.root.add(bezel);

        const screen = new Mesh(
          regG(new PlaneGeometry(0.285, 0.214)),
          regM(new MeshBasicMaterial({ map: tex, fog: false, toneMapped: false })),
        );
        screen.position.set(0, 0, 0.017);
        bezel.add(screen);
        return { canvas, ctx, tex };
      };

      const left = makeMfd(-0.205, 0.11);
      this.kpiCtx = left.ctx;
      this.kpiTex = left.tex;

      const right = makeMfd(0.205, -0.11);
      this.mapCtx = right.ctx;
      this.mapTex = right.tex;
    }
  }

  update(dt: number, s: HeliCockpitState): void {
    this.blinkPhase += dt * 4.5;
    // Animate cyclic stick smoothly
    const tgtX = MathUtils.clamp(-s.stickFwd * 0.22, -0.26, 0.26);
    const tgtZ = MathUtils.clamp(-s.stickRight * 0.24, -0.28, 0.28);
    this.stickPivot.rotation.x = MathUtils.lerp(this.stickPivot.rotation.x, tgtX, Math.min(1, dt * 12));
    this.stickPivot.rotation.z = MathUtils.lerp(this.stickPivot.rotation.z, tgtZ, Math.min(1, dt * 12));

    // Gentle cockpit vibration scaled with rotor RPM
    const vib = s.rpmPct > 20 ? (s.rpmPct / 100) * 0.0012 : 0;
    this.root.position.set(
      Math.sin(this.blinkPhase * 11) * vib,
      Math.cos(this.blinkPhase * 15) * vib,
      0,
    );

    if (!this.kpiCtx || !this.mapCtx) return;
    this.redrawAccum += dt;
    if (this.redrawAccum < 0.055) return; // ~18 Hz crisp updates
    this.redrawAccum = 0;
    this.drawKpi(s);
    this.drawMap(s);
  }

  private drawKpi(s: HeliCockpitState): void {
    const g = this.kpiCtx!;
    const W = 512;
    const H = 384;
    const blink = Math.sin(this.blinkPhase * 2.2) > 0;

    g.fillStyle = '#070b0e';
    g.fillRect(0, 0, W, H);

    // Center Artificial Horizon area
    const cx = 256;
    const cy = 192;
    const hw = 132;
    const hh = 112;
    g.save();
    g.beginPath();
    g.rect(cx - hw, cy - hh, hw * 2, hh * 2);
    g.clip();

    g.translate(cx, cy);
    g.rotate(-s.roll * 1.4);
    const pitchPx = MathUtils.clamp(s.pitch * 320, -90, 90);
    g.translate(0, pitchPx);

    // Sky & Ground
    g.fillStyle = '#1b5f9e';
    g.fillRect(-300, -300, 600, 300);
    g.fillStyle = '#624121';
    g.fillRect(-300, 0, 600, 300);
    g.strokeStyle = '#e8f4f8';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(-260, 0);
    g.lineTo(260, 0);
    g.stroke();

    // Pitch ladder marks
    g.strokeStyle = 'rgba(232, 244, 248, 0.85)';
    g.fillStyle = '#e8f4f8';
    g.font = 'bold 13px monospace';
    g.textAlign = 'right';
    for (const deg of [-20, -10, 10, 20]) {
      const py = -deg * 3.8;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(-42, py);
      g.lineTo(-14, py);
      g.moveTo(14, py);
      g.lineTo(42, py);
      g.stroke();
      g.fillText(`${Math.abs(deg)}`, -48, py + 4);
    }
    g.restore();

    // Fixed yellow center aircraft datum chevron
    g.strokeStyle = '#ffd238';
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(cx - 40, cy);
    g.lineTo(cx - 16, cy);
    g.lineTo(cx, cy + 12);
    g.lineTo(cx + 16, cy);
    g.lineTo(cx + 40, cy);
    g.stroke();
    g.strokeStyle = '#385844';
    g.lineWidth = 2;
    g.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);

    // Left Tape: Airspeed (km/h)
    g.fillStyle = '#0c1614';
    g.fillRect(10, 80, 96, 224);
    g.strokeStyle = '#2d4d3a';
    g.strokeRect(10, 80, 96, 224);
    g.fillStyle = '#8ef5a2';
    g.font = 'bold 13px monospace';
    g.textAlign = 'center';
    g.fillText('СКОР км/ч', 58, 98);
    const spdBase = Math.floor(s.speedKmh / 20) * 20;
    g.font = '12px monospace';
    for (let v = spdBase - 40; v <= spdBase + 60; v += 20) {
      if (v < 0) continue;
      const y = cy - (v - s.speedKmh) * 1.4;
      if (y < 108 || y > 296) continue;
      g.fillStyle = '#6ec884';
      g.fillRect(86, y, 16, 1.5);
      g.textAlign = 'right';
      g.fillText(String(v), 80, y + 4);
    }
    g.fillStyle = '#041208';
    g.fillRect(14, cy - 16, 84, 32);
    g.strokeStyle = '#52e070';
    g.strokeRect(14, cy - 16, 84, 32);
    g.fillStyle = '#b4ffc2';
    g.font = 'bold 20px monospace';
    g.textAlign = 'center';
    g.fillText(String(Math.round(s.speedKmh)).padStart(3, '0'), 56, cy + 7);

    // Right Tape: Radio Altimeter (Hрв) & Vertical Speed (Vy)
    g.fillStyle = '#0c1614';
    g.fillRect(406, 80, 96, 224);
    g.strokeStyle = '#2d4d3a';
    g.strokeRect(406, 80, 96, 224);
    g.fillStyle = '#8ef5a2';
    g.font = 'bold 13px monospace';
    g.textAlign = 'center';
    g.fillText('Hрв / Vy', 454, 98);

    g.fillStyle = '#041208';
    g.fillRect(410, cy - 34, 88, 30);
    g.strokeStyle = '#52e070';
    g.strokeRect(410, cy - 34, 88, 30);
    g.fillStyle = '#b4ffc2';
    g.font = 'bold 18px monospace';
    g.fillText(`${s.altitude.toFixed(1)}м`, 454, cy - 13);

    const vsiColor = s.vsi < -4.5 ? '#ff5544' : s.vsi < -1.0 ? '#ffbd4a' : '#8ef5a2';
    g.fillStyle = '#041208';
    g.fillRect(410, cy + 8, 88, 28);
    g.strokeStyle = vsiColor;
    g.strokeRect(410, cy + 8, 88, 28);
    g.fillStyle = vsiColor;
    g.font = 'bold 15px monospace';
    g.fillText(`${s.vsi >= 0 ? '+' : ''}${s.vsi.toFixed(1)}`, 454, cy + 27);

    // Bottom Compass Heading Tape
    const rawDeg = ((-s.yaw * 180) / Math.PI) % 360;
    const hdg = Math.round((rawDeg + 360) % 360);
    g.fillStyle = '#0c1614';
    g.fillRect(114, 314, 284, 58);
    g.strokeStyle = '#2d4d3a';
    g.strokeRect(114, 314, 284, 58);
    g.fillStyle = '#6ec884';
    g.font = '12px monospace';
    g.textAlign = 'center';
    for (let off = -60; off <= 60; off += 15) {
      const x = cx + off * 2.1;
      const deg = ((hdg + off) % 360 + 360) % 360;
      g.fillRect(x, 316, 1.5, 8);
      if (off % 30 === 0) g.fillText(String(deg).padStart(3, '0'), x, 336);
    }
    g.fillStyle = '#ffd238';
    g.fillRect(cx - 28, 341, 56, 24);
    g.fillStyle = '#08100a';
    g.font = 'bold 17px monospace';
    g.fillText(`${String(hdg).padStart(3, '0')}°`, cx, 359);

    // Top Systems Strip: RPM, FUEL, HULL with blinking warnings
    const pill = (x: number, w: number, label: string, val: string, warn: boolean) => {
      const alertBg = warn && blink ? '#881818' : warn ? '#441212' : '#0f2018';
      g.fillStyle = alertBg;
      g.fillRect(x, 12, w, 54);
      g.strokeStyle = warn ? '#ff4a40' : '#3a664a';
      g.lineWidth = 2;
      g.strokeRect(x, 12, w, 54);
      g.fillStyle = warn ? '#ffd0cc' : '#8fd4a0';
      g.font = 'bold 13px monospace';
      g.textAlign = 'center';
      g.fillText(label, x + w * 0.5, 30);
      g.fillStyle = warn ? '#ffffff' : '#ccffd8';
      g.font = 'bold 20px monospace';
      g.fillText(val, x + w * 0.5, 56);
    };

    const fuelPct = Math.round(s.fuel * 100);
    const hullPct = Math.round(s.hull * 100);
    pill(14, 152, 'ОБОРОТЫ НВ', `${s.rpmPct}%`, s.rpmPct < 72);
    pill(180, 152, 'ТОПЛИВО', `${fuelPct}%`, s.fuel < 0.20);
    pill(346, 152, 'БРОНЯ/УЗЛЫ', `${hullPct}%`, s.hull < 0.35);

    this.kpiTex!.needsUpdate = true;
  }

  private drawMap(s: HeliCockpitState): void {
    const g = this.mapCtx!;
    const W = 512;
    const H = 384;
    const cx = 256;
    const cy = 198;
    const maxRange = PERIMETER_RADIUS + 260;
    const scale = 148 / maxRange;

    g.fillStyle = '#06120b';
    g.fillRect(0, 0, W, H);

    // Header
    g.fillStyle = '#0d2216';
    g.fillRect(10, 10, W - 20, 42);
    g.strokeStyle = '#2d5a3d';
    g.strokeRect(10, 10, W - 20, 42);
    g.fillStyle = '#8ef5a2';
    g.font = 'bold 16px monospace';
    g.textAlign = 'left';
    g.fillText('НАВИГАЦИЯ · ПЕРИМЕТР', 22, 36);
    g.textAlign = 'right';
    const outside = s.distToPerimeter <= 0;
    g.fillStyle = outside ? '#6bff8e' : '#ffbd4a';
    g.fillText(outside ? 'ЗА ПЕРИМЕТРОМ' : `${Math.round(s.distToPerimeter)} м`, W - 22, 36);

    // Radar grid rings (centered on city center 0,0)
    g.strokeStyle = 'rgba(70, 175, 105, 0.22)';
    g.lineWidth = 1.2;
    for (const r of [500, 1000]) {
      g.beginPath();
      g.arc(cx, cy, r * scale, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(cx - 165, cy);
    g.lineTo(cx + 165, cy);
    g.moveTo(cx, cy - 140);
    g.lineTo(cx, cy + 140);
    g.stroke();

    // Downtown grid marker at (0,0)
    g.fillStyle = 'rgba(110, 210, 140, 0.25)';
    g.fillRect(cx - 12, cy - 12, 24, 24);
    g.fillStyle = '#70c48a';
    g.font = '11px monospace';
    g.textAlign = 'center';
    g.fillText('ЦЕНТР', cx, cy + 24);

    // Evacuation perimeter ring (R = 1400 m)
    g.save();
    g.strokeStyle = '#ff5440';
    g.lineWidth = 2.6;
    g.setLineDash([8, 6]);
    g.beginPath();
    g.arc(cx, cy, PERIMETER_RADIUS * scale, 0, Math.PI * 2);
    g.stroke();
    g.restore();

    // Helicopter blip & heading vector on tactical map
    const hx = cx + MathUtils.clamp(s.x * scale, -175, 175);
    const hz = cy + MathUtils.clamp(s.z * scale, -135, 135);
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);

    g.strokeStyle = '#52ffc4';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(hx, hz);
    g.lineTo(hx + fx * 34, hz + fz * 34);
    g.stroke();

    g.save();
    g.translate(hx, hz);
    g.rotate(-s.yaw);
    g.fillStyle = '#6bffda';
    g.beginPath();
    g.moveTo(0, -10);
    g.lineTo(8, 8);
    g.lineTo(0, 4);
    g.lineTo(-8, 8);
    g.closePath();
    g.fill();
    g.restore();

    // Bottom instruction bar
    g.fillStyle = '#0c1d13';
    g.fillRect(10, H - 46, W - 20, 34);
    g.strokeStyle = '#2d5a3d';
    g.strokeRect(10, H - 46, W - 20, 34);
    g.fillStyle = outside && s.altitude < 25 ? '#ffbd4a' : '#9ed4ae';
    g.font = 'bold 14px monospace';
    g.textAlign = 'center';
    const msg = outside
      ? s.altitude > 25
        ? 'ЭВАКУАЦИЯ ЗАВЕРШЕНА'
        : `НАБЕРИТЕ ВЫСОТУ > 25м (${s.altitude.toFixed(0)}м)`
      : `ПОКИНЬТЕ ПЕРИМЕТР 1400м НА ВЫСОТЕ > 25м · [V] КАМЕРА`;
    g.fillText(msg, cx, H - 24);

    this.mapTex!.needsUpdate = true;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
