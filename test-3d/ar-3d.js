// Test only, not part of the live site: drone splat model above the cup.
// A target with a model in MODELS shows it; any other target hides it, so
// turning the cup switches models. ?nocam=1 skips the camera and just spins
// the model, to measure load time and frame rate.
import * as THREE from "three";
import * as GS from "splats";
import { MindARThree } from "mindar-image-three";
import { findWindowSpan } from "./window-span.js";

// Round crops the shape of the cup, glare above the buildings cut off
// (2026-11-03); ?old=1 brings back the square building crop.
const OLD = new URLSearchParams(location.search).has("old");
const CANICE = OLD
  ? { name: "St Canice's (square)", url: "data/st-canice-building.splat", scale: 1.2, lift: 0.8 }
  : { name: "St Canice's", url: "data/st-canice-cup.compressed.ply", r: 0.41, scale: 2.0, lift: 1.5 };
const MODELS = {
  // Panorama A, left to right: Butter Slip (A:0), St Kieran's College (A:1),
  // St Canice's Cathedral with the Round Tower (A:2) — names fixed 2026-11-09.
  "kilkenny-A:1": { name: "St Kieran's College", url: "data/st-kierans-cup.compressed.ply", r: 0.53, scale: 1.5, lift: 1.5 },
  "kilkenny-A:2": CANICE,
  "kilkenny-B:1": OLD
    ? { name: "St Mary's (old)", url: "data/st-marys.compressed.ply", scale: 0.9, lift: 0.6 }
    : { name: "St Mary's", url: "data/st-marys-cup.compressed.ply", r: 0.34, scale: 1.9, lift: 1.5 },
  // 2026-11-04 shoot. Smithwick's was filmed from the street only: it sways
  // ±sweep degrees around its facade instead of turning all the way round.
  "kilkenny-B:0": { name: "Smithwick's", url: "data/smithwicks-cup.compressed.ply", r: 0.21, scale: 1.6, lift: 1.5, sweep: 40 },
  "kilkenny-B:2": { name: "Kilkenny Castle", url: "data/kilkenny-castle-cup.compressed.ply", r: 0.48, scale: 1.9, lift: 1.5 },
};
const params = new URLSearchParams(location.search);
const TILT = params.has("tilt") ? parseFloat(params.get("tilt")) : 0.5;
// ?lift= / ?size= tune height above the cup and size without a redeploy.
const LIFT_X = params.has("lift") ? parseFloat(params.get("lift")) : 1;
let sizeX = params.has("size") ? parseFloat(params.get("size")) : 1;
let current = null;
// Turn = finger turn + auto-spin phase; a model with `sweep` sways instead of spinning.
let userYaw = 0, phase = 0;
const turn = () => {
  if (state.autospin && !drag) phase += 0.006;
  const sw = current?.sweep;
  spin.rotation.y = userYaw + (sw ? Math.sin(phase * 1.5) * sw * Math.PI / 180 : phase);
};
// Levitation (phone test 2026-11-11: the model sat on the rim). Put the model
// over the cup's axis (cupRadius behind the wall) and high enough that the
// front edge of its tilted ground disc still clears the rim by GAP.
// Units = target widths; r = model footprint radius (model units).
let SCENE = null;           // manifest.scene: rimY, cupRadius
const GAP = 0.25 * (params.has("gap") ? parseFloat(params.get("gap")) : 1);
const place = () => {
  if (!current) return;
  const k = current.scale * sizeX;
  holder.scale.setScalar(k);
  if (SCENE && current.r) {
    const dip = current.r * k * Math.max(0, Math.sin(holder.rotation.x)) + 0.06 * k;
    holder.position.set(0, SCENE.rimY + GAP * LIFT_X + dip, -SCENE.cupRadius);
  } else holder.position.set(0, current.lift * LIFT_X, 0);
};
const hud = document.getElementById("hud");
const btn = document.getElementById("start");
const nocam = new URLSearchParams(location.search).has("nocam");
const state = { target: "-", model: "-", load: "-", fps: 0, autospin: true };
const show = () => {
  const tilt = Math.round(holder.rotation.x * 180 / Math.PI);
  hud.textContent = `target ${state.target} · model ${state.model} · load ${state.load} · ${state.fps} fps · tilt ${tilt}° · size ${sizeX.toFixed(2)}`;
};
window.kcc3d = state;
window.addEventListener("error", (e) => { hud.textContent = "ERROR " + e.message; });

const viewer = new GS.DropInViewer({
  gpuAcceleratedSort: false, sharedMemoryForWorkers: false, integerBasedSort: true,
  dynamicScene: true, sphericalHarmonicsDegree: 0, logLevel: GS.LogLevel.None,
});
const holder = new THREE.Group(), spin = new THREE.Group();
spin.add(viewer); holder.add(spin);
holder.visible = false;
holder.rotation.x = TILT;   // the model floats above eye level: lean it towards the viewer

