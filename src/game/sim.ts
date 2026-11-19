// Deterministic fighting simulation.
//  * The whole game state is ONE flat Int32Array -> rollback snapshots are a single
//    typed-array copy (zero allocations, ~1µs), checksums are trivial.
//  * Integer-only math (cm units, no Math.sin/cos) -> bit-identical on every peer.
//  * step() is pure w.r.t. (state, input0, input1); side effects for audio/particles
//    are emitted into a tiny event ring that the presentation layer drains.

export const IN_L = 1, IN_R = 2, IN_U = 4, IN_D = 8, IN_A = 16, IN_B = 32, IN_S = 64, IN_G = 128, IN_X = 256;
const BTN = IN_A | IN_B | IN_S | IN_G | IN_X;

export const ST_IDLE = 0, ST_WALKF = 1, ST_WALKB = 2, ST_DASHF = 3, ST_DASHB = 4, ST_BLOCK = 5, ST_LIGHT = 6, ST_HEAVY = 7, ST_BEAM = 8, ST_SUPER = 9,
  ST_GRAB = 10, ST_THROW = 11, ST_ENV = 12, ST_HIT = 13, ST_LAUNCH = 14, ST_HELD = 15, ST_DOWN = 16, ST_GETUP = 17, ST_WIN = 18;

export const G_FRAME = 0, G_PHASE = 1, G_PT = 2, G_ROUND = 3, G_TIMER = 4, G_RNG = 5, G_HAVOC = 6, G_FREEZE = 7, G_WINNER = 8, G_KOBY = 9, G_FRZBY = 10;
const G_N = 12;
export const PH_INTRO = 0, PH_FIGHT = 1, PH_KO = 2, PH_END = 3;

export const X = 0, Y = 1, VX = 2, VY = 3, FACE = 4, HP = 5, METER = 6, ST = 7, T = 8, STOP = 9, STUN = 10, COMBO = 11, CDMG = 12, HITF = 13, BUF = 14, BUFT = 15,
  PREV = 16, TAPD = 17, TAPT = 18, CHAR = 19, WINS = 20, INV = 21, JUG = 22, HAVOC = 23, DASHQ = 24, SLOW = 25, FRZ = 26;
const F_N = 28;
export const F0 = G_N, F1 = F0 + F_N;

export const NB = 18, BX = 0, BW = 1, BH = 2, BHP = 3, BROW = 4, BDT = 5, BSEED = 6, BFL = 7;
export const B_N = 8, B0 = F1 + F_N;
export const NP = 3, PT = 0, PX = 1, PY = 2, PVX = 3, PVY = 4, POWN = 5, PSEED = 6;
export const P_N = 7, P0 = B0 + NB * B_N;
export const STATE_SIZE = P0 + NP * P_N;

export const STAGE = 23000, MINSEP = 3400, MAXSEP = 17000, START_X = 7000, ROUND_FRAMES = 99 * 60, MAX_METER = 1000, BEAM_COST = 250;
export const SUPER_FREEZE = 40, SUPER_SU = 14, SUPER_AC = 55, SUPER_RC = 30, GRAB_TOTAL = 33, THROW_TOTAL = 46, THROW_REL = 25, ENV_TOTAL = 56, ENV_REL = 34;

export interface Move { su: number; ac: number; rc: number; dmg: number; hs: number; bs: number; reach: number; ph: number; pb: number; lvx: number; lvy: number; stop: number; launch: boolean }
export interface CharData {
  name: string; hp: number; height: number; walkF: number; walkB: number; dashF: number; dashFT: number; dashB: number; dashBT: number;
  light: Move; heavy: Move; grab: number;
  beamSu: number; beamAc: number; beamRc: number; beamDmg: number; beamReach: number; beamY: number; beamSlope: number;
}
export const CH: CharData[] = [
  {
    name: "GODZILLA", hp: 1000, height: 12000, walkF: 46, walkB: 34, dashF: 135, dashFT: 20, dashB: 120, dashBT: 18,
    light: { su: 7, ac: 3, rc: 13, dmg: 55, hs: 22, bs: 13, reach: 5800, ph: 520, pb: 620, lvx: 0, lvy: 0, stop: 8, launch: false },
    heavy: { su: 16, ac: 5, rc: 25, dmg: 130, hs: 0, bs: 20, reach: 11500, ph: 0, pb: 800, lvx: 250, lvy: 430, stop: 12, launch: true },
    grab: 5200, beamSu: 24, beamAc: 36, beamRc: 18, beamDmg: 21, beamReach: 17000, beamY: 9800, beamSlope: 42,
  },
  {
    name: "KING GHIDORAH", hp: 1000, height: 15000, walkF: 40, walkB: 32, dashF: 150, dashFT: 22, dashB: 135, dashBT: 20,
    light: { su: 8, ac: 3, rc: 13, dmg: 48, hs: 22, bs: 13, reach: 8200, ph: 520, pb: 620, lvx: 0, lvy: 0, stop: 8, launch: false },
    heavy: { su: 18, ac: 5, rc: 26, dmg: 125, hs: 0, bs: 20, reach: 10500, ph: 0, pb: 800, lvx: 240, lvy: 450, stop: 12, launch: true },
    grab: 6000, beamSu: 22, beamAc: 36, beamRc: 20, beamDmg: 20, beamReach: 18000, beamY: 13500, beamSlope: 62,
  },
];
const SCALE = [100, 90, 78, 66, 56, 46, 38, 32];

