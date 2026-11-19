// KING GHIDORAH — drawn entirely in code.
// Rig: body spine (near tail -> pelvis -> chest -> middle neck), two extra necks,
// three hinged dragon heads with swept horns, two bat wings (arm + 4 finger bones +
// scalloped membrane), IK legs, twin maced tails. Gold ramp with staggered scale
// texture, pale segmented underbelly, fire-lit under-rim.
import { Raster, Shade, rgb, hash2, bayer, rad, spline, ik, keys, clampi, type Anim, type AnimName, type Anchors, type CharArt } from "./raster";

export interface KPose {
  px: number;
  py: number;
  rot: number;
  torso: number;
  necks: number[][]; // [far, mid, near] -> [a0, k1, k2] (start angle, curvature lower half, curvature upper half)
  heads: number[]; // abs angles
  jaws: number[];
  wingN: number[]; // [humerus, forearm, fanStart, fanStep]
  wingF: number[];
  footN: number[];
  footF: number[];
  tails: number[][]; // [far, near] -> [a0, k]
}

const W = 372, H = 316, OX = 202, OY = 272;

const OUT = rgb(0x120803);
const GOLD = [0x221105, 0x432409, 0x6c400f, 0x986417, 0xc38c22, 0xe7b93c, 0xfce27c];
const BELLY = [0x4a2f10, 0x7b5a22, 0xab863b, 0xd2b15e, 0xf0d78e];
const MEMB = [0x1c0b07, 0x321309, 0x4c200d, 0x6b3211, 0x8c4a18].map((h) => rgb(h));
const WARM = [0x8c3a10, 0xd4621a, 0xffa032];
const HORN = [0x64553c, 0xa69876, 0xdcd2b0, 0xf8f2dc];

/** gold scales; al!=255 encodes emissive position (GPU glow sweep up the necks) */
function gold(belly: boolean, al = 255): Shade {
  return (u, v, nx, ny, X, Y, r) => {
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const w = -ny;
    if (w > 0.9) return rgb(WARM[w > 0.965 ? 2 : 1], al);
    if (w > 0.78 && bayer(X, Y) < 0.5) return rgb(WARM[0], al);
    if (belly && v < -0.36) {
      const seg = u / 5 - Math.floor(u / 5);
      const lb = 0.5 + ny * 0.3 + nz * 0.22 - (seg < 0.24 ? 0.3 : 0) + (bayer(X, Y) - 0.5) * 0.08;
      return rgb(BELLY[clampi(Math.floor(lb * 5), 0, 4)], al);
    }
    let l = 0.33 + ny * 0.42 + nz * 0.22;
    const row = Math.floor(u / 4), fu = u / 4 - row;
    const vv = (v * r) / 4 + (row & 1) * 0.5, fv = vv - Math.floor(vv);
    if (fu < 0.27) l -= 0.1;
    else if (fu > 0.55 && fv > 0.25 && fv < 0.78) l += 0.1;
    if (fv < 0.15) l -= 0.08;
    l += (bayer(X, Y) - 0.5) * 0.05;
    return rgb(GOLD[clampi(Math.floor(l * 7), 0, 6)], al);
  };
}
const G0 = gold(false), GB = gold(true);

function spike(r: Raster, bx: number, by: number, ang: number, len: number, wd: number, c0 = 1, al = 255) {
  const cx = Math.cos(rad(ang)), cy = Math.sin(rad(ang));
  r.poly([bx - cy * wd, by + cx * wd, bx + cx * len, by + cy * len, bx + cy * wd, by - cx * wd], rgb(HORN[c0 + 1], al));
  r.line(bx + cy * wd * 0.6, by - cx * wd * 0.6, bx + cx * (len - 1), by + cy * (len - 1), rgb(HORN[c0], al));
  r.dot(bx + cx * (len - 1), by + cy * (len - 1), rgb(HORN[3], al));
}

function neckPts(bx: number, by: number, np: number[], r0: number, r1: number): number[] {
  const out = [bx, by, r0];
  let x = bx, y = by;
  for (let i = 0; i < 8; i++) {
    const a = rad(np[0] + np[1] * Math.min(i, 4) + np[2] * Math.max(0, i - 4));
    x += Math.cos(a) * 10.5;
    y += Math.sin(a) * 10.5;
    out.push(x, y, r0 + ((r1 - r0) * (i + 1)) / 8);
  }
  return out;
}

