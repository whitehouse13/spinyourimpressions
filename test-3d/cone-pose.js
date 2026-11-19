// Cup pose from MindAR's own point matches, with the cup's real shape (2026-11-19, build 13a).
//
// MindAR fits a FLAT picture, but the window panorama sits on a cone that wraps ~105° round the
// cup, so its distance/tilt guess swung with the viewing angle and the models floated from -0.8 to
// +8 cm over the rim (replay of the iPhone reference videos IMG_9041/9042, 19.11). Here each tracked
// point (target pixel <-> camera pixel, from MindAR's tracker) is put back on the cone it is printed
// on, and the pose is solved for that shape (Levenberg-Marquardt, robust weights). On the same videos
// this kept the model 0.6-0.8 cm over the rim and within 1 mm of the cup's axis.
//
// Geometry = the inner panorama layer, from warp-panorama-to-dieline.py (template sector) and
// build-ar-site.py window_geometry() at FLAT_W 2000: the target image is the window's full height
// (rows HY0..HY0+744 of the 2000 x 1091 flat strip), CW = 527 flat px wide, scaled to 512 px.
// Cup frame (cm, right-handed): apex at 0, x right, y DOWN along the axis, z away from the viewer.
export const CONE = {
  W: 2000, H: 1091, HY0: 125, CW: 527, TARGET_W: 512,
  R_TOP: 54.41, R_BOT: 41.517, THETA: 28.23 * Math.PI / 180,
};
const SA = CONE.THETA / (2 * Math.PI), CA = Math.sqrt(1 - SA * SA);
export const RIM = { y: -CONE.R_TOP * CA, r: SA * CONE.R_TOP };   // sleeve-top circle (centre on the axis, radius)
// 1 target width of the old band target (the page's unit) in cm: CW of W at the mean radius.
export const TW_CM = CONE.CW / CONE.W * CONE.THETA * (CONE.R_TOP + CONE.R_BOT) / 2;

export function conePoint(x, y, out = [0, 0, 0]) {
  const s = CONE.CW / CONE.TARGET_W;
  const phi = (x * s - CONE.CW / 2) * 2 * Math.PI / CONE.W;
  const rho = CONE.R_TOP - (CONE.HY0 + y * s) / (CONE.H - 1) * (CONE.R_TOP - CONE.R_BOT);
  const r = SA * rho;
  out[0] = r * Math.sin(phi); out[1] = -rho * CA; out[2] = -r * Math.cos(phi);
  return out;
}

// --- small linear algebra (row-major 3x3 as flat arrays) ---
function rodrigues(w) {
  const th = Math.hypot(w[0], w[1], w[2]);
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const k0 = w[0] / th, k1 = w[1] / th, k2 = w[2] / th, c = Math.cos(th), s = Math.sin(th), v = 1 - c;
  return [c + k0 * k0 * v, k0 * k1 * v - k2 * s, k0 * k2 * v + k1 * s,
          k1 * k0 * v + k2 * s, c + k1 * k1 * v, k1 * k2 * v - k0 * s,
          k2 * k0 * v - k1 * s, k2 * k1 * v + k0 * s, c + k2 * k2 * v];
}
function mul3(a, b) {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
}
function orthonormal(m) {   // Gram-Schmidt on the rows
  const r0 = [m[0], m[1], m[2]], r1 = [m[3], m[4], m[5]];
  const n0 = Math.hypot(...r0); r0.forEach((_, i) => r0[i] /= n0);
  const d = r0[0] * r1[0] + r0[1] * r1[1] + r0[2] * r1[2]; r1.forEach((_, i) => r1[i] -= d * r0[i]);
  const n1 = Math.hypot(...r1); r1.forEach((_, i) => r1[i] /= n1);
  const r2 = [r0[1] * r1[2] - r0[2] * r1[1], r0[2] * r1[0] - r0[0] * r1[2], r0[0] * r1[1] - r0[1] * r1[0]];
  return [...r0, ...r1, ...r2];
}
function solve6(A, b) {   // Gaussian elimination with partial pivoting; A 6x6 flat, b 6
  const n = 6, M = A.slice(), x = b.slice();
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[p * n + c])) p = r;
    if (Math.abs(M[p * n + c]) < 1e-12) return null;
    if (p !== c) { for (let k = 0; k < n; k++) [M[c * n + k], M[p * n + k]] = [M[p * n + k], M[c * n + k]]; [x[c], x[p]] = [x[p], x[c]]; }
    for (let r = c + 1; r < n; r++) { const f = M[r * n + c] / M[c * n + c]; for (let k = c; k < n; k++) M[r * n + k] -= f * M[c * n + k]; x[r] -= f * x[c]; }
  }
  for (let c = n - 1; c >= 0; c--) { let s = x[c]; for (let k = c + 1; k < n; k++) s -= M[c * n + k] * x[k]; x[c] = s / M[c * n + c]; }
  return x;
}