// Finger control: drag up/down = tilt, left/right = turn, two-finger pinch =
// size, double tap = auto-spin on/off. The HUD shows tilt and size.
let drag = null, lastTap = 0, pinch = null;
const touchGap = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
addEventListener("touchstart", (e) => {
  if (e.touches.length === 2) { pinch = { d: touchGap(e.touches), s: sizeX }; drag = null; }
}, { passive: true });
addEventListener("touchmove", (e) => {
  if (pinch && e.touches.length === 2) {
    sizeX = Math.min(4, Math.max(0.3, pinch.s * touchGap(e.touches) / pinch.d)); place(); show();
  }
}, { passive: true });
addEventListener("touchend", (e) => { if (e.touches.length < 2) pinch = null; });
addEventListener("pointerdown", (e) => {
  if (e.target.id === "start" || pinch) return;
  const now = performance.now();
  if (now - lastTap < 300) state.autospin = !state.autospin;
  lastTap = now;
  drag = { x: e.clientX, y: e.clientY };
});
addEventListener("pointermove", (e) => {
  if (!drag || pinch) return;
  userYaw += (e.clientX - drag.x) * 0.01;
  holder.rotation.x = Math.min(1.6, Math.max(-0.3, holder.rotation.x + (e.clientY - drag.y) * 0.005));
  drag = { x: e.clientX, y: e.clientY }; place(); show();
});
addEventListener("pointerup", () => { drag = null; });
addEventListener("pointercancel", () => { drag = null; });

async function loadModel(m) {
  const t0 = performance.now();
  state.load = "…"; show();
  if (viewer.getSceneCount() > 0) await viewer.removeSplatScene(0, false);
  current = m; userYaw = 0; phase = 0; place();
  const url = m.url;
  // This renderer treats +Y as down, so turn the model upright (180° about X).
  await viewer.addSplatScene(url, { showLoadingUI: false, splatAlphaRemovalThreshold: 5, rotation: [1, 0, 0, 0] });
  state.load = ((performance.now() - t0) / 1000).toFixed(1) + " s"; show();
}

function loop(renderer, scene, camera, each) {
  let n = 0, t0 = performance.now();
  renderer.setAnimationLoop(() => {
    each?.();
    renderer.render(scene, camera);
    if (++n === 30) {
      const t = performance.now();
      state.fps = Math.round(30000 / (t - t0)); n = 0; t0 = t; show();
    }
  });
}

async function startNoCam() {
  btn.remove();
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); // lets a test grab frames
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.getElementById("stage").append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 50);
  camera.position.set(0, 0.9, 2.2);
  camera.lookAt(0, 0.65, 0);
  holder.visible = true;
  scene.add(holder);
  const m = MODELS[new URLSearchParams(location.search).get("model") || "kilkenny-A:1"];
  state.target = "none"; state.model = m.name;
  await loadModel(m);
  loop(renderer, scene, camera, turn);
}