/** spikes down the back of a neck (drawn before the neck so their bases tuck under) */
function neckSpikes(r: Raster, ch: number[]) {
  const n = ch.length / 3;
  let acc = 0;
  for (let i = 1; i < n; i++) {
    const dx = ch[i * 3] - ch[i * 3 - 3], dy = ch[i * 3 + 1] - ch[i * 3 - 2];
    const L = Math.hypot(dx, dy) || 1;
    acc += L;
    if (acc < 7) continue;
    acc = 0;
    const rr = ch[i * 3 + 2];
    const a = (Math.atan2(dy, dx) * 180) / Math.PI + 90 + 28; // back normal, raked toward the base
    spike(r, ch[i * 3] - (dy / L) * (rr - 2), ch[i * 3 + 1] + (dx / L) * (rr - 2), a, 5.5, 1.8, 0, 128 + Math.round((i / n) * 96));
  }
}

function head(r: Raster, bx: number, by: number, ang: number, jaw: number, sh: Shade): number[] {
  const ha = rad(ang), hx = Math.cos(ha), hy = Math.sin(ha);
  const k = 1.28;
  const Hx = (lx: number, ly: number) => bx + (lx * hx - ly * hy) * k;
  const Hy = (lx: number, ly: number) => by + (lx * hy + ly * hx) * k;
  // crown of horns sweeping back
  const horn = (x0: number, y0: number, x1: number, y1: number, tx: number, ty: number) => {
    r.poly([Hx(x0, y0), Hy(x0, y0), Hx(x1, y1), Hy(x1, y1), Hx(tx, ty), Hy(tx, ty)], (X, Y) => rgb(HORN[1 + ((hash2(X, Y) > 0.5 ? 1 : 0) & 1)]));
    r.line(Hx(x0, y0), Hy(x0, y0), Hx(tx, ty), Hy(tx, ty), rgb(HORN[0]));
    r.dot(Hx(tx, ty), Hy(tx, ty), rgb(HORN[3]));
  };
  horn(0, 3, 5, 7, -19, 16);
  horn(-2, 0, 1, 5, -21, 7);
  horn(-1, -4, 2, -1, -14, -5);
  // lower jaw
  const ja = rad(ang - 4 - jaw * 34), jx = Math.cos(ja), jy = Math.sin(ja);
  const J0x = Hx(3, -3.6), J0y = Hy(3, -3.6);
  r.limb([J0x, J0y, 3.7 * k, J0x + jx * 10 * k, J0y + jy * 10 * k, 3 * k, J0x + jx * 21 * k, J0y + jy * 21 * k, 2.2 * k], sh);
  if (jaw > 0.12) r.poly([Hx(4, -0.5), Hy(4, -0.5), Hx(25, -1.5), Hy(25, -1.5), J0x + (jx * 21 - jy * 2) * k, J0y + (jy * 21 + jx * 2) * k, J0x - jy * 3 * k, J0y + jx * 3 * k], (X, Y) => rgb(hash2(X >> 1, Y >> 1) > 0.55 ? 0x7a1a1e : 0x4a0e14, 228));
  // skull + long snout, cut flat on the lip line
  const sX = r.X(bx, by), sY = r.Y(bx, by);
  const uX = r.X(bx + hx, by + hy) - sX, uY = r.Y(bx + hx, by + hy) - sY;
  const cut: Shade = (u, v, nx, ny, X, Y, rr) => {
    const qx = X + 0.5 - sX, qy = Y + 0.5 - sY;
    if (qx * uX + qy * uY > 4 * k && qx * uY - qy * uX < -1.7 * k) return 0;
    return sh(u, v, nx, ny, X, Y, rr);
  };
  r.limb([Hx(0, 0.4), Hy(0, 0.4), 6.2 * k, Hx(6, 1.6), Hy(6, 1.6), 6.2 * k], cut);
  r.limb([Hx(6, 1.6), Hy(6, 1.6), 6 * k, Hx(15, 1), Hy(15, 1), 4.5 * k, Hx(22.5, 0.6), Hy(22.5, 0.6), 3.8 * k], cut);
  // angry brow spur, eye, nostril
  r.poly([Hx(4, 6), Hy(4, 6), Hx(12, 4.6), Hy(12, 4.6), Hx(3, 10), Hy(3, 10)], rgb(GOLD[5]));
  r.line(Hx(6, 5.4), Hy(6, 5.4), Hx(12.5, 4.2), Hy(12.5, 4.2), rgb(GOLD[0]));
  r.dot(Hx(9, 3), Hy(9, 3), rgb(0xff2a14, 250));
  r.dot(Hx(10.2, 3), Hy(10.2, 3), rgb(0xffa060, 250));
  r.dot(Hx(9.6, 3.8), Hy(9.6, 3.8), rgb(0xff2a14, 250));
  r.dot(Hx(24.5, 2.4), Hy(24.5, 2.4), rgb(GOLD[0]));
  // fangs
  for (let lx = 8; lx < 25; lx += 2.2) r.dot(Hx(lx, -2.3), Hy(lx, -2.3), rgb(HORN[lx > 18 ? 3 : 2]));
  r.dot(Hx(22, -3.5), Hy(22, -3.5), rgb(HORN[3]));
  r.dot(Hx(24.6, -3.5), Hy(24.6, -3.5), rgb(HORN[3]));
  if (jaw > 0.3) for (let s = 7; s < 21; s += 3) r.dot(J0x + (jx * s - jy * 3.3) * k, J0y + (jy * s + jx * 3.3) * k, rgb(HORN[2]));
  const mx = Hx(24, -3 - jaw * 4), my = Hy(24, -3 - jaw * 4);
  return [r.X(mx, my), r.Y(mx, my)];
}

