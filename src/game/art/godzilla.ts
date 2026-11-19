// GODZILLA — drawn entirely in code.
// A skeletal rig (spine chain tail->head, IK legs, FK arms, hinged jaw, maple-leaf
// dorsal plates) rasterised straight to pixels with a 7-tone charcoal ramp,
// craggy hide texture, cool top light and a warm "burning city" under-rim.
import { Raster, Shade, rgb, hash2, bayer, rad, spline, ik, keys, clampi, type Anim, type AnimName, type Anchors, type CharArt } from "./raster";

export interface GPose {
  px: number; // pelvis offset
  py: number;
  rot: number; // whole body rotation about pelvis (knockdowns)
  torso: number; // abs angles, degrees
  neck: number;
  head: number;
  jaw: number; // 0..1
  armN: number[]; // [upper, fore] abs angles
  armF: number[];
  footN: number[]; // ankle [x, lift]
  footF: number[];
  tail: number[]; // 7 abs angles
}

const W = 336, H = 250, OX = 180, OY = 204;

const OUT = rgb(0x06080c);
const HIDE = [0x0d1117, 0x161c24, 0x202931, 0x2c373f, 0x3c494f, 0x526160, 0x70827b].map((h) => rgb(h));
const WARM = [0x55301f, 0x8f4a26, 0xd07a32].map((h) => rgb(h));
const BONE = [0x7a705e, 0xb3a98d, 0xe6dec2, 0xfbf7e8].map((h) => rgb(h));
const MOUTH = [0x2e0a12, 0x6a1820, 0xa63a3a].map((h) => rgb(h));
const PLATE = [0x1b222a, 0x333e48, 0x55636b, 0x84939a, 0xbdcaca, 0xeef6f2];

function hide(lv = 0): Shade {
  return (u, v, nx, ny, X, Y, r) => {
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    let l = 0.3 + ny * 0.44 + nz * 0.2;
    const cu = Math.floor(u / 3.3), cv = Math.floor((v * r) / 2.7);
    const t = hash2(cu + 91, cv + 17);
    l += (t - 0.5) * 0.17;
    if (hash2(cu * 7 + cv, cv * 3 - cu) > 0.87) l -= 0.15; // fissures in the hide
    l += (bayer(X, Y) - 0.5) * 0.05;
    const k = clampi(Math.floor(l * 7) + lv, 0, 6);
    const w = -ny;
    if (w > 0.9) return WARM[w > 0.965 && t > 0.3 ? 2 : 1]; // fire-lit underside rim
    if (w > 0.76 && bayer(X, Y) < 0.55) return WARM[0];
    return HIDE[k];
  };
}

const LEAF = [-0.5, 0, -0.68, 0.28, -0.4, 0.36, -0.62, 0.62, -0.28, 0.64, -0.22, 0.9, 0, 1, 0.16, 0.8, 0.44, 0.8, 0.3, 0.5, 0.62, 0.4, 0.46, 0];

function plate(r: Raster, bx: number, by: number, dx: number, dy: number, nx: number, ny: number, w: number, h: number, f: number, far: boolean) {
  const pts: number[] = [];
  if (h < 6.5) pts.push(bx - (dx * w) / 2, by - (dy * w) / 2, bx + nx * h, by + ny * h, bx + (dx * w) / 2, by + (dy * w) / 2);
  else for (let i = 0; i < LEAF.length; i += 2) pts.push(bx + dx * LEAF[i] * w + nx * LEAF[i + 1] * h, by + dy * LEAF[i] * w + ny * LEAF[i + 1] * h);
  const sx = r.X(bx, by), sy = r.Y(bx, by);
  const nsx = r.X(bx + nx, by + ny) - sx, nsy = r.Y(bx + nx, by + ny) - sy;
  const tsx = r.X(bx + dx, by + dy) - sx, tsy = r.Y(bx + dx, by + dy) - sy;
  const al = 128 + Math.round(clampi(f, 0, 1) * 100); // alpha encodes position along spine -> GPU glow sweep
  r.poly(pts, (X, Y) => {
    const qx = X + 0.5 - sx, qy = Y + 0.5 - sy;
    const b = (qx * nsx + qy * nsy) / h, a = Math.abs(qx * tsx + qy * tsy) / w;
    let k = Math.floor(b * 2.6 + a * 4.2 + (hash2(X, Y) - 0.5) * 0.8) + (far ? -1 : 0);
    k = clampi(k, 0, far ? 3 : 5);
    return rgb(PLATE[k], al);
  });
  r.flush(OUT);
}

