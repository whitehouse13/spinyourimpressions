// KCC AR postcards (/postcards/, 2026-11-18). Each postcard front is one MindAR target
// (data/postcards.mind, index i == data/cards.json[i]). A flat card tracks well, so unlike
// the cup page the full anchor pose is used: the landmark's splat model stands upright on
// the card (model +Y along the card's normal) and "rises" when the card is found.
// Cards without a model yet show their text and "coming soon".
// ?debug shows a status line; ?full / ?mid / ?lite pick the model quality (Android: mid,
// the quality chosen on the cup test page 2026-11-14).
import * as THREE from "three";
import * as GS from "splats";
import { MindARThree } from "mindar-image-three";

const params = new URLSearchParams(location.search);
const ANDROID = /Android/i.test(navigator.userAgent);
const QUALITY = params.has("full") ? "full" : params.has("mid") ? "mid" : params.has("lite") ? "lite" : ANDROID ? "mid" : "full";
const DEBUG = params.has("debug");
const FOOTPRINT = 0.22 * (params.has("size") ? parseFloat(params.get("size")) : 1);   // model ground radius, card widths
const RISE_MS = 900;

const $ = (s) => document.querySelector(s);
const hint = $("#hint"), card = $("#card"), dbg = $("#debug");
const state = { target: "-", model: "-", load: "-", fps: 0 };
window.kccPostcards = state;
if (DEBUG) dbg.style.display = "block";
const show = () => { if (DEBUG) dbg.textContent = `target ${state.target} · ${state.model} · load ${state.load} · ${state.fps} fps · ${ANDROID ? "android" : "ios"} ${QUALITY}`; };

function showCard(c) {
  if (!c) { card.style.display = "none"; hint.classList.remove("hidden"); return; }
  card.querySelector("h2").textContent = c.name;
  card.querySelector(".blurb").textContent = c.blurb;
  card.querySelector(".soon").classList.toggle("hidden", !!c.model);
  card.style.display = "block"; hint.classList.add("hidden");
}

const viewer = new GS.DropInViewer({
  gpuAcceleratedSort: false, sharedMemoryForWorkers: false, integerBasedSort: true,
  dynamicScene: true, sphericalHarmonicsDegree: 0, logLevel: GS.LogLevel.None,
});
// rig = card pose (card widths); holder = stands the model up on the card; spin = turn.
const rig = new THREE.Group(), holder = new THREE.Group(), spin = new THREE.Group();
spin.add(viewer); holder.add(spin); rig.add(holder);
holder.rotation.x = Math.PI / 2;   // model +Y -> card normal (+Z, towards the camera)
rig.visible = false;

let current = null, loadedUrl = null, riseAt = 0, userYaw = 0, phase = 0, drag = null;
addEventListener("pointerdown", (e) => { if (e.target.id !== "start") drag = e.clientX; });
addEventListener("pointermove", (e) => { if (drag !== null) { userYaw += (e.clientX - drag) * 0.01; drag = e.clientX; } });
addEventListener("pointerup", () => { drag = null; });
addEventListener("pointercancel", () => { drag = null; });

const modelUrl = (c) => QUALITY === "full" ? c.model : c.model.replace(".compressed.ply", `-${QUALITY}.compressed.ply`);
async function loadModel(c) {
  const url = modelUrl(c);
  if (loadedUrl === url) return;
  loadedUrl = url;
  const t0 = performance.now();
  state.load = "…"; show();
  if (viewer.getSceneCount() > 0) await viewer.removeSplatScene(0, false);
  // This renderer treats +Y as down, so turn the model upright (180° about X) — as on the cup page.
  await viewer.addSplatScene(url, { showLoadingUI: false, splatAlphaRemovalThreshold: 5, rotation: [1, 0, 0, 0] });
  if (loadedUrl !== url) return;   // another card took over while loading
  state.load = ((performance.now() - t0) / 1000).toFixed(1) + " s"; show();
  riseAt = performance.now();
}