// ------------------------------------------------------------------ events
export const EV_STEP = 1, EV_HIT = 2, EV_BLOCK = 3, EV_COLLAPSE = 4, EV_CRASH = 5, EV_SLAM = 6, EV_SUPER = 7, EV_BEAM = 8, EV_KO = 9, EV_FIGHT = 10,
  EV_ROUND = 11, EV_GRAB = 12, EV_RIP = 13, EV_CHUNK = 14, EV_SWING = 15, EV_DASH = 16, EV_TIMEUP = 17, EV_END = 18;
export const EV = new Int32Array(32 * 4);
export let evN = 0;
function ev(type: number, a = 0, b = 0, c = 0) {
  if (evN >= 32) return;
  const i = evN++ * 4;
  EV[i] = type;
  EV[i + 1] = a;
  EV[i + 2] = b;
  EV[i + 3] = c;
}

// ------------------------------------------------------------------ helpers
function rnd(s: Int32Array): number {
  let x = s[G_RNG];
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s[G_RNG] = x;
  return x >>> 0;
}
function setSt(s: Int32Array, o: number, st: number) {
  s[o + ST] = st;
  s[o + T] = 0;
}
function addMeter(s: Int32Array, o: number, v: number) {
  const m = s[o + METER] + v;
  s[o + METER] = m > MAX_METER ? MAX_METER : m;
}
function hittable(s: Int32Array, o: number): boolean {
  const st = s[o + ST];
  return s[o + INV] <= 0 && st !== ST_DOWN && st !== ST_GETUP && st !== ST_HELD;
}
function destroy(s: Int32Array, b: number, by: number, ripped: number) {
  const bo = B0 + b * B_N;
  s[bo + BHP] = 0;
  s[bo + BDT] = s[G_FRAME];
  s[bo + BFL] = ripped;
  s[G_HAVOC] += ((s[bo + BH] * s[bo + BW]) / 40000 + 5) | 0;
  addMeter(s, by, 70);
  s[by + HAVOC]++;
  ev(ripped ? EV_RIP : EV_COLLAPSE, b, s[bo + BX], s[bo + BH]);
}

function genBuildings(s: Int32Array) {
  for (let i = 0; i < NB; i++) {
    const bo = B0 + i * B_N, row = i & 1, slot = i >> 1;
    let x = -20000 + slot * 5000 + (row ? 2400 : 0) + (rnd(s) % 1600) - 800;
    // keep the spawn points clear so nothing is trampled before FIGHT!
    for (let k = -1; k <= 1; k += 2) {
      const c = k * START_X;
      if (Math.abs(x - c) < 4400) x = x < c ? c - 4400 - (rnd(s) % 500) : c + 4400 + (rnd(s) % 500);
    }
    s[bo + BX] = x;
    s[bo + BW] = row ? 1100 + (rnd(s) % 900) : 800 + (rnd(s) % 700);
    s[bo + BH] = row ? 4200 + (rnd(s) % 5200) : 1400 + (rnd(s) % 2400);
    s[bo + BHP] = row ? 260 : 130;
    s[bo + BROW] = row;
    s[bo + BDT] = -1;
    s[bo + BSEED] = rnd(s) & 0xffff;
    s[bo + BFL] = 0;
  }
}

function resetRound(s: Int32Array) {
  for (let i = 0; i < 2; i++) {
    const o = i ? F1 : F0;
    const ch = s[o + CHAR], wins = s[o + WINS], meter = s[o + METER], hav = s[o + HAVOC];
    for (let k = 0; k < F_N; k++) s[o + k] = 0;
    s[o + CHAR] = ch;
    s[o + WINS] = wins;
    s[o + HAVOC] = hav;
    s[o + METER] = meter < BEAM_COST ? BEAM_COST : meter;
    s[o + X] = i ? START_X : -START_X;
    s[o + FACE] = i ? -1 : 1;
    s[o + HP] = CH[ch].hp;
    s[o + ST] = ST_WIN; // intro roar
  }
  for (let k = 0; k < NP * P_N; k++) s[P0 + k] = 0;
  genBuildings(s);
  s[G_PHASE] = PH_INTRO;
  s[G_PT] = 0;
  s[G_TIMER] = ROUND_FRAMES;
  s[G_FREEZE] = 0;
  s[G_KOBY] = 0;
  ev(EV_ROUND, s[G_ROUND]);
}