function plateH(f: number): number {
  const K = [0, 4, 0.3, 11, 0.55, 18, 0.7, 26, 0.84, 35, 0.92, 25, 0.98, 12, 1, 7];
  for (let i = 0; i + 2 < K.length; i += 2) if (f <= K[i + 2]) return K[i + 1] + ((K[i + 3] - K[i + 1]) * (f - K[i])) / (K[i + 2] - K[i]);
  return 6;
}

function plates(r: Raster, ch: number[], far: boolean) {
  const n = ch.length / 3;
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(ch[i * 3] - ch[i * 3 - 3], ch[i * 3 + 1] - ch[i * 3 - 2]);
  const total = cum[n - 1];
  let s = far ? 24 : 12, seg = 1;
  while (s < total - 3) {
    const f = s / total;
    const h0 = plateH(f) * (far ? 0.7 : 1), w = h0 * 0.8 + 2;
    while (seg < n - 1 && cum[seg] < s) seg++;
    const i0 = (seg - 1) * 3, i1 = seg * 3;
    const t = (s - cum[seg - 1]) / Math.max(1e-6, cum[seg] - cum[seg - 1]);
    const x = ch[i0] + (ch[i1] - ch[i0]) * t, y = ch[i0 + 1] + (ch[i1 + 1] - ch[i0 + 1]) * t, rr = ch[i0 + 2] + (ch[i1 + 2] - ch[i0 + 2]) * t;
    let dx = ch[i1] - ch[i0], dy = ch[i1 + 1] - ch[i0 + 1];
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    const lx = -dy - dx * 0.22, ly = dx - dy * 0.22, ll = Math.hypot(lx, ly); // back normal, leaning toward the tail
    plate(r, x - dy * (rr - 3.5), y + dx * (rr - 3.5), dx, dy, lx / ll, ly / ll, w, h0, f, far);
    s += w * (far ? 0.95 : 0.68);
  }
}

function claws(r: Raster, x: number, y: number, ang: number, len: number, spread: number, n: number, wd = 2) {
  for (let i = 0; i < n; i++) {
    const a = rad(ang + (i - (n - 1) / 2) * spread);
    const cx = Math.cos(a), cy = Math.sin(a);
    const bx = x + cx * 1.5, by = y + cy * 1.5;
    r.poly([bx - cy * wd, by + cx * wd, bx + cx * len, by + cy * len, bx + cy * wd, by - cx * wd], BONE[2]);
    r.dot(bx + cx * (len - 1.5), by + cy * (len - 1.5), BONE[3]);
    r.dot(bx + cy * wd * 0.6, by - cx * wd * 0.6, BONE[0]);
  }
}

function leg(r: Raster, hx: number, hy: number, ax: number, lift: number, sh: Shade, mul: number) {
  const ay = 8 + lift;
  const [kx, ky] = ik(hx, hy, ax, ay, 31, 27, 1);
  r.limb([hx, hy, 17.5, kx, ky, 12.5], sh);
  r.limb([kx, ky, 11.5, ax, ay, 7.5], sh);
  const fa = rad(-10 - Math.max(0, lift) * 2.4);
  const tx = ax + Math.cos(fa) * 19, ty = ay + Math.sin(fa) * 19;
  r.limb([ax - 3, ay - 0.5, 7, ax, ay, 7.5, tx, ty - 0.5, 6.2], sh);
  claws(r, tx + 4, ty - 2.5, -6 - Math.max(0, lift) * 2.4, 10, 15, 3);
  r.flush(OUT, mul);
}