async function startAR() {
  btn.remove();
  const manifest = await (await fetch("data/cities.json")).json();
  SCENE = manifest.scene;
  const mindar = new MindARThree({
    container: document.getElementById("stage"), imageTargetSrc: "data/targets.mind", maxTrack: 1,
    uiLoading: "no", uiScanning: "no", uiError: "no",
    filterMinCF: 0.0001, filterBeta: 0.001, missTolerance: 20,
  });
  const { renderer, scene, camera } = mindar;
  // Phone test 2026-11-03: 10 fps at full Retina resolution; draw at 1x.
  renderer.setPixelRatio(1);
  // MindAR works in target pixels, far too large for the splat sort, so the
  // model gets its own scene at unit scale with the anchor pose shrunk to match.
  const splatScene = new THREE.Scene(), rig = new THREE.Group();
  const splatCamera = new THREE.PerspectiveCamera();
  rig.add(holder); splatScene.add(rig);
  renderer.autoClear = false;
  const pos = new THREE.Vector3(), size = new THREE.Vector3(), rot = new THREE.Quaternion();
  let tracked = null, loaded = null;
  // Like the live site (app.js): MindAR's rotation on the curved cup tilts and
  // jitters, and its centre is the landmark, not the cup. So use the position
  // only (model stays upright to the camera) and shift it sideways to the
  // die-cut window found in the camera frame.
  const sp = manifest.scene;
  const winChord = 2 * sp.cupRadius * Math.sin(sp.cardWidth / sp.cupRadius / 2);
  const strip = document.createElement("canvas");
  const stripCtx = strip.getContext("2d", { willReadFrequently: true });
  const fix = { dx: 0, goal: 0, at: 0, good: -Infinity };
  const ndc = new THREE.Vector3(), stage = document.getElementById("stage");
  function windowShift(p, s) {   // p = anchor position in MindAR's camera space, s = its scale
    const video = mindar.video;
    if (!video || !video.videoWidth || video.readyState < 2) return null;
    const cw = stage.clientWidth, ch = stage.clientHeight;
    const L = parseFloat(video.style.left) || 0, T = parseFloat(video.style.top) || 0;
    const vw = parseFloat(video.style.width) || cw, vh = parseFloat(video.style.height) || ch;
    const toVx = video.videoWidth / vw, toVy = video.videoHeight / vh;
    ndc.copy(p).project(camera);
    const cx = (ndc.x + 1) / 2 * cw, cy = (1 - ndc.y) / 2 * ch;
    const k = (ch / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / -p.z;
    const expectC = winChord * s * k, halfRowsC = 0.3 * s * k;
    const sx = Math.max(0, Math.round((cx - 1.1 * expectC - L) * toVx));
    const ex = Math.min(video.videoWidth, Math.round((cx + 1.1 * expectC - L) * toVx));
    const sy = Math.max(0, Math.round((cy - halfRowsC - T) * toVy));
    const ey = Math.min(video.videoHeight, Math.round((cy + halfRowsC - T) * toVy));
    if (ex - sx < 20 || ey - sy < 4) return null;
    const scale = Math.min(1, 240 / (ex - sx));
    const w = Math.max(1, Math.round((ex - sx) * scale)), h = Math.max(2, Math.round((ey - sy) * scale));
    strip.width = w; strip.height = h;
    try { stripCtx.drawImage(video, sx, sy, ex - sx, ey - sy, 0, 0, w, h); } catch { return null; }
    const toStrip = (xc) => ((xc - L) * toVx - sx) * scale;
    const span = findWindowSpan(stripCtx.getImageData(0, 0, w, h).data, w, h, toStrip(cx), expectC * toVx * scale);
    if (!span) return null;
    const midC = ((span.x0 + span.x1) / 2 / scale + sx) / toVx + L;
    return (midC - cx) / k;   // MindAR world units
  }
  manifest.targets.forEach((tg, i) => {
    const anchor = mindar.addAnchor(i);
    const key = `${tg.variant}:${tg.landmark}`;
    anchor.onTargetFound = async () => {
      state.target = key;
      const m = MODELS[key];
      tracked = anchor;
      if (!m) { holder.visible = false; state.model = "none here"; show(); return; }
      state.model = m.name; show();
      tracked = anchor;
      holder.visible = true;
      if (loaded !== m.url) { loaded = m.url; await loadModel(m); }
    };
    anchor.onTargetLost = () => {
      if (tracked !== anchor) return;   // a newer landmark already took over
      state.target = "lost"; holder.visible = false; show();
    };
  });
  await mindar.start();
  show();
  const draw = renderer.render.bind(renderer);
  let n = 0, t0 = performance.now();
  renderer.setAnimationLoop(() => {
    renderer.clear();
    draw(scene, camera);
    turn();
    if (tracked && tracked.group.visible) {
      tracked.group.updateWorldMatrix(true, false);
      tracked.group.matrixWorld.decompose(pos, rot, size);
      const now = performance.now();
      if (now - fix.at >= 150) {
        fix.at = now;
        const dx = windowShift(pos, size.x);
        if (dx !== null) { fix.goal = dx; fix.good = now; } else if (now - fix.good > 1000) fix.goal = 0;
      }
      fix.dx += (fix.goal - fix.dx) * 0.2;
      pos.x += fix.dx;
      const goal = pos.divideScalar(size.x);
      if (rig.userData.placed) rig.position.lerp(goal, 0.25); else { rig.position.copy(goal); rig.userData.placed = true; }
      splatCamera.projectionMatrix.copy(camera.projectionMatrix);
      // MindAR's near plane is 10, past the shrunk model; use near 0.01, far 100.
      splatCamera.projectionMatrix.elements[10] = -100.01 / 99.99;
      splatCamera.projectionMatrix.elements[14] = -2 / 99.99;
      splatCamera.projectionMatrixInverse.copy(splatCamera.projectionMatrix).invert();
      draw(splatScene, splatCamera);
    }
    if (++n === 30) {
      const t = performance.now();
      state.fps = Math.round(30000 / (t - t0)); n = 0; t0 = t; show();
    }
  });
}

show();
btn.onclick = () => (nocam ? startNoCam() : startAR()).catch((e) => { hud.textContent = "ERROR " + e.message; });
if (nocam) btn.click();