export function initState(s: Int32Array, seed: number, c0: number, c1: number) {
  evN = 0;
  s.fill(0);
  s[G_RNG] = seed | 1;
  s[F0 + CHAR] = c0;
  s[F1 + CHAR] = c1;
  s[G_ROUND] = 1;
  resetRound(s);
}

export function checksum(s: Int32Array): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < STATE_SIZE; i++) h = Math.imul(h ^ s[i], 16777619);
  return h >>> 0;
}

// ------------------------------------------------------------------ control
function tryMove(s: Int32Array, o: number, tier: number): boolean {
  const b = s[o + BUF];
  if (!b) return false;
  const face = s[o + FACE];
  let ns = -1;
  if (b & IN_X && s[o + METER] >= MAX_METER) {
    ns = ST_SUPER;
    s[o + METER] = 0;
    s[G_FREEZE] = SUPER_FREEZE;
    s[G_FRZBY] = o === F0 ? 0 : 1;
    ev(EV_SUPER, o === F0 ? 0 : 1);
  } else if (tier < 3 && b & IN_S && s[o + METER] >= BEAM_COST) {
    ns = ST_BEAM;
    s[o + METER] -= BEAM_COST;
    ev(EV_BEAM, o === F0 ? 0 : 1);
  } else if (tier < 2 && b & IN_B) {
    ns = ST_HEAVY;
    ev(EV_SWING, o === F0 ? 0 : 1, 2);
  } else if (tier < 1 && b & IN_G) {
    ns = ST_GRAB;
    if (b & IN_D) {
      // rip the nearest standing building out of the ground
      let best = -1, bd = 1 << 30;
      for (let i = 0; i < NB; i++) {
        const bo = B0 + i * B_N;
        if (s[bo + BHP] <= 0) continue;
        const rel = (s[bo + BX] - s[o + X]) * face;
        if (rel > -1500 && rel < 7500 && rel < bd) {
          bd = rel;
          best = i;
        }
      }
      if (best >= 0) {
        destroy(s, best, o, 1);
        ns = ST_ENV;
      }
    }
    if (ns === ST_GRAB) ev(EV_SWING, o === F0 ? 0 : 1, 3);
  } else if (tier < 1 && b & IN_A) {
    ns = ST_LIGHT;
    ev(EV_SWING, o === F0 ? 0 : 1, 1);
  }
  if (ns < 0) return false;
  s[o + BUF] = 0;
  s[o + BUFT] = 0;
  s[o + HITF] = 0;
  s[o + VX] = 0;
  setSt(s, o, ns);
  return true;
}