function wing(r: Raster, rx: number, ry: number, wp: number[], sc: number, mul: number, atx: number, aty: number) {
  const ex = rx + Math.cos(rad(wp[0])) * 52 * sc, ey = ry + Math.sin(rad(wp[0])) * 52 * sc;
  const wx = ex + Math.cos(rad(wp[1])) * 60 * sc, wy = ey + Math.sin(rad(wp[1])) * 60 * sc;
  const LEN = [118, 112, 98, 78];
  const tips: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = rad(wp[2] + wp[3] * i);
    tips.push(wx + Math.cos(a) * LEN[i] * sc, wy + Math.sin(a) * LEN[i] * sc);
  }
  const pts = [rx, ry, ex, ey, wx, wy, tips[0], tips[1]];
  for (let i = 0; i < 3; i++) {
    const mx = (tips[i * 2] + tips[i * 2 + 2]) / 2, my = (tips[i * 2 + 1] + tips[i * 2 + 3]) / 2;
    pts.push(mx + (wx - mx) * 0.24, my + (wy - my) * 0.24, tips[i * 2 + 2], tips[i * 2 + 3]);
  }
  const mx = (tips[6] + atx) / 2, my = (tips[7] + aty) / 2;
  pts.push(mx + (ex - mx) * 0.3, my + (ey - my) * 0.3, atx, aty);
  const sX = r.X(wx, wy), sY = r.Y(wx, wy);
  r.poly(pts, (X, Y) => {
    const d = Math.hypot(X - sX, Y - sY) / (115 * sc);
    // thin membrane: darker by the bones, glowing warmer toward the trailing edge; faint radial streaks
    const streak = hash2(Math.floor((Math.atan2(Y - sY, X - sX) * 40) | 0), 3) > 0.7 ? -0.5 : 0;
    return MEMB[clampi(Math.floor(0.6 + d * 3.1 + streak + (bayer(X, Y) - 0.5) * 1.1), 0, 4)];
  });
  for (let i = 0; i < 4; i++) r.limb([wx, wy, 3.2, tips[i * 2], tips[i * 2 + 1], 1.2], G0);
  r.limb([rx, ry, 8.5, ex, ey, 6.4], G0);
  r.limb([ex, ey, 6.2, wx, wy, 4.4], G0);
  spike(r, wx, wy, wp[1] - 20 * Math.sign(wp[3]), 12, 2.6, 1);
  r.flush(OUT, mul);
}