function arm(r: Raster, sx: number, sy: number, a: number[], sh: Shade, mul: number): number[] {
  const ex = sx + Math.cos(rad(a[0])) * 17, ey = sy + Math.sin(rad(a[0])) * 17;
  const hx = ex + Math.cos(rad(a[1])) * 16, hy = ey + Math.sin(rad(a[1])) * 16;
  r.limb([sx, sy, 7, ex, ey, 5.6], sh);
  r.limb([ex, ey, 5.4, hx, hy, 4.4], sh);
  r.limb([hx, hy, 4.6], sh);
  claws(r, hx + Math.cos(rad(a[1])) * 2, hy + Math.sin(rad(a[1])) * 2, a[1] - 6, 9, 30, 3, 1.25);
  r.flush(OUT, mul);
  return [hx, hy];
}

function draw(r: Raster, p: GPose): Anchors {
  const pvx = p.px, pvy = 62 + p.py;
  r.setT(OX, OY, p.rot, pvx, pvy);
  r.clipY = p.rot !== 0 && p.py >= 0 ? H - 1 : OY - 1; // airborne tumbles are not clipped by the ground
  const tr = rad(p.torso), nr = rad(p.neck);
  const tx = Math.cos(tr), ty = Math.sin(tr); // torso axis
  const fx = ty, fy = -tx; // "front" of torso
  const bel = [pvx + tx * 22 + fx * 3, pvy + ty * 22 + fy * 3];
  const che = [pvx + tx * 48, pvy + ty * 48];
  const nm = [che[0] + Math.cos(nr) * 12, che[1] + Math.sin(nr) * 12];
  const hb = [che[0] + Math.cos(nr) * 24, che[1] + Math.sin(nr) * 24];

  // spine chain: tail tip -> pelvis -> chest -> neck -> head base
  const TR = [20.5, 17.5, 14.5, 11.5, 9, 6.5, 4.5, 2.2];
  const tl: number[] = [];
  let x = pvx - 8, y = pvy - 5;
  tl.push(x, y, TR[0]);
  for (let i = 0; i < 7; i++) {
    x += Math.cos(rad(p.tail[i])) * 22;
    y += Math.sin(rad(p.tail[i])) * 22;
    tl.push(x, y, TR[i + 1]);
  }
  const cp: number[] = [];
  for (let i = 7; i >= 0; i--) cp.push(tl[i * 3], tl[i * 3 + 1], tl[i * 3 + 2]);
  cp.push(pvx, pvy, 23, bel[0], bel[1], 24.5, che[0], che[1], 19.5, nm[0], nm[1], 14.5, hb[0], hb[1], 11.5);
  const chain = spline(cp, 5);

  const sh = hide(0);
  const shx = che[0] + fx * 11 - tx * 8, shy = che[1] + fy * 11 - ty * 8; // shoulder

  // ---- far side limbs (darker)
  arm(r, shx + 3, shy + 2, p.armF, sh, 0.62);
  leg(r, pvx - 2, pvy - 5, p.footF[0], p.footF[1], sh, 0.62);

  // ---- dorsal plates (far row, then main row)
  plates(r, chain, true);
  plates(r, chain, false);

  // ---- body + head (single layer => seamless silhouette)
  r.limb(chain, sh);
  const ha = rad(p.head), hx = Math.cos(ha), hy = Math.sin(ha);
  const Hx = (lx: number, ly: number) => hb[0] + lx * hx - ly * hy;
  const Hy = (lx: number, ly: number) => hb[1] + lx * hy + ly * hx;
  // lower jaw (hinged)
  const ja = rad(p.head - 5 - p.jaw * 32), jx = Math.cos(ja), jy = Math.sin(ja);
  const J0x = Hx(5, -6), J0y = Hy(5, -6);
  r.limb([J0x, J0y, 5.6, J0x + jx * 9, J0y + jy * 9, 4.6, J0x + jx * 19, J0y + jy * 19, 3.2], sh);
  if (p.jaw > 0.12) {
    r.poly([Hx(6, -1), Hy(6, -1), Hx(26, -2.5), Hy(26, -2.5), J0x + jx * 19 - jy * 3, J0y + jy * 19 + jx * 3, J0x - jy * 5, J0y + jx * 5], (X, Y) => MOUTH[hash2(X >> 1, Y >> 1) > 0.62 ? 1 : 0]);
  }
  // cranium + snout, cut flat along the lip line
  const hbX = r.X(hb[0], hb[1]), hbY = r.Y(hb[0], hb[1]);
  const uX = r.X(hb[0] + hx, hb[1] + hy) - hbX, uY = r.Y(hb[0] + hx, hb[1] + hy) - hbY; // head +x in screen space
  const cut: Shade = (u, v, nx, ny, X, Y, rr) => {
    const qx = X + 0.5 - hbX, qy = Y + 0.5 - hbY;
    const lx = qx * uX + qy * uY, ly = qx * uY - qy * uX;
    if (lx > 6 && ly < -3) return 0;
    return sh(u, v, nx, ny, X, Y, rr);
  };
  r.limb([Hx(0, 0), Hy(0, 0), 11.5, Hx(7, 3.4), Hy(7, 3.4), 10.2], cut);
  r.limb([Hx(7, 3.4), Hy(7, 3.4), 9.8, Hx(15, 2.4), Hy(15, 2.4), 7.6, Hx(21.5, 1.6), Hy(21.5, 1.6), 6], cut);
  // teeth
  for (let lx = 11; lx < 26.5; lx += 2.5) r.dot(Hx(lx, -3.7), Hy(lx, -3.7), BONE[lx > 20 ? 3 : 2]);
  if (p.jaw > 0.3) for (let s = 8; s < 19; s += 2.6) r.dot(J0x + jx * s - jy * (5 - s * 0.1), J0y + jy * s + jx * (5 - s * 0.1), BONE[2]);
  // brow, eye, nostril
  r.line(Hx(8.5, 9.6), Hy(8.5, 9.6), Hx(15.5, 8), Hy(15.5, 8), HIDE[5]); // lit brow ridge
  r.line(Hx(9, 8.3), Hy(9, 8.3), Hx(16.5, 6.2), Hy(16.5, 6.2), HIDE[0]); // scowl
  r.line(Hx(11, 3.6), Hy(11, 3.6), Hx(15, 3.4), Hy(15, 3.4), HIDE[1]); // socket shadow
  r.dot(Hx(12, 5), Hy(12, 5), HIDE[0]);
  r.dot(Hx(23.5, 5.6), Hy(23.5, 5.6), HIDE[5]); // nose bump highlight
  r.dot(Hx(13.2, 5), Hy(13.2, 5), rgb(0xff9a1e, 250));
  r.dot(Hx(14.3, 5), Hy(14.3, 5), rgb(0xffe27a, 250));
  r.dot(Hx(25, 3.6), Hy(25, 3.6), HIDE[0]);
  r.flush(OUT);

  // ---- near side limbs
  leg(r, pvx + 3, pvy - 7, p.footN[0], p.footN[1], sh, 1);
  const hand = arm(r, shx, shy, p.armN, sh, 1);

  const mx = Hx(25, -4 - p.jaw * 3), my = Hy(25, -4 - p.jaw * 3);
  return { mouths: [r.X(mx, my), r.Y(mx, my)], hand: [r.X(hand[0], hand[1]), r.Y(hand[0], hand[1])] };
}