function control(s: Int32Array, o: number, e: number, inp: number) {
  const pressed = inp & ~s[o + PREV];
  s[o + PREV] = inp;
  const btn = pressed & BTN;
  if (btn) {
    s[o + BUF] = btn | (inp & IN_D);
    s[o + BUFT] = 8; // 8-frame input buffer
  } else if (s[o + BUFT] > 0 && --s[o + BUFT] === 0) s[o + BUF] = 0;
  const dp = pressed & (IN_L | IN_R);
  if (dp) {
    if (s[o + TAPD] === dp && s[o + TAPT] > 0) {
      s[o + DASHQ] = dp;
      s[o + TAPT] = 0;
    } else {
      s[o + TAPD] = dp;
      s[o + TAPT] = 13;
    }
  } else if (s[o + TAPT] > 0) s[o + TAPT]--;

  s[o + FRZ] = 0;
  if (s[o + STOP] > 0) {
    s[o + STOP]--;
    s[o + FRZ] = 1; // hitstop
    return;
  }
  if (s[o + INV] > 0) s[o + INV]--;
  const c = CH[s[o + CHAR]];
  const st = s[o + ST];
  const t = ++s[o + T];
  let face = s[o + FACE];
  const slow = s[o + SLOW];
  s[o + SLOW] = 0;
  const idle = () => {
    setSt(s, o, ST_IDLE);
    s[o + VX] = 0;
  };
  switch (st) {
    case ST_IDLE:
    case ST_WALKF:
    case ST_WALKB: {
      s[o + COMBO] = 0;
      s[o + CDMG] = 0;
      s[o + JUG] = 0;
      face = s[e + X] >= s[o + X] ? 1 : -1;
      s[o + FACE] = face;
      const fwd = face > 0 ? IN_R : IN_L, back = face > 0 ? IN_L : IN_R;
      if (tryMove(s, o, 0)) break;
      const dq = s[o + DASHQ];
      if (dq === fwd) {
        setSt(s, o, ST_DASHF);
        ev(EV_DASH, o === F0 ? 0 : 1);
      } else if (dq === back) {
        setSt(s, o, ST_DASHB);
        s[o + INV] = 7;
        ev(EV_DASH, o === F0 ? 0 : 1);
      } else if (inp & fwd && !(inp & back)) {
        if (st !== ST_WALKF) setSt(s, o, ST_WALKF);
        s[o + VX] = (slow ? (c.walkF * 5) >> 3 : c.walkF) * face;
        if (s[o + T] % 28 === 1) ev(EV_STEP, s[o + X], o === F0 ? 0 : 1);
      } else if (inp & back && !(inp & fwd)) {
        if (st !== ST_WALKB) setSt(s, o, ST_WALKB);
        s[o + VX] = -(slow ? (c.walkB * 5) >> 3 : c.walkB) * face;
        if (s[o + T] % 28 === 1) ev(EV_STEP, s[o + X], o === F0 ? 0 : 1);
      } else {
        if (st !== ST_IDLE) setSt(s, o, ST_IDLE);
        s[o + VX] = 0;
      }
      break;
    }
    case ST_DASHF:
      s[o + VX] = c.dashF * face;
      if (t > 6 && tryMove(s, o, 0)) break;
      if (t >= c.dashFT) idle();
      break;
    case ST_DASHB:
      s[o + VX] = -c.dashB * face;
      if (t >= c.dashBT) idle();
      break;
    case ST_BLOCK:
    case ST_HIT:
      if (--s[o + STUN] <= 0) idle();
      break;
    case ST_LIGHT:
      s[o + VX] = t <= c.light.su ? 70 * face : 0;
      if (s[o + HITF] && tryMove(s, o, 1)) break;
      if (t >= c.light.su + c.light.ac + c.light.rc) idle();
      break;
    case ST_HEAVY:
      s[o + VX] = 0;
      if (s[o + HITF] && tryMove(s, o, 2)) break;
      if (t >= c.heavy.su + c.heavy.ac + c.heavy.rc) idle();
      break;
    case ST_BEAM:
      s[o + VX] = 0;
      if (s[o + HITF] && tryMove(s, o, 3)) break;
      if (t >= c.beamSu + c.beamAc + c.beamRc) idle();
      break;
    case ST_SUPER:
      s[o + VX] = 0;
      if (t >= SUPER_SU + SUPER_AC + SUPER_RC) idle();
      break;
    case ST_GRAB:
      s[o + VX] = t <= 8 ? 60 * face : 0;
      if (t >= GRAB_TOTAL) idle();
      break;
    case ST_THROW:
      s[o + VX] = 0;
      if (s[e + ST] === ST_HELD) {
        if (t < THROW_REL) {
          const k = t < 20 ? t : 20;
          s[e + X] = s[o + X] + face * (4000 - k * 60);
          s[e + Y] = k * 230;
        } else {
          const n = s[e + COMBO];
          const d = (110 * SCALE[n > 7 ? 7 : n]) / 100 | 0;
          s[e + HP] -= d;
          s[e + COMBO] = n + 1;
          s[e + CDMG] += d;
          addMeter(s, o, 80);
          addMeter(s, e, 50);
          setSt(s, e, ST_LAUNCH);
          s[e + VX] = 330 * face;
          s[e + VY] = 500;
          s[e + JUG] = 3;
          s[o + STOP] = 6;
          s[e + STOP] = 6;
          ev(EV_HIT, s[e + X], 6, d);
        }
      }
      if (t >= THROW_TOTAL) idle();
      break;
    case ST_ENV:
      s[o + VX] = 0;
      if (t === ENV_REL) {
        for (let i = 0; i < NP; i++) {
          const po = P0 + i * P_N;
          if (s[po + PT]) continue;
          let d = ((s[e + X] - s[o + X]) * face - 3000) / 40 | 0;
          d = d < 120 ? 120 : d > 460 ? 460 : d;
          s[po + PT] = 1;
          s[po + PX] = s[o + X] + face * 3000;
          s[po + PY] = c.height + 1500;
          s[po + PVX] = d * face;
          s[po + PVY] = 120;
          s[po + POWN] = o === F0 ? 0 : 1;
          s[po + PSEED] = s[G_FRAME] & 0xffff;
          break;
        }
        ev(EV_SWING, o === F0 ? 0 : 1, 2);
      }
      if (t >= ENV_TOTAL) idle();
      break;
    case ST_HELD:
      if (s[e + ST] !== ST_THROW) {
        setSt(s, o, ST_LAUNCH);
        s[o + VX] = 0;
        s[o + VY] = 0;
      }
      break;
    case ST_DOWN:
      s[o + VX] = 0;
      if (s[o + HP] > 0 && t >= 46) setSt(s, o, ST_GETUP);
      break;
    case ST_GETUP:
      if (t >= 24) {
        idle();
        s[o + INV] = 4;
      }
      break;
  }
  s[o + DASHQ] = 0;
}