function leg(r: Raster, hx: number, hy: number, ax: number, lift: number, mul: number) {
  const ay = 8 + lift;
  const [kx, ky] = ik(hx, hy, ax, ay, 33, 29, 1);
  r.limb([hx, hy, 18, kx, ky, 12.5], G0);
  r.limb([kx, ky, 11, ax, ay, 7], G0);
  const fa = rad(-10 - Math.max(0, lift) * 2.4);
  const tx = ax + Math.cos(fa) * 18, ty = ay + Math.sin(fa) * 18;
  r.limb([ax - 3, ay - 0.5, 6.5, ax, ay, 7, tx, ty - 0.5, 5.6], G0);
  for (let i = 0; i < 3; i++) spike(r, tx + 3, ty - 3 + i * 0.5, -22 + i * 16 - Math.max(0, lift) * 2.4, 10, 2, 1);
  spike(r, ax - 7, ay - 2, 200, 6, 1.8, 1);
  r.flush(OUT, mul);
}

function tailPts(bx: number, by: number, tp: number[]): number[] {
  const TR = [13, 11.5, 10, 8.6, 7.2, 5.9, 4.7, 3.7, 3];
  const fw = [bx, by, TR[0]];
  let x = bx, y = by;
  for (let i = 0; i < 8; i++) {
    const a = rad(tp[0] + tp[1] * i);
    x += Math.cos(a) * 15;
    y += Math.sin(a) * 15;
    fw.push(x, y, TR[i + 1]);
  }
  const out: number[] = [];
  for (let i = 8; i >= 0; i--) out.push(fw[i * 3], fw[i * 3 + 1], fw[i * 3 + 2]);
  return out; // tip -> base
}
function mace(r: Raster, t: number[]) {
  const a = (Math.atan2(t[1] - t[4], t[0] - t[3]) * 180) / Math.PI;
  for (const d of [-80, -40, 0, 40, 80]) spike(r, t[0], t[1], a + d, d === 0 ? 10 : 8, 2, 1);
}

function draw(r: Raster, p: KPose): Anchors {
  const pvx = p.px, pvy = 66 + p.py;
  r.setT(OX, OY, p.rot, pvx, pvy);
  r.clipY = p.rot !== 0 && p.py >= 0 ? H - 1 : OY - 1;
  const tr = rad(p.torso), tx = Math.cos(tr), ty = Math.sin(tr), fx = ty, fy = -tx;
  const bel = [pvx + tx * 22 + fx * 3, pvy + ty * 22 + fy * 3];
  const che = [pvx + tx * 50, pvy + ty * 50];

  // ---- far wing, far tail, far leg, far neck
  wing(r, che[0] + 4, che[1] + 6, p.wingF, 0.92, 0.5, che[0] + 14, che[1] - 12);
  wing(r, che[0] - fx * 13 + tx * 2, che[1] - fy * 13 + ty * 2, p.wingN, 1, 0.86, pvx - 16, pvy + 12);
  const ft = spline(tailPts(pvx - 6, pvy + 2, p.tails[0]), 5);
  mace(r, ft);
  r.limb(ft, G0);
  r.flush(OUT, 0.66);
  leg(r, pvx - 3, pvy - 6, p.footF[0], p.footF[1], 0.6);
  const fn = spline(neckPts(che[0] - 9 * fx - 2 * tx, che[1] - 9 * fy - 2 * ty + 3, p.necks[0], 10, 7.5), 4);
  neckSpikes(r, fn);
  r.limb(fn, GB);
  const m0 = head(r, fn[fn.length - 3], fn[fn.length - 2], p.heads[0], p.jaws[0], G0);
  r.flush(OUT, 0.7);


  // ---- body: near tail -> pelvis -> chest -> middle neck -> middle head
  const nt = tailPts(pvx - 10, pvy - 6, p.tails[1]);
  const mn = neckPts(che[0] + tx * 6, che[1] + ty * 6, p.necks[1], 11, 7.7);
  const cp = [...nt, pvx, pvy, 24, bel[0], bel[1], 26, che[0], che[1], 21.5, ...mn];
  const body = spline(cp, 5);
  mace(r, body);
  neckSpikes(r, spline(mn, 4));
  r.limb(body, GB);
  const m1 = head(r, mn[mn.length - 3], mn[mn.length - 2], p.heads[1], p.jaws[1], G0);
  r.flush(OUT);

  // ---- near leg, near neck + head (in front)
  leg(r, pvx + 4, pvy - 8, p.footN[0], p.footN[1], 1);
  const nn = spline(neckPts(che[0] + 7 * fx + 3 * tx, che[1] + 7 * fy + 3 * ty, p.necks[2], 10.5, 7.6), 4);
  neckSpikes(r, nn);
  r.limb(nn, GB);
  const m2 = head(r, nn[nn.length - 3], nn[nn.length - 2], p.heads[2], p.jaws[2], G0);
  r.flush(OUT);

  return { mouths: [m1[0], m1[1], m2[0], m2[1], m0[0], m0[1]], hand: m2 };
}