// Initial pose from MindAR's flat model-view transform (3x4, target px -> camera, CV axes, its own
// focal fm): same axes as the cup frame; depth rescaled to cm and to the true focal f.
export function poseFromMindAR(mvt, fm, f) {
  const R = orthonormal([mvt[0][0], mvt[0][1], mvt[0][2], mvt[1][0], mvt[1][1], mvt[1][2], mvt[2][0], mvt[2][1], mvt[2][2]]);
  const cx = CONE.TARGET_W / 2, cy = 744 * CONE.TARGET_W / CONE.CW / 2;
  const c = [0, 1, 2].map((i) => mvt[i][0] * cx + mvt[i][1] * cy + mvt[i][3]);
  const sCm = TW_CM / CONE.TARGET_W, k = f / fm;
  const Ct = [c[0] * sCm, c[1] * sCm, c[2] * sCm * k];   // keeps the pixel, true depth
  const P0 = conePoint(cx, cy);
  const t = [0, 1, 2].map((i) => Ct[i] - (R[i * 3] * P0[0] + R[i * 3 + 1] * P0[1] + R[i * 3 + 2] * P0[2]));
  return { R, t };
}

// Robust Levenberg-Marquardt pose fit. wc: target px [{x,y}] or [[x,y]], sc: camera px, K: {f, cx, cy}.
// Returns {R (row-major, cup -> camera), t (cm), err (median px), n} or null.
export function solveConePose(wc, sc, K, init, iters = 12) {
  const n = wc.length;
  if (n < 6) return null;
  const P = new Float64Array(n * 3), U = new Float64Array(n * 2), tmp = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = wc[i], b = sc[i];
    conePoint(a.x ?? a[0], a.y ?? a[1], tmp); P.set(tmp, i * 3);
    U[i * 2] = b.x ?? b[0]; U[i * 2 + 1] = b.y ?? b[1];
  }
  let R = init.R.slice(), t = init.t.slice(), lambda = 1e-3;
  const res = new Float64Array(n * 2);
  const residuals = (R, t, out) => {
    let ok = true;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const X = R[0] * x + R[1] * y + R[2] * z + t[0], Y = R[3] * x + R[4] * y + R[5] * z + t[1], Z = R[6] * x + R[7] * y + R[8] * z + t[2];
      if (Z <= 1) ok = false;
      out[i * 2] = K.f * X / Z + K.cx - U[i * 2]; out[i * 2 + 1] = K.f * Y / Z + K.cy - U[i * 2 + 1];
    }
    return ok;
  };
  const cost = (r, w) => { let c = 0; for (let i = 0; i < r.length; i++) c += w[i >> 1] * r[i] * r[i]; return c; };
  const huber = (r) => {   // per-point weights, delta 2 px
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) { const e = Math.hypot(r[i * 2], r[i * 2 + 1]); w[i] = e <= 2 ? 1 : 2 / e; }
    return w;
  };
  if (!residuals(R, t, res)) return null;
  const J = new Float64Array(n * 2 * 6), r2 = new Float64Array(n * 2);
  for (let it = 0; it < iters; it++) {
    const w = huber(res), c0 = cost(res, w);
    const eps = 1e-6;
    for (let k = 0; k < 6; k++) {   // numeric Jacobian: k<3 rotation (left-multiplied), k>=3 translation
      let R2 = R, t2 = t;
      if (k < 3) { const d = [0, 0, 0]; d[k] = eps; R2 = mul3(rodrigues(d), R); } else { t2 = t.slice(); t2[k - 3] += eps * 100; }
      residuals(R2, t2, r2);
      const h = k < 3 ? eps : eps * 100;
      for (let i = 0; i < n * 2; i++) J[i * 6 + k] = (r2[i] - res[i]) / h;
    }
    const A = new Array(36).fill(0), g = new Array(6).fill(0);
    for (let i = 0; i < n * 2; i++) {
      const wi = w[i >> 1];
      for (let a = 0; a < 6; a++) { g[a] -= wi * J[i * 6 + a] * res[i]; for (let b = a; b < 6; b++) A[a * 6 + b] += wi * J[i * 6 + a] * J[i * 6 + b]; }
    }
    for (let a = 0; a < 6; a++) for (let b = 0; b < a; b++) A[a * 6 + b] = A[b * 6 + a];
    let improved = false;
    for (let tries = 0; tries < 6 && !improved; tries++) {
      const Ad = A.slice(); for (let a = 0; a < 6; a++) Ad[a * 7] *= 1 + lambda;
      const d = solve6(Ad, g);
      if (!d) { lambda *= 10; continue; }
      const Rn = orthonormal(mul3(rodrigues([d[0], d[1], d[2]]), R)), tn = [t[0] + d[3], t[1] + d[4], t[2] + d[5]];
      if (residuals(Rn, tn, r2) && cost(r2, w) < c0) { R = Rn; t = tn; res.set(r2); lambda = Math.max(1e-7, lambda / 10); improved = true; }
      else lambda *= 10;
    }
    if (!improved) break;
  }
  const e = []; for (let i = 0; i < n; i++) e.push(Math.hypot(res[i * 2], res[i * 2 + 1]));
  e.sort((a, b) => a - b);
  return { R, t, err: e[n >> 1], n };
}

// Sleeve-top centre and the cup's up axis in camera coordinates (CV axes: x right, y down, z forward).
export function rimInCamera(pose) {
  const { R, t } = pose;
  const C = [R[1] * RIM.y + t[0], R[4] * RIM.y + t[1], R[7] * RIM.y + t[2]];
  const up = [-R[1], -R[4], -R[7]];
  return { C, up };
}
