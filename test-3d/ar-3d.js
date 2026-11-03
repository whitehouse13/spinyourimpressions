// Test only, not part of the live site: drone splat model above the cup.
// A target with a model in MODELS shows it; any other target hides it, so
// turning the cup switches models. ?nocam=1 skips the camera and just spins
// the model, to measure load time and frame rate.
import * as THREE from "three";
import * as GS from "splats";
import { MindARThree } from "mindar-image-three";

// Round crops the shape of the cup, glare above the buildings cut off
// (2026-11-03); ?old=1 brings back the square building crop.
const OLD = new URLSearchParams(location.search).has("old");
const CANICE = OLD
  ? { name: "St Canice's (square)", url: "data/st-canice-building.splat", scale: 1.2, lift: 0.8 }
  : { name: "St Canice's", url: "data/st-canice-cup.compressed.ply", scale: 1.25, lift: 1.45 };
const MODELS = {
  "kilkenny-A:1": CANICE,
  "kilkenny-A:2": CANICE, // Round Tower is in the same model
  "kilkenny-B:1": OLD
    ? { name: "St Mary's (old)", url: "data/st-marys.compressed.ply", scale: 0.9, lift: 0.6 }
    : { name: "St Mary's", url: "data/st-marys-cup.compressed.ply", scale: 1.2, lift: 1.45 },
};
const params = new URLSearchParams(location.search);
const TILT = params.has("tilt") ? parseFloat(params.get("tilt")) : 0.9;
const hud = document.getElementById("hud");
const btn = document.getElementById("start");
const nocam = new URLSearchParams(location.search).has("nocam");
const state = { target: "-", model: "-", load: "-", fps: 0, autospin: true };
const show = () => {
  const tilt = Math.round(holder.rotation.x * 180 / Math.PI);
  hud.textContent = `target ${state.target} · model ${state.model} · load ${state.load} · ${state.fps} fps · tilt ${tilt}°`;
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

// Finger control of the viewing angle: drag up/down = tilt, left/right = turn,
// double tap = auto-spin on/off. The HUD shows the tilt so a good angle can be kept.
let drag = null, lastTap = 0;
addEventListener("pointerdown", (e) => {
  if (e.target.id === "start") return;
  const now = performance.now();
  if (now - lastTap < 300) state.autospin = !state.autospin;
  lastTap = now;
  drag = { x: e.clientX, y: e.clientY };
});
addEventListener("pointermove", (e) => {
  if (!drag) return;
  spin.rotation.y += (e.clientX - drag.x) * 0.01;
  holder.rotation.x = Math.min(1.6, Math.max(-0.3, holder.rotation.x + (e.clientY - drag.y) * 0.005));
  drag = { x: e.clientX, y: e.clientY }; show();
});
addEventListener("pointerup", () => { drag = null; });
addEventListener("pointercancel", () => { drag = null; });

async function loadModel(m) {
  const t0 = performance.now();
  state.load = "…"; show();
  if (viewer.getSceneCount() > 0) await viewer.removeSplatScene(0, false);
  holder.scale.setScalar(m.scale);
  holder.position.set(0, m.lift, 0.25);
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
  loop(renderer, scene, camera, () => { if (state.autospin && !drag) spin.rotation.y += 0.006; });
}

async function startAR() {
  btn.remove();
  const manifest = await (await fetch("data/cities.json")).json();
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
  const pos = new THREE.Vector3(), size = new THREE.Vector3();
  let tracked = null, loaded = null;
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
    if (state.autospin && !drag) spin.rotation.y += 0.006;
    if (tracked && tracked.group.visible) {
      tracked.group.updateWorldMatrix(true, false);
      tracked.group.matrixWorld.decompose(pos, rig.quaternion, size);
      rig.position.copy(pos).divideScalar(size.x);
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