// ------------------------------------------------------------------ animation
const TAIL0 = [215, 225, 212, 195, 182, 170, 155];
const N: GPose = { px: 0, py: 0, rot: 0, torso: 74, neck: 58, head: -6, jaw: 0.08, armN: [-55, 15], armF: [-38, 34], footN: [-12, 0], footF: [15, 0], tail: TAIL0 };
const S = Math.sin, PI2 = Math.PI * 2;

const idle = (t: number): GPose => {
  const f = (PI2 * t) / 60;
  return { ...N, py: -1 + Math.cos(f), torso: 74 + S(f) * 1.5, neck: 58 + S(f - 0.6) * 2, head: -6 + S(f - 1) * 2.5, jaw: S(f) > 0.5 ? 0.2 : 0.08, armN: [-55 + 4 * S(f), 15 + 6 * S(f - 0.5)], armF: [-38 + 4 * S(f + 1), 34 + 5 * S(f)], tail: TAIL0.map((a, i) => a + S(f - i * 0.5) * (1.5 + i * 1.3)) };
};
const stepFoot = (ph: number): number[] => {
  ph -= Math.floor(ph);
  if (ph < 0.6) return [16 - 32 * (ph / 0.6), 0];
  const s = (ph - 0.6) / 0.4;
  return [-16 + 32 * s, S(Math.PI * s) * 10];
};
const walk = (t: number): GPose => {
  const ph = t / 56, f = PI2 * ph;
  const a = stepFoot(ph), b = stepFoot(ph + 0.5);
  return { ...N, py: -2.5 + 2.5 * Math.abs(S(f)), px: S(f * 2) * 1, torso: 71 + 3 * S(f), neck: 56 - 3 * S(f), head: -6 + 2 * S(f * 2), armN: [-55 + 10 * S(f), 15 + 8 * S(f)], armF: [-38 - 10 * S(f), 34 - 8 * S(f)], footN: [a[0] - 3, a[1]], footF: [b[0] + 5, b[1]], tail: TAIL0.map((v, i) => v + S(f - i * 0.6) * (2.5 + i * 1.2)) };
};
const FIRE: Partial<GPose> = { px: 4, py: -2, torso: 64, neck: 46, head: -12, jaw: 1, armN: [-30, 40], armF: [-20, 50], footN: [-17, 0], footF: [19, 0], tail: [205, 212, 200, 188, 178, 170, 160] };
const GRAB: Partial<GPose> = { px: 8, py: -2, torso: 60, neck: 46, head: -8, jaw: 0.7, armN: [5, -5], armF: [16, 6], footN: [-14, 0], footF: [23, 0] };
const DOWN: Partial<GPose> = { rot: 97, py: -41, torso: 80, neck: 76, head: 62, jaw: 0.5, armN: [10, 50], armF: [25, 60], footN: [5, -32], footF: [16, -27], tail: [263, 263, 268, 278, 293, 313, 333] };