async function start() {
  const err = $("#err");
  try { if (typeof DeviceOrientationEvent?.requestPermission === "function") await DeviceOrientationEvent.requestPermission(); } catch {}
  const cards = await (await fetch("data/cards.json")).json();
  const mindar = new MindARThree({
    container: $("#stage"), imageTargetSrc: "data/postcards.mind", maxTrack: 1,
    uiLoading: "no", uiScanning: "no", uiError: "no",
    filterMinCF: 0.0005, filterBeta: 0.01, missTolerance: 10,
  });
  const { renderer, scene, camera } = mindar;
  renderer.setPixelRatio(1);   // cup test 2026-11-03: full Retina resolution halves the frame rate
  // MindAR works in target pixels, far too large for the splat sort: the model gets its own
  // scene at card-width scale with the anchor pose shrunk to match (as on the cup page).
  const splatScene = new THREE.Scene(), splatCamera = new THREE.PerspectiveCamera();
  splatScene.add(rig);
  renderer.autoClear = false;
  const pos = new THREE.Vector3(), size = new THREE.Vector3(), rot = new THREE.Quaternion();
  let tracked = null;
  cards.forEach((c, i) => {
    const anchor = mindar.addAnchor(i);
    anchor.onTargetFound = () => {
      tracked = anchor; state.target = c.slug; showCard(c);
      rig.userData.placed = false;
      if (!c.model) { current = null; rig.visible = false; state.model = "none"; show(); return; }
      current = c; state.model = c.name; rig.visible = true; show();
      userYaw = 0; phase = 0; riseAt = performance.now();
      loadModel(c).catch((e) => { state.load = "ERROR " + e.message; show(); });
    };
    anchor.onTargetLost = () => {
      if (tracked !== anchor) return;
      tracked = null; rig.visible = false; state.target = "lost"; showCard(null); show();
    };
  });
  await mindar.start();
  $("#intro").classList.add("hidden"); hint.classList.remove("hidden");
  let n = 0, t0 = performance.now();
  renderer.setAnimationLoop(() => {
    renderer.clear();
    renderer.render(scene, camera);
    if (tracked && current && tracked.group.visible) {
      tracked.group.updateWorldMatrix(true, false);
      tracked.group.matrixWorld.decompose(pos, rot, size);
      pos.divideScalar(size.x);
      if (rig.userData.placed) { rig.position.lerp(pos, 0.35); rig.quaternion.slerp(rot, 0.35); }
      else { rig.position.copy(pos); rig.quaternion.copy(rot); rig.userData.placed = true; }
      // Rise: grow out of the card with an ease-out over RISE_MS, then turn slowly.
      const t = Math.min(1, (performance.now() - riseAt) / RISE_MS), ease = 1 - Math.pow(1 - t, 3);
      holder.scale.setScalar(Math.max(0.001, (FOOTPRINT / current.r) * ease));
      holder.position.set(0, 0, 0.01);
      if (drag === null) phase += 0.004;
      spin.rotation.y = userYaw + phase;
      splatCamera.projectionMatrix.copy(camera.projectionMatrix);
      // MindAR's near plane is 10, past the shrunk model; use near 0.01, far 100.
      splatCamera.projectionMatrix.elements[10] = -100.01 / 99.99;
      splatCamera.projectionMatrix.elements[14] = -2 / 99.99;
      splatCamera.projectionMatrixInverse.copy(splatCamera.projectionMatrix).invert();
      renderer.render(splatScene, splatCamera);
    }
    if (++n === 30) { const now = performance.now(); state.fps = Math.round(30000 / (now - t0)); n = 0; t0 = now; show(); }
  });
}

show();
$("#start").onclick = () => {
  $("#start").disabled = true;
  start().catch((e) => {
    $("#err").textContent = "Camera could not start: " + e.message;
    $("#start").disabled = false;
  });
};
