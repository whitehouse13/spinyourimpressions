// Finds the die-cut window's left and right edges in a horizontal strip of
// the camera frame. The tracked landmark crop says where the landmark is,
// not where the window is (phone tests 2026-10-03/04: the ring followed the
// landmark when the inner layer was turned off-centre). The window is a
// painting set in smooth, near-neutral paper, so its side edges show up as a
// step in per-column "texture + colour". Pure function — no DOM, no three.js.

const MIN_CONTRAST = 8;    // score units; below this there is no window edge to see
const WIDTH_MIN = 0.6;     // plausible span width, × expected window width
const WIDTH_MAX = 1.25;
const SEED_REACH = 0.4;    // × expected width: how far off the painting the seed may be

// px: RGBA bytes, w×h. seedX: a column known to be inside the window (the
// tracked target's centre). expectW: expected window width in strip pixels.
// Returns {x0, x1} (inclusive columns) or null.
export function findWindowSpan(px, w, h, seedX, expectW) {
  seedX = Math.round(seedX);
  if (!(seedX >= 0 && seedX < w) || h < 2) return null;

  // Per column: mean |vertical luminance step| (painted texture), half the
  // mean chroma (max−min of RGB), and half of how much darker than the paper
  // it is. Paper is smooth, nearly neutral and the brightest thing around;
  // shadowed parts of the painting can be grey and blurry but are darker
  // (phone screenshots 2026-10-04).
  const tex = new Float32Array(w), sat = new Float32Array(w), lum = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let t = 0, s = 0, l = 0, prev = -1;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
      const v = 0.299 * r + 0.587 * g + 0.114 * b;
      if (prev >= 0) t += Math.abs(v - prev);
      prev = v;
      s += Math.max(r, g, b) - Math.min(r, g, b);
      l += v;
    }
    tex[x] = t / (h - 1); sat[x] = s / h; lum[x] = l / h;
  }
  const paperLum = Array.from(lum).sort((a, b) => a - b)[Math.floor(0.9 * (w - 1))];
  const raw = new Float32Array(w);
  for (let x = 0; x < w; x++) raw[x] = tex[x] + 0.5 * sat[x] + 0.5 * Math.max(0, paperLum - lum[x]);

  const rad = 1;                                         // light box smoothing
  const score = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = Math.max(0, x - rad); k <= Math.min(w - 1, x + rad); k++) { s += raw[k]; n++; }
    score[x] = s / n;
  }

  const sorted = Array.from(score).sort((a, b) => a - b);
  const lo = sorted[Math.floor(0.1 * (w - 1))], hi = sorted[Math.floor(0.9 * (w - 1))];
  if (hi - lo < MIN_CONTRAST) return null;
  const thr = (lo + hi) / 2;
  // The landmark (seed) can sit at or just past the window edge when the
  // inner layer is turned far (phone test 2026-10-04) — then start from the
  // nearest painted column within 40% of the window width.
  if (score[seedX] < thr) {
    const reach = Math.round(SEED_REACH * expectW);
    let found = -1;
    for (let d = 1; d <= reach && found < 0; d++) {
      if (seedX - d >= 0 && score[seedX - d] >= thr) found = seedX - d;
      else if (seedX + d < w && score[seedX + d] >= thr) found = seedX + d;
    }
    if (found < 0) return null;
    seedX = found;
  }

  // Grow from the seed, tolerating a tiny low-score gap (≈2.5% of the window
  // width). Kept small: the cup's paper between the window and the cup's edge
  // is narrow, and a dark background beyond it scores as "painting" too
  // (screenshot 20:48 — a toaster), so a bigger gap jumped over that paper.
  const gap = Math.max(1, Math.round(0.025 * expectW));
  const grow = (dir) => {
    let edge = seedX, miss = 0;
    for (let x = seedX + dir; x >= 0 && x < w; x += dir) {
      if (score[x] >= thr) { edge = x; miss = 0; } else if (++miss > gap) return edge;
    }
    return null;                                         // ran off the strip: edge not visible
  };
  const x0 = grow(-1), x1 = grow(1);
  if (x0 === null || x1 === null) return null;
  const width = x1 - x0 + 1;
  if (width < WIDTH_MIN * expectW || width > WIDTH_MAX * expectW) return null;
  return { x0, x1 };
}