function physics(s: Int32Array, o: number, e: number) {
  if (s[o + FRZ]) return;
  const st = s[o + ST];
  if (st === ST_HELD) return;
  if (st === ST_LAUNCH) {
    s[o + VY] -= 20;
    s[o + X] += s[o + VX];
    s[o + Y] += s[o + VY];
    if (s[o + Y] <= 0 && s[o + VY] < 0) {
      s[o + Y] = 0;
      s[o + VX] = 0;
      s[o + VY] = 0;
      setSt(s, o, ST_DOWN);
      ev(EV_SLAM, s[o + X]);
      for (let i = 0; i < NB; i++) {
        const bo = B0 + i * B_N;
        if (s[bo + BHP] > 0 && Math.abs(s[bo + BX] - s[o + X]) < s[bo + BW] + 2600) destroy(s, i, e, 0);
      }
    }
  } else {
    s[o + X] += s[o + VX];
    if (st === ST_HIT || st === ST_BLOCK) s[o + VX] = ((s[o + VX] * 7) / 8) | 0;
  }
  if (s[o + X] > STAGE) {
    s[o + X] = STAGE;
    if (st === ST_LAUNCH) s[o + VX] = 0;
  } else if (s[o + X] < -STAGE) {
    s[o + X] = -STAGE;
    if (st === ST_LAUNCH) s[o + VX] = 0;
  }
}

function pushboxes(s: Int32Array) {
  if (s[F0 + ST] === ST_HELD || s[F1 + ST] === ST_HELD) return;
  const d = s[F1 + X] - s[F0 + X];
  const ad = d < 0 ? -d : d;
  if (ad > MAXSEP) {
    // "camera wall": fighters can never leave the shared screen
    const ex = ad - MAXSEP, sg0 = d > 0 ? 1 : -1;
    const a0 = s[F0 + VX] * sg0 < 0, a1 = s[F1 + VX] * sg0 > 0;
    if (a0 && !a1) s[F0 + X] += sg0 * ex;
    else if (a1 && !a0) s[F1 + X] -= sg0 * ex;
    else {
      s[F0 + X] += sg0 * (ex >> 1);
      s[F1 + X] -= sg0 * (ex - (ex >> 1));
    }
    if (a0 && s[F0 + ST] === ST_LAUNCH) s[F0 + VX] = 0;
    if (a1 && s[F1 + ST] === ST_LAUNCH) s[F1 + VX] = 0;
    return;
  }
  if (s[F0 + Y] > 3000 || s[F1 + Y] > 3000) return;
  if (ad >= MINSEP) return;
  const sg = d >= 0 ? 1 : -1, ov = MINSEP - ad, h = ov >> 1;
  s[F0 + X] -= sg * h;
  s[F1 + X] += sg * (ov - h);
  for (let k = 0; k < 2; k++) {
    const o = k ? F1 : F0, e = k ? F0 : F1;
    if (s[o + X] > STAGE) {
      s[e + X] -= s[o + X] - STAGE;
      s[o + X] = STAGE;
    } else if (s[o + X] < -STAGE) {
      s[e + X] += -STAGE - s[o + X];
      s[o + X] = -STAGE;
    }
  }
}

// ------------------------------------------------------------------ combat
/** 0 = nothing, 1 light, 2 heavy, 3 beam tick, 4 super tick */
function strike(s: Int32Array, a: number, v: number): number {
  if (s[a + FRZ] || !hittable(s, v)) return 0;
  const st = s[a + ST], t = s[a + T], c = CH[s[a + CHAR]];
  const d = (s[v + X] - s[a + X]) * s[a + FACE];
  if (st === ST_LIGHT) {
    const m = c.light;
    if (t > m.su && t <= m.su + m.ac && !s[a + HITF] && d > -1000 && d < m.reach + 1800 && s[v + Y] < 8000) return 1;
  } else if (st === ST_HEAVY) {
    const m = c.heavy;
    if (t > m.su && t <= m.su + m.ac && !s[a + HITF] && d > -1000 && d < m.reach + 1800 && s[v + Y] < 8000) return 2;
  } else if (st === ST_BEAM) {
    const t0 = t - c.beamSu;
    if (t0 > 0 && t0 <= c.beamAc && (t0 - 1) % 6 === 0 && d > 1000 && d < c.beamReach && s[v + Y] < 11000) return 3;
  } else if (st === ST_SUPER) {
    const t0 = t - SUPER_SU;
    if (t0 > 0 && t0 <= SUPER_AC && (t0 - 1) % 5 === 0 && d > 1000 && d < 30000) return 4;
  }
  return 0;
}

