// Finds the die-cut window's left and right edges in a horizontal strip of
// the camera frame. The tracked landmark crop says where the landmark is,
// not where the window is (phone tests 2026-10-03/04: the ring followed the
// landmark when the inner layer was turned off-centre). The window is a
// painting set in smooth, near-neutral paper, so its side edges show up as a
// step in per-column "texture + colour". Pure function — no DOM, no three.js.

const MIN_CONTRAST = 8;    // score units; below this there is no window edge to see
const WIDTH_MIN = 0.6;     // plausible span width, × expected window width
const WIDTH_MAX = 1.25;

// px: RGBA bytes, w×h. seedX: a column known to be inside the window (the
// tracked target's centre). expectW: expected window width in strip pixels.
// Returns {x0, x1} (inclusive columns) or null.
export function findWindowSpan(px, w, h, seedX, expectW) {
  seedX = Math.round(seedX);
  if (!(seedX >= 0 && seedX < w) || h < 2) return null;

  // Per column: mean |vertical luminance step| (painted texture) plus half the
  // mean chroma (max−min of RGB). Paper is smooth and nearly neutral.
  const raw = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let tex = 0, sat = 0, prev = -1;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (prev >= 0) tex += Math.abs(lum - prev);
      prev = lum;
      sat += Math.max(r, g, b) - Math.min(r, g, b);
    }
    raw[x] = tex / (h - 1) + 0.5 * sat / h;
  }

  const rad = Math.max(1, Math.round(w / 120));          // light box smoothing
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
  if (score[seedX] < thr) return null;

  // Grow from the seed; a short smooth patch inside the painting (flat sky)
  // must not end the span, so tolerate gaps up to ~6% of the window width.
  const gap = Math.max(2, Math.round(0.06 * expectW));
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