// ------------------------------------------------------------------ animation
const KN: KPose = {
  px: 0, py: 0, rot: 0, torso: 80,
  necks: [[106, 5, -19], [92, 5, -21], [80, -3, -21]],
  heads: [-6, -18, -28],
  jaws: [0.1, 0.1, 0.15],
  wingN: [140, 96, 168, 27],
  wingF: [58, 88, 14, -24],
  footN: [-12, 0], footF: [16, 0],
  tails: [[186, -11], [205, -9]],
};
const S = Math.sin, PI2 = Math.PI * 2;

const idle = (t: number): KPose => {
  const f = (PI2 * t) / 60;
  return {
    ...KN,
    py: -1 + Math.cos(f),
    necks: KN.necks.map((n, i) => [n[0] + S(f - i * 1.3) * 3, n[1] + S(f - i) * 0.6, n[2] + S(f - i * 0.9) * 1.5]),
    heads: KN.heads.map((h, i) => h + S(f - i * 1.1) * 4),
    jaws: KN.jaws.map((j, i) => (S(f - i * 2) > 0.6 ? 0.45 : j)),
    wingN: [140 + S(f) * 2, 96 + S(f - 0.4) * 2, 168, 27 + S(f) * 0.8],
    wingF: [58 - S(f) * 2, 88 - S(f - 0.4) * 2, 14, -24 - S(f) * 0.8],
    tails: KN.tails.map((tl, i) => [tl[0] + S(f - i * 1.5) * 4, tl[1] + S(f - i) * 1.2]),
  };
};
const stepFoot = (ph: number): number[] => {
  ph -= Math.floor(ph);
  if (ph < 0.6) return [16 - 32 * (ph / 0.6), 0];
  const s = (ph - 0.6) / 0.4;
  return [-16 + 32 * s, S(Math.PI * s) * 11];
};
const walk = (t: number): KPose => {
  const ph = t / 56, f = PI2 * ph;
  const a = stepFoot(ph), b = stepFoot(ph + 0.5);
  return {
    ...KN,
    py: -2.5 + 2.5 * Math.abs(S(f)),
    torso: 78 + 2.5 * S(f),
    necks: KN.necks.map((n, i) => [n[0] + S(f - i * 1.2) * 3.5, n[1], n[2] + S(f - i) * 1.5]),
    heads: KN.heads.map((h, i) => h + S(f * 2 - i) * 3),
    wingN: [140 + S(f * 2) * 3, 96 + S(f * 2 - 0.5) * 3, 168, 27],
    wingF: [58 - S(f * 2) * 3, 88, 14, -24],
    footN: [a[0] - 3, a[1]], footF: [b[0] + 5, b[1]],
    tails: KN.tails.map((tl, i) => [tl[0] + S(f - i * 1.5) * 5, tl[1] + S(f - i) * 1.5]),
  };
};
const FIRE: Partial<KPose> = { px: 3, py: -2, torso: 76, necks: [[100, 2, -22], [88, 2, -24], [76, 0, -22]], heads: [-14, -20, -26], jaws: [1, 1, 1], wingN: [146, 104, 160, 30], wingF: [52, 82, 20, -27], footN: [-16, 0], footF: [19, 0] };
const GRAB: Partial<KPose> = { px: 6, py: -2, torso: 72, necks: [[104, 5, -19], [68, -4, -12], [56, -6, -9]], heads: [-8, -26, -18], jaws: [0.1, 0.9, 0.9], footF: [22, 0] };
const DOWN: Partial<KPose> = { rot: 95, py: -41, torso: 82, necks: [[100, -4, -10], [92, -5, -9], [84, -6, -8]], heads: [44, 30, 16], jaws: [0.5, 0.3, 0.6], wingN: [62, 80, 62, 10], wingF: [-52, -70, -60, -12], footN: [5, -34], footF: [17, -28], tails: [[258, 6], [268, 4]] };
const SLAM: Partial<KPose> = { px: 8, py: -3, torso: 68, necks: [[72, -4, -10], [62, -5, -10], [52, -6, -9]], heads: [-30, -28, -24], jaws: [0.35, 0.35, 0.35], wingN: [165, 122, 192, 21], wingF: [62, 96, 44, -22], footF: [22, 0] };