function applyHit(s: Int32Array, a: number, v: number, kind: number, dir: number) {
  const c = CH[s[a + CHAR]];
  let dmg = 0, hs = 0, bs = 0, ph = 0, pb = 0, stop = 0, lvx = 0, lvy = 0, chip = 0, launch = false;
  if (kind === 1 || kind === 2) {
    const m = kind === 1 ? c.light : c.heavy;
    dmg = m.dmg; hs = m.hs; bs = m.bs; ph = m.ph; pb = m.pb; stop = m.stop; lvx = m.lvx; lvy = m.lvy; launch = m.launch;
  } else if (kind === 3) {
    dmg = c.beamDmg; hs = 15; bs = 12; ph = 260; pb = 300; stop = 3; chip = 6;
  } else if (kind === 4) {
    dmg = 34; hs = 18; bs = 14; ph = 200; pb = 320; stop = 3; chip = 9;
    if (s[a + T] - SUPER_SU > SUPER_AC - 5) {
      launch = true; lvx = 300; lvy = 430;
    }
  } else {
    dmg = 140; bs = 20; pb = 700; stop = 10; chip = 20; launch = true; lvx = 230; lvy = 400; // thrown building
  }
  const vst = s[v + ST];
  const backBit = s[v + FACE] > 0 ? IN_L : IN_R, fwdBit = s[v + FACE] > 0 ? IN_R : IN_L;
  const proj = kind === 5;
  if ((vst === ST_IDLE || vst === ST_WALKB || vst === ST_BLOCK) && s[v + PREV] & backBit && !(s[v + PREV] & fwdBit) && s[v + Y] === 0) {
    setSt(s, v, ST_BLOCK);
    s[v + STUN] = bs;
    s[v + VX] = pb * dir;
    if (chip) s[v + HP] = s[v + HP] - chip < 1 ? 1 : s[v + HP] - chip;
    s[v + STOP] = stop < 6 ? stop : 6;
    if (!proj) {
      s[a + HITF] = 2;
      s[a + STOP] = s[v + STOP];
    }
    addMeter(s, a, 15);
    addMeter(s, v, 20);
    ev(EV_BLOCK, s[v + X], kind);
    return;
  }
  const n = s[v + COMBO];
  let d = (dmg * SCALE[n > 7 ? 7 : n]) / 100 | 0;
  if (d < 1) d = 1;
  s[v + HP] -= d;
  s[v + COMBO] = n + 1;
  s[v + CDMG] += d;
  addMeter(s, a, (d * 7) / 10 | 0);
  addMeter(s, v, d >> 1);
  const air = vst === ST_LAUNCH;
  if (launch || air || s[v + HP] <= 0) {
    const jug = ++s[v + JUG];
    setSt(s, v, ST_LAUNCH);
    if (air && !launch) {
      s[v + VX] = 120 * dir;
      s[v + VY] = 300 - jug * 40 < 160 ? 160 : 300 - jug * 40;
    } else {
      s[v + VX] = (lvx || 220) * dir;
      s[v + VY] = lvy || 380;
    }
    if (jug > 5) s[v + INV] = 90; // juggle limit
  } else {
    setSt(s, v, ST_HIT);
    s[v + STUN] = hs;
    s[v + VX] = ph * dir;
  }
  s[v + STOP] = stop;
  if (!proj) {
    s[a + HITF] = 1;
    s[a + STOP] = stop;
  }
  ev(EV_HIT, s[v + X], kind, d);
}

function grabOk(s: Int32Array, a: number, v: number): boolean {
  if (s[a + ST] !== ST_GRAB || s[a + FRZ] || s[a + HITF]) return false;
  const t = s[a + T];
  if (t <= 8 || t > 11) return false;
  const vst = s[v + ST];
  if (s[v + Y] !== 0 || s[v + INV] > 0 || vst === ST_HIT || vst === ST_BLOCK || vst === ST_LAUNCH || vst === ST_HELD || vst === ST_DOWN || vst === ST_GETUP || vst === ST_THROW || vst === ST_DASHB) return false;
  const d = (s[v + X] - s[a + X]) * s[a + FACE];
  return d >= 0 && d <= CH[s[a + CHAR]].grab;
}

function attacks(s: Int32Array) {
  const h0 = strike(s, F0, F1), h1 = strike(s, F1, F0);
  if (h0) applyHit(s, F0, F1, h0, s[F0 + FACE]);
  if (h1) applyHit(s, F1, F0, h1, s[F1 + FACE]);
  const g0 = grabOk(s, F0, F1), g1 = grabOk(s, F1, F0);
  if (g0 && g1) {
    // throw tech
    for (let k = 0; k < 2; k++) {
      const o = k ? F1 : F0;
      setSt(s, o, ST_BLOCK);
      s[o + STUN] = 16;
      s[o + VX] = -500 * s[o + FACE];
    }
    ev(EV_BLOCK, (s[F0 + X] + s[F1 + X]) >> 1, 1);
  } else if (g0 || g1) {
    const a = g0 ? F0 : F1, v = g0 ? F1 : F0;
    setSt(s, a, ST_THROW);
    s[a + HITF] = 1;
    setSt(s, v, ST_HELD);
    s[v + VX] = 0;
    s[v + VY] = 0;
    ev(EV_GRAB, s[v + X]);
  }
}

