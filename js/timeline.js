// Scene choreography as a pure function of elapsed (un-paused) seconds.
export const RISE = 1.2;        // one card's rise duration
export const STAGGER = 0.8;     // delay between consecutive cards
export const ORBIT = 6.0;       // orbit phase length
export const MERGE = 1.5;       // cards → ring cross-fade
export const ORBIT_TURNS = 0.5; // how far the cards travel around the cup
export const RING_SPIN = 0.35;  // ring angular speed, rad/s

export function ease(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

export function orderFrom(n, first) {
  return Array.from({ length: n }, (_, k) => (first + k) % n);
}

export function timeline(t, n) {
  const riseEnd = (n - 1) * STAGGER + RISE;
  const orbitEnd = riseEnd + ORBIT;
  const mergeEnd = orbitEnd + MERGE;
  const orbitT = ease((t - riseEnd) / ORBIT);
  return {
    phase: t < riseEnd ? "rise" : t < orbitEnd ? "orbit" : t < mergeEnd ? "merge" : "ring",
    rise: Array.from({ length: n }, (_, k) => ease((t - k * STAGGER) / RISE)),
    orbitT,
    orbitAngle: orbitT * ORBIT_TURNS * 2 * Math.PI,
    merge: ease((t - orbitEnd) / MERGE),
    ringSpin: Math.max(0, t - orbitEnd) * RING_SPIN,
    done: t >= mergeEnd,
  };
}

export class SceneClock {
  constructor() { this.t = 0; this.running = false; }
  reset() { this.t = 0; }
  tick(dt) { if (this.running) this.t += Math.min(Math.max(dt, 0), 0.1); }
}