const anims: Record<AnimName, Anim<KPose>> = {
  idle: { n: 6, step: 10, fn: idle },
  walk: { n: 8, step: 7, fn: walk },
  dash: { n: 2, step: 8, fn: (t) => ({ ...KN, px: 6, py: 4, torso: 62, necks: [[86, 0, -16], [74, 0, -16], [62, -2, -14]], heads: [-10, -14, -18], wingN: t < 8 ? [128, 92, 150, 30] : [168, 130, 196, 20], wingF: t < 8 ? [64, 92, 30, -28] : [36, 60, -6, -20], footN: [-18, 8], footF: [6, 12], tails: [[182, -3], [192, -3]] }) },
  bdash: { n: 2, step: 8, fn: (t) => ({ ...KN, px: -6, py: 4, torso: 90, necks: [[112, 4, -14], [102, 4, -14], [92, 2, -14]], heads: [-20, -26, -32], wingN: t < 8 ? [160, 120, 190, 22] : [130, 92, 152, 30], wingF: t < 8 ? [44, 70, 0, -22] : [66, 94, 30, -28], footN: [-6, 8], footF: [18, 12], tails: [[200, -12], [220, -11]] }) },
  block: { n: 2, step: 6, fn: (t) => ({ ...KN, px: t < 6 ? -6 : -4, py: -4, torso: t < 6 ? 88 : 85, necks: [[122, 6, -12], [114, 6, -14], [106, 4, -16]], heads: [-42, -48, -52], jaws: [0, 0, 0], wingN: [122, 100, 188, 17], wingF: [70, 84, 4, -16], footN: [-15, 0], footF: [10, 0] }) },
  light: {
    n: 8, step: 3,
    fn: keys(KN, [
      [0, {}],
      [3, { px: -2, torso: 84, necks: [[106, 5, -19], [94, 5, -20], [98, 2, -15]], heads: [-6, -16, -8], jaws: [0.1, 0.1, 0.9] }],
      [6, { px: 5, py: -2, torso: 72, necks: [[104, 5, -19], [90, 4, -21], [58, -5, -9]], heads: [-8, -20, -14], jaws: [0.1, 0.3, 0.75], footF: [20, 0] }],
      [10, { px: 6, py: -2, torso: 71, necks: [[104, 5, -19], [90, 4, -21], [56, -5, -9]], heads: [-8, -20, -18], jaws: [0.1, 0.3, 0.1], footF: [20, 0] }],
      [22, {}],
    ]),
  },
  heavy: {
    n: 10, step: 5,
    fn: keys(KN, [
      [0, {}],
      [7, { px: -4, torso: 87, necks: [[118, 4, -8], [108, 4, -8], [98, 3, -8]], heads: [22, 16, 10], jaws: [0.9, 0.9, 0.9], wingN: [128, 98, 150, 26], wingF: [66, 92, 30, -27] }],
      [12, { px: -5, torso: 88, necks: [[120, 4, -7], [110, 4, -7], [100, 3, -7]], heads: [26, 20, 14], jaws: [1, 1, 1], wingN: [126, 96, 148, 27], wingF: [68, 94, 32, -28] }],
      [15, SLAM],
      [22, { ...SLAM, px: 9 }],
      [45, {}],
    ]),
  },
  beamA: {
    n: 4, step: 6,
    fn: keys(KN, [
      [0, {}],
      [9, { px: -3, torso: 85, necks: [[108, 3, -6], [98, 3, -6], [88, 2, -6]], heads: [52, 46, 40], jaws: [0.4, 0.4, 0.4], wingN: [150, 110, 160, 30], wingF: [50, 80, 22, -28] }],
      [18, { px: -2, torso: 82, necks: [[106, 3, -12], [96, 3, -13], [84, 1, -12]], heads: [24, 18, 10], jaws: [0.7, 0.7, 0.7], wingN: [148, 106, 160, 30], wingF: [52, 82, 20, -27] }],
    ]),
  },
  beamB: { n: 2, step: 4, fn: (t) => ({ ...KN, ...FIRE, px: t < 4 ? 3 : 4, heads: t < 4 ? [-14, -20, -26] : [-13, -21, -25] }) },
  beamC: { n: 2, step: 9, fn: keys(KN, [[0, { ...FIRE, jaws: [0.6, 0.6, 0.6] }], [18, {}]]) },
  grab: { n: 6, step: 6, fn: keys(KN, [[0, {}], [6, GRAB], [14, GRAB], [33, {}]]) },
  throw: {
    n: 8, step: 6,
    fn: keys(KN, [
      [0, GRAB],
      [11, { px: 0, torso: 87, necks: [[110, 5, -14], [102, 4, -10], [94, 3, -10]], heads: [10, 32, 30], jaws: [0.3, 0.8, 0.8], wingN: [132, 98, 154, 28] }],
      [20, { px: -1, torso: 88, necks: [[110, 5, -14], [104, 4, -9], [96, 3, -9]], heads: [10, 36, 34], jaws: [0.3, 0.8, 0.8], wingN: [130, 96, 152, 28] }],
      [26, { px: 8, py: -3, torso: 68, necks: [[90, 0, -20], [64, -4, -12], [54, -5, -10]], heads: [-20, -30, -25], jaws: [1, 1, 1], wingN: [164, 120, 190, 21], footF: [22, 0] }],
      [34, { px: 8, py: -3, torso: 68, necks: [[90, 0, -20], [62, -4, -12], [52, -5, -10]], heads: [-20, -32, -27], jaws: [0.8, 0.8, 0.8], wingN: [164, 120, 190, 21], footF: [22, 0] }],
      [47, {}],
    ]),
  },
  hit: { n: 2, step: 6, fn: (t) => (t < 6 ? { ...KN, px: -6, torso: 91, necks: [[126, 6, -4], [119, 6, -4], [111, 6, -4]], heads: [62, 52, 42], jaws: [0.8, 0.6, 0.8], wingN: [152, 122, 178, 19], wingF: [72, 96, 34, -24], footN: [-15, 0], footF: [8, 0], tails: [[178, -8], [196, -7]] } : { ...KN, px: -3, torso: 86, necks: [[116, 5, -12], [106, 5, -13], [96, 2, -13]], heads: [24, 14, 6], jaws: [0.4, 0.3, 0.4] }) },
  launch: { n: 2, step: 10, fn: (t) => ({ ...KN, rot: t < 10 ? 30 : 62, torso: 86, necks: [[120, 5, -6], [112, 5, -6], [104, 4, -6]], heads: [50, 42, 34], jaws: [0.8, 0.8, 0.8], wingN: [124, 104, 204, 11], wingF: [74, 102, 64, -13], footN: [6, 12], footF: [24, 18], tails: [[190, -5], [200, -5]] }) },
  down: { n: 1, step: 10, fn: () => ({ ...KN, ...DOWN }) },
  getup: { n: 3, step: 8, fn: keys(KN, [[0, DOWN], [12, { rot: 40, py: -20, torso: 76, necks: [[104, 4, -10], [94, 3, -10], [84, 0, -10]], heads: [30, 22, 12], wingN: [120, 96, 150, 22], wingF: [20, 30, -10, -18], footN: [2, -8], footF: [20, -6], tails: [[230, -4], [244, -4]] }], [24, {}]]) },
  win: {
    n: 6, step: 8,
    fn: (t) => {
      const k = keys(KN, [[0, {}], [8, { torso: 84, necks: [[110, 4, -12], [98, 4, -13], [86, 1, -13]], heads: [20, 16, 10], jaws: [0.5, 0.5, 0.5] }], [16, { px: -2, torso: 87, necks: [[114, 3, -8], [100, 3, -8], [86, 2, -8]], heads: [44, 48, 38], jaws: [1, 1, 1], wingN: [136, 96, 152, 30], wingF: [56, 86, 26, -28] }]])(t);
      return t > 16 ? { ...k, heads: k.heads.map((h, i) => h + S(t * 0.8 + i * 2) * 4) } : k;
    },
  },
};

export const GHIDORAH: CharArt<KPose> = { name: "KING GHIDORAH", w: W, h: H, ox: OX, oy: OY, anims, draw };