function buildings(s: Int32Array) {
  for (let i = 0; i < NB; i++) {
    const bo = B0 + i * B_N;
    for (let k = 0; k < 2 && s[bo + BHP] > 0; k++) {
      const o = k ? F1 : F0, e = k ? F0 : F1;
      const bx = s[bo + BX], bw = s[bo + BW];
      const st = s[o + ST], c = CH[s[o + CHAR]];
      const dx = Math.abs(s[o + X] - bx);
      if (dx < bw + 1900 && s[o + Y] < s[bo + BH]) {
        if (st === ST_LAUNCH) {
          // body smashed through a building: bonus damage, credited to the attacker
          destroy(s, i, e, 0);
          s[o + HP] -= 15;
          s[o + CDMG] += 15;
          s[o + VX] = ((s[o + VX] * 3) / 4) | 0;
          ev(EV_CRASH, bx, s[o + Y]);
          continue;
        } else if (s[o + Y] === 0 && st !== ST_DOWN && st !== ST_HELD && !s[o + FRZ]) {
          s[bo + BHP] -= st === ST_DASHF || st === ST_DASHB ? 40 : s[o + VX] !== 0 ? 9 : 3;
          s[o + SLOW] = 1;
          if (s[bo + BHP] <= 0) {
            destroy(s, i, o, 0);
            continue;
          }
        }
      }
      if (s[o + FRZ]) continue;
      const rel = (bx - s[o + X]) * s[o + FACE], t = s[o + T];
      if (st === ST_LIGHT || st === ST_HEAVY) {
        const m = st === ST_LIGHT ? c.light : c.heavy;
        if (t > m.su && t <= m.su + m.ac && rel > 0 && rel < m.reach + bw) s[bo + BHP] -= st === ST_LIGHT ? 50 : 90;
      } else if (st === ST_BEAM || st === ST_SUPER) {
        const sup = st === ST_SUPER;
        const t0 = t - (sup ? SUPER_SU : c.beamSu);
        if (t0 > 0 && t0 <= (sup ? SUPER_AC : c.beamAc)) {
          const d = (s[e + X] - s[o + X]) * s[o + FACE];
          const reach = sup ? 30000 : c.beamReach;
          const lim = d > 1000 && d < reach && hittable(s, e) && !sup ? d : reach;
          if (rel > 2000 && rel < lim && (sup || s[bo + BH] > c.beamY - ((rel * c.beamSlope) / 100 | 0))) s[bo + BHP] -= sup ? 80 : 30;
        }
      }
      if (s[bo + BHP] <= 0) destroy(s, i, o, 0);
    }
  }
}

function projectiles(s: Int32Array) {
  for (let i = 0; i < NP; i++) {
    const po = P0 + i * P_N;
    if (!s[po + PT]) continue;
    s[po + PVY] -= 16;
    s[po + PX] += s[po + PVX];
    s[po + PY] += s[po + PVY];
    const a = s[po + POWN] ? F1 : F0, v = s[po + POWN] ? F0 : F1;
    const px = s[po + PX], py = s[po + PY];
    if (Math.abs(px - s[v + X]) < 3200 && py < s[v + Y] + CH[s[v + CHAR]].height && py > s[v + Y] - 1000 && hittable(s, v)) {
      applyHit(s, a, v, 5, s[po + PVX] >= 0 ? 1 : -1);
      ev(EV_CHUNK, px, py);
      s[po + PT] = 0;
    } else if (py <= 0 || px > STAGE + 6000 || px < -STAGE - 6000) {
      ev(EV_CHUNK, px, 0);
      for (let b = 0; b < NB; b++) {
        const bo = B0 + b * B_N;
        if (s[bo + BHP] > 0 && Math.abs(s[bo + BX] - px) < s[bo + BW] + 1500) destroy(s, b, a, 0);
      }
      s[po + PT] = 0;
    }
  }
}

function endRound(s: Int32Array, koby: number) {
  s[G_PHASE] = PH_KO;
  s[G_PT] = 0;
  s[G_KOBY] = koby;
  if (koby & 1) s[F0 + WINS]++;
  if (koby & 2) s[F1 + WINS]++;
}

