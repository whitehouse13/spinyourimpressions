// KCC AR postcards (/postcards/, 2026-11-18). Each postcard front is one MindAR target
// (data/postcards.mind, index i == data/cards.json[i]). A flat card tracks well, so unlike
// the cup page the full anchor pose is used: the landmark's splat model stands upright on
// the card (model +Y along the card's normal) and "rises" when the card is found.
// Cards without a model yet show their text and "coming soon".
// 2026-11-22 (iPhone video: the model lay on the card held in the hand, seen from the top, small):
// like on the cup, the model now stands ABOVE the card's top edge, upright by the phone's gravity,
// leaning a little towards the viewer, and bigger. ?oncard = the old placement (on the card).
// 2026-11-22 (2): bigger (footprint 0.3 -> 0.45), a little higher (gap 0.03 -> 0.08), and above the
// top edge also when the card lies on a table (then it stands upright just behind the far edge) —
// the "on the card" mode switched on too often with the card held at an angle.
// 2026-11-22 (3) (video: looking down at the card, the upright model was seen from the top as a big
// blob over the card): the model is now stood up relative to the SCREEN — seen from the side with a
// slight lean, whatever the card's angle — and placed above the card's highest point on screen with a
// gap, so it never covers the card, in the hand or on a table.
// ?debug shows a status line; ?full / ?mid / ?lite pick the model quality (Android: mid,
// the quality chosen on the cup test page 2026-11-14).
import * as THREE from "three";
import * as GS from "splats";
import { MindARThree } from "mindar-image-three";

const params = new URLSearchParams(location.search);
const ANDROID = /Android/i.test(navigator.userAgent);
const QUALITY = params.has("full") ? "full" : params.has("mid") ? "mid" : params.has("lite") ? "lite" : ANDROID ? "mid" : "full";
const DEBUG = params.has("debug");
const FOOTPRINT = 0.45 * (params.has("size") ? parseFloat(params.get("size")) : 1);   // model ground radius, card widths
const RISE_MS = 900;
const ONCARD = params.has("oncard");
const LEAN = 0.25;        // rad, top towards the viewer (cup page 13d: 0.2-0.28)
const GAP = 0.15;         // card widths between the card's top edge and the model's ground

// Gravity "up" in camera axes (x right, y up, z towards the viewer), as on the cup page.
const gravityUp = new THREE.Vector3(0, 1, 0);
let hasGravity = false;
const _g = new THREE.Vector3();
addEventListener("deviceorientation", (e) => {
  if (e.beta == null || e.gamma == null) return;
  const b = THREE.MathUtils.degToRad(e.beta), g = THREE.MathUtils.degToRad(e.gamma);
  _g.set(-Math.sin(g) * Math.cos(b), Math.sin(b), Math.cos(g) * Math.cos(b));
  const a = THREE.MathUtils.degToRad(screen.orientation?.angle || 0);
  _g.set(_g.x * Math.cos(a) + _g.y * Math.sin(a), -_g.x * Math.sin(a) + _g.y * Math.cos(a), _g.z).normalize();
  if (!hasGravity) { gravityUp.copy(_g); hasGravity = true; } else gravityUp.lerp(_g, 0.2).normalize();
});

const $ = (s) => document.querySelector(s);
const hint = $("#hint"), card = $("#card"), dbg = $("#debug");
const state = { target: "-", model: "-", load: "-", fps: 0 };
window.kccPostcards = state;
if (DEBUG) dbg.style.display = "block";
const show = () => { if (DEBUG) dbg.textContent = `target ${state.target} · ${state.model} · load ${state.load} · ${state.fps} fps · ${ANDROID ? "android" : "ios"} ${QUALITY} · ${state.mode || "-"} · ${hasGravity ? "gravity" : "no gravity"}`; };

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
// rig = where the model stands (card widths) with +Y = its up and +Z towards the camera;
// holder = lean + lift; spin = turn.
const rig = new THREE.Group(), holder = new THREE.Group(), spin = new THREE.Group();
spin.add(viewer); holder.add(spin); rig.add(holder);
rig.visible = false;
state.mode = "-";

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
  const nrm = new THREE.Vector3(), cy = new THREE.Vector3(), up = new THREE.Vector3(), toCam = new THREE.Vector3(),
    side = new THREE.Vector3(), goal = new THREE.Vector3(), basis = new THREE.Matrix4(), goalQ = new THREE.Quaternion();
  let trackedIndex = -1;
  let tracked = null;
  cards.forEach((c, i) => {
    const anchor = mindar.addAnchor(i);
    anchor.onTargetFound = () => {
      tracked = anchor; trackedIndex = i; state.target = c.slug; showCard(c);
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
      pos.divideScalar(size.x);                       // card centre, card widths
      nrm.set(0, 0, 1).applyQuaternion(rot);          // card face normal
      cy.set(0, 1, 0).applyQuaternion(rot);           // card "up" (top edge of the picture)
      const dims = mindar.controller?.markerDimensions?.[trackedIndex];
      const halfH = dims ? dims[1] / dims[0] / 2 : 0.35;
      const flat = ONCARD;
      state.mode = flat ? "on card" : "above";
      if (flat) { up.copy(nrm); goal.copy(pos).addScaledVector(nrm, 0.01); }
      else {
        // highest point of the card on screen (screen y = y / -z), at the card centre's depth
        const cx = side.set(1, 0, 0).applyQuaternion(rot);
        let top = -Infinity;
        for (const [a, b] of [[0.5, halfH], [-0.5, halfH], [0.5, -halfH], [-0.5, -halfH]]) {
          goal.copy(pos).addScaledVector(cx, a).addScaledVector(cy, b);
          if (goal.z < -1e-3) top = Math.max(top, goal.y / -goal.z);
        }
        const depth = Math.max(0.05, -pos.z);
        goal.copy(pos);
        if (top > -Infinity) goal.y = top * depth;
        goal.y += GAP;
        up.set(0, 1, 0);   // screen up: the model is always seen from the side
      }
      toCam.copy(goal).negate().addScaledVector(up, goal.dot(up));   // towards the camera, level
      if (toCam.lengthSq() < 1e-8) toCam.copy(nrm);
      toCam.normalize(); side.crossVectors(up, toCam).normalize(); toCam.crossVectors(side, up);
      goalQ.setFromRotationMatrix(basis.makeBasis(side, up, toCam));
      if (rig.userData.placed && rig.userData.flat === flat) { rig.position.lerp(goal, 0.35); rig.quaternion.slerp(goalQ, 0.35); }
      else { rig.position.copy(goal); rig.quaternion.copy(goalQ); rig.userData.placed = true; rig.userData.flat = flat; }
      // Rise: grow with an ease-out over RISE_MS, then turn slowly.
      const t = Math.min(1, (performance.now() - riseAt) / RISE_MS), ease = 1 - Math.pow(1 - t, 3);
      const k = Math.max(0.001, (FOOTPRINT / current.r) * ease);
      holder.scale.setScalar(k);
      holder.rotation.x = flat ? 0 : LEAN;
      // leaning tips the front of the ground disc down: lift it so it stays over the edge
      holder.position.set(0, flat ? 0 : current.r * k * Math.sin(LEAN), 0);
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
