// Headless verification of determinism + rollback: two Sessions exchange packets through a
// simulated lossy/jittery link and must converge to identical checksums.
import { Session } from "../src/game/net";
import { checksum, cpuInput, newCpu, G_FRAME, G_PHASE, G_ROUND, G_HAVOC, F0, F1, HP, WINS, STATE_SIZE, step, initState, PH_END } from "../src/game/sim";

function run(latency: number, jitter: number, loss: number, delay: number) {
  let clock = 0;
  const now = () => clock;
  type Pkt = { at: number; to: number; buf: ArrayBuffer };
  let q: Pkt[] = [];
  let rs = 12345;
  const rand = () => ((rs = (Math.imul(rs, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
  const mk = (me: number) => new Session(me, 777, 0, 1, delay, (b) => {
    if (rand() < loss) return;
    q.push({ at: clock + latency + rand() * jitter, to: 1 - me, buf: b });
  }, () => {}, now);
  const A = mk(0), B = mk(1);
  const cpuA = newCpu(99), cpuB = newCpu(4242);
  // reference: plain offline simulation fed with the exact inputs each peer generated
  const inA: number[] = [], inB: number[] = [];
  let offset = 0;
  for (let i = 0; i < 60 * 150; i++) {
    clock += 1000 / 60;
    const due = q.filter((p) => p.at <= clock);
    q = q.filter((p) => p.at > clock);
    for (const p of due) (p.to === 0 ? A : B).onPacket(p.buf);
    const ia = cpuInput(A.s, 0, cpuA, 2), ib = cpuInput(B.s, 1, cpuB, 2);
    const fa = A.frame, fb = B.frame;
    if (A.tick(ia)) inA[fa + delay] = ia;
    // B starts ~3 frames late to exercise time sync
    if (i >= 3) {
      if (B.tick(ib)) inB[fb + delay] = ib;
    } else offset++;
    if (A.s[G_PHASE] === PH_END && B.s[G_PHASE] === PH_END && A.remoteLast >= A.frame - 1 && B.remoteLast >= B.frame - 1) break;
  }
  // drain: let both sides confirm everything
  for (let i = 0; i < 120; i++) {
    clock += 1000 / 60;
    const due = q.filter((p) => p.at <= clock);
    q = q.filter((p) => p.at > clock);
    for (const p of due) (p.to === 0 ? A : B).onPacket(p.buf);
    A.tick(0) ; B.tick(0);
  }
  const n = Math.min(A.frame, B.frame, A.remoteLast + 1, B.remoteLast + 1);
  const ref = new Int32Array(STATE_SIZE);
  initState(ref, 777, 0, 1);
  // replay confirmed inputs offline up to frame n and compare with a rolled-back copy
  for (let f = 0; f < n; f++) step(ref, inA[f] || 0, inB[f] || 0);
  const snapEq = (S: Session) => {
    // re-sim S from scratch is not exposed; compare when both are exactly at n
    return S.frame === n ? checksum(S.s) === checksum(ref) : null;
  };
  console.log(
    `lat=${latency}ms jit=${jitter} loss=${(loss * 100) | 0}% delay=${delay} | frames A=${A.frame} B=${B.frame} conf=${n} | rtt≈${A.stats.rtt.toFixed(0)}ms rbPeak A=${A.stats.rbPeak} B=${B.stats.rbPeak} stalls A=${A.stats.stalls} B=${B.stats.stalls} | desyncFlag=${A.stats.desync || B.stats.desync} | A==ref:${snapEq(A)} B==ref:${snapEq(B)} | round=${ref[G_ROUND]} hp=${ref[F0 + HP]}/${ref[F1 + HP]} wins=${ref[F0 + WINS]}-${ref[F1 + WINS]} havoc=${ref[G_HAVOC]} phase=${ref[G_PHASE]} gframe=${ref[G_FRAME]}`,
  );
}
run(0, 0, 0, 0);
run(40, 10, 0.02, 2);
run(90, 30, 0.1, 2);
run(150, 60, 0.2, 3);