// ------------------------------------------------------------------ step
export function step(s: Int32Array, in0: number, in1: number): void {
  evN = 0;
  s[G_FRAME]++;
  const ph = s[G_PHASE];
  const pt = ++s[G_PT];
  if (ph === PH_INTRO) {
    in0 = in1 = 0;
    if (pt >= 110) {
      s[G_PHASE] = PH_FIGHT;
      s[G_PT] = 0;
      setSt(s, F0, ST_IDLE);
      setSt(s, F1, ST_IDLE);
      ev(EV_FIGHT);
    }
  } else if (ph === PH_FIGHT) {
    if (s[G_TIMER] > 0 && --s[G_TIMER] === 0) {
      const a = s[F0 + HP], b = s[F1 + HP];
      endRound(s, a > b ? 1 : b > a ? 2 : 3);
      ev(EV_TIMEUP);
      return;
    }
  } else if (ph === PH_KO) {
    in0 = in1 = 0;
    if (pt === 80) {
      const kb = s[G_KOBY];
      if (kb & 1 && s[F0 + HP] > 0 && s[F0 + Y] === 0) setSt(s, F0, ST_WIN);
      if (kb & 2 && s[F1 + HP] > 0 && s[F1 + Y] === 0) setSt(s, F1, ST_WIN);
    }
    if (pt >= 210) {
      const w0 = s[F0 + WINS] >= 2, w1 = s[F1 + WINS] >= 2;
      if (w0 || w1) {
        s[G_PHASE] = PH_END;
        s[G_PT] = 0;
        s[G_WINNER] = w0 && w1 ? 3 : w0 ? 1 : 2;
        ev(EV_END, s[G_WINNER]);
      } else {
        s[G_ROUND]++;
        resetRound(s);
      }
      return;
    }
    if (pt < 50 && s[G_FRAME] & 1) return; // dramatic K.O. slow motion (deterministic)
  } else {
    in0 = in1 = 0;
  }
  if (s[G_FREEZE] > 0) {
    // super flash: world frozen, inputs still tracked so nothing is dropped
    s[G_FREEZE]--;
    s[F0 + PREV] = in0;
    s[F1 + PREV] = in1;
    return;
  }
  control(s, F0, F1, in0);
  control(s, F1, F0, in1);
  physics(s, F0, F1);
  physics(s, F1, F0);
  pushboxes(s);
  attacks(s);
  buildings(s);
  projectiles(s);
  if (s[G_PHASE] === PH_FIGHT && (s[F0 + HP] <= 0 || s[F1 + HP] <= 0)) {
    const a = s[F0 + HP] > 0, b = s[F1 + HP] > 0;
    for (let k = 0; k < 2; k++) {
      const o = k ? F1 : F0;
      if (s[o + HP] <= 0) {
        s[o + HP] = 0;
        if (s[o + ST] !== ST_LAUNCH && s[o + ST] !== ST_DOWN) {
          setSt(s, o, ST_LAUNCH);
          s[o + VX] = -200 * s[o + FACE];
          s[o + VY] = 380;
        }
      }
    }
    endRound(s, a ? 1 : b ? 2 : 3);
    ev(EV_KO, a ? 0 : 1);
  }
}

// ------------------------------------------------------------------ CPU opponent (local play only; not part of synced state)
export interface CpuMem { rng: number; hold: number; holdT: number; think: number }
export function newCpu(seed: number): CpuMem {
  return { rng: seed | 1, hold: 0, holdT: 0, think: 0 };
}
export function cpuInput(s: Int32Array, me: number, m: CpuMem, level: number): number {
  const o = me ? F1 : F0, e = me ? F0 : F1;
  const r = () => {
    m.rng ^= m.rng << 13;
    m.rng ^= m.rng >>> 17;
    m.rng ^= m.rng << 5;
    return (m.rng >>> 0) % 100;
  };
  const face = s[e + X] >= s[o + X] ? 1 : -1;
  const fwd = face > 0 ? IN_R : IN_L, back = face > 0 ? IN_L : IN_R;
  const d = Math.abs(s[e + X] - s[o + X]);
  const c = CH[s[o + CHAR]], est = s[e + ST], st = s[o + ST];
  if (m.holdT > 0) {
    m.holdT--;
    return m.hold;
  }
  // combo follow-ups
  if (s[o + HITF] === 1) {
    if (st === ST_LIGHT && r() < 25 + level * 20) return IN_B;
    if (st === ST_HEAVY && s[o + METER] >= BEAM_COST && r() < 10 + level * 22) return s[o + METER] >= MAX_METER ? IN_X : IN_S;
  }
  // defence
  const threat = (est === ST_LIGHT || est === ST_HEAVY || est === ST_BEAM || est === ST_SUPER) && d < 15000;
  if (threat && r() < 22 + level * 22) {
    m.hold = back;
    m.holdT = 12;
    return back;
  }
  if (est === ST_GRAB && d < 6500 && r() < 30 * level) return IN_A;
  if (--m.think > 0) return m.hold & (IN_L | IN_R);
  m.think = 8 + (r() % (22 - level * 5));
  const k = r();
  let out = 0;
  if (s[o + METER] >= MAX_METER && d < 16000 && k < 30) out = IN_X;
  else if (d < c.light.reach + 1500) out = k < 45 ? IN_A : k < 60 ? IN_G : k < 80 ? IN_B : back;
  else if (d < c.heavy.reach + 1200) out = k < 38 ? IN_B : k < 50 && s[o + METER] >= BEAM_COST ? IN_S : k < 62 ? IN_D | IN_G : fwd;
  else out = k < 14 && s[o + METER] >= BEAM_COST * 2 ? IN_S : k < 30 ? IN_D | IN_G : fwd;
  m.hold = out & (IN_L | IN_R);
  if (out & IN_D) {
    m.hold = IN_D;
    m.holdT = 1;
    return IN_D | IN_G;
  }
  return out;
}