const anims: Record<AnimName, Anim<GPose>> = {
  idle: { n: 6, step: 10, fn: idle },
  walk: { n: 8, step: 7, fn: walk },
  dash: { n: 2, step: 8, fn: (t) => ({ ...N, px: 7, py: -4, torso: 56, neck: 42, head: -4, jaw: 0.4, armN: [-20, 40], armF: [-10, 50], footN: t < 8 ? [-24, 2] : [22, 6], footF: t < 8 ? [26, 7] : [-20, 1], tail: [196, 192, 186, 181, 176, 172, 168] }) },
  bdash: { n: 2, step: 8, fn: (t) => ({ ...N, px: -6, py: -2, torso: 86, neck: 66, head: -14, armN: [-10, 30], armF: [0, 40], footN: t < 8 ? [14, 5] : [-16, 0], footF: t < 8 ? [-12, 0] : [18, 6], tail: [228, 236, 216, 196, 180, 170, 160] }) },
  block: { n: 2, step: 6, fn: (t) => ({ ...N, px: t < 6 ? -6 : -4, py: -4, torso: t < 6 ? 84 : 80, neck: 70, head: -30, jaw: 0, armN: [38, 96], armF: [48, 102], footN: [-15, 0], footF: [10, 0] }) },
  light: {
    n: 8, step: 3,
    fn: keys(N, [
      [0, {}],
      [3, { px: -2, torso: 80, neck: 62, head: 2, armN: [62, 112], jaw: 0.3 }],
      [6, { px: 7, py: -2, torso: 61, neck: 48, head: -14, jaw: 0.7, armN: [-8, -4], armF: [-60, 0], footF: [20, 0] }],
      [10, { px: 8, py: -2, torso: 59, neck: 47, head: -15, jaw: 0.6, armN: [-36, -42], armF: [-60, 0], footF: [20, 0] }],
      [22, {}],
    ]),
  },
  heavy: {
    n: 10, step: 5,
    flip: (t) => t >= 13 && t < 29,
    fn: keys(N, [
      [0, {}],
      [5, { px: -4, py: -5, torso: 68, neck: 52, head: -16, armN: [-80, -20], tail: [205, 200, 190, 180, 170, 162, 155] }],
      [10, { px: 2, py: -3, torso: 84, neck: 66, head: 4, armN: [-30, 60], tail: [190, 185, 180, 176, 172, 168, 164] }],
      [15, { px: 6, py: -4, torso: 62, neck: 50, head: -10, jaw: 0.6, tail: [187, 183, 180, 178, 176, 174, 172], armN: [-10, 30], footN: [-16, 0], footF: [17, 0] }],
      [21, { px: 8, py: -4, torso: 60, neck: 50, head: -10, jaw: 0.5, tail: [202, 194, 187, 180, 174, 168, 160], armN: [-10, 30], footN: [-16, 0], footF: [17, 0] }],
      [28, { px: 2, torso: 80, tail: [206, 206, 200, 190, 180, 170, 160] }],
      [45, {}],
    ]),
  },
  beamA: { n: 4, step: 6, fn: keys(N, [[0, {}], [9, { px: -3, torso: 83, neck: 73, head: 26, jaw: 0.25, armN: [-100, -50], armF: [-90, -40] }], [18, { px: -2, torso: 80, neck: 70, head: 14, jaw: 0.55, armN: [-90, -40], armF: [-80, -30] }]]) },
  beamB: { n: 2, step: 4, fn: (t) => ({ ...N, ...FIRE, px: t < 4 ? 4 : 5, head: t < 4 ? -12 : -11 }) },
  beamC: { n: 2, step: 9, fn: keys(N, [[0, { ...FIRE, jaw: 0.6 }], [18, {}]]) },
  grab: { n: 6, step: 6, fn: keys(N, [[0, {}], [6, GRAB], [14, GRAB], [33, {}]]) },
  throw: {
    n: 8, step: 6,
    fn: keys(N, [
      [0, GRAB],
      [11, { px: 1, torso: 85, neck: 72, head: 12, jaw: 0.3, armN: [72, 86], armF: [82, 96] }],
      [20, { px: 0, torso: 87, neck: 74, head: 14, jaw: 0.3, armN: [78, 92], armF: [88, 102] }],
      [26, { px: 8, py: -3, torso: 57, neck: 45, head: -15, jaw: 0.9, armN: [-25, -35], armF: [-15, -25], footF: [22, 0] }],
      [34, { px: 8, py: -3, torso: 57, neck: 45, head: -15, jaw: 0.8, armN: [-35, -45], armF: [-25, -35], footF: [22, 0] }],
      [47, {}],
    ]),
  },
  hit: { n: 2, step: 6, fn: (t) => (t < 6 ? { ...N, px: -6, torso: 89, neck: 80, head: 36, jaw: 0.7, armN: [-112, -70], armF: [-100, -60], footN: [-15, 0], footF: [8, 0], tail: [222, 232, 214, 194, 178, 166, 150] } : { ...N, px: -3, torso: 82, neck: 68, head: 14, jaw: 0.35, armN: [-80, -30], armF: [-70, -20] }) },
  launch: { n: 2, step: 10, fn: (t) => ({ ...N, rot: t < 10 ? 30 : 64, torso: 84, neck: 76, head: 34, jaw: 0.8, armN: [20, 62], armF: [32, 72], footN: [6, 12], footF: [24, 18], tail: [205, 198, 190, 184, 178, 172, 166] }) },
  down: { n: 1, step: 10, fn: () => ({ ...N, ...DOWN }) },
  getup: { n: 3, step: 8, fn: keys(N, [[0, DOWN], [12, { rot: 42, py: -20, torso: 70, neck: 56, head: 0, jaw: 0.3, footN: [2, -8], footF: [20, -6], armN: [-70, -20], armF: [-60, -10], tail: [240, 240, 225, 205, 190, 178, 165] }], [24, {}]]) },
  win: {
    n: 6, step: 8,
    fn: (t) => {
      const k = keys(N, [[0, {}], [8, { torso: 80, neck: 74, head: 30, jaw: 0.4, armN: [-20, 50], armF: [-10, 60] }], [16, { px: -2, torso: 85, neck: 82, head: 48, jaw: 1, armN: [12, 72], armF: [22, 82], tail: [210, 215, 200, 180, 162, 146, 130] }]])(t);
      return t > 16 ? { ...k, head: k.head + S(t * 0.8) * 3, px: -2 + S(t * 1.3) } : k;
    },
  },
};

export const GODZILLA: CharArt<GPose> = { name: "GODZILLA", w: W, h: H, ox: OX, oy: OY, anims, draw };
