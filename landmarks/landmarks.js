// Landmark pages (/landmarks/?l=<slug>, 2026-11-19): the landmark's splat model turning in a
// box (drag to turn), its name and text, links to the others. Opened from «More about it» on
// the cup 3D page. ?full / ?mid / ?lite pick the model quality (Android: mid, like the cup page).
import * as THREE from "three";
import * as GS from "splats";

const params = new URLSearchParams(location.search);
const ANDROID = /Android/i.test(navigator.userAgent);
const QUALITY = params.has("full") ? "full" : params.has("mid") ? "mid" : params.has("lite") ? "lite" : ANDROID ? "mid" : "full";
const $ = (s) => document.querySelector(s);
const status = $("#status");
window.kccLandmark = { load: "-", fps: 0 };

const list = await (await fetch("data/landmarks.json")).json();
const lm = list.find((x) => x.slug === params.get("l")) || list[0];
document.title = `${lm.name} in 3D · Spin Your Impressions`;
$("#name").textContent = lm.name;
$("#where").textContent = `${lm.city} · on cup ${lm.cup}`;
$("#blurb").textContent = lm.blurb;
for (const x of list) {
  const li = document.createElement("li"), a = document.createElement("a");
  a.href = `?l=${x.slug}`; a.textContent = x.name;
  if (x === lm) a.setAttribute("aria-current", "page");
  li.append(a); $("#list").append(li);
}

if (!lm.model) status.textContent = "The 3D model of this landmark is coming soon.";
else {
  const box = $("#view");
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: params.has("test") });
  renderer.setPixelRatio(Math.min(devicePixelRatio, ANDROID ? 1.5 : 2));
  box.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 50);
  // The model's ground disc has radius 1 here; the camera looks at it from a little above.
  camera.position.set(0, 1.35, 3.9);
  camera.lookAt(0, 0.45, 0);
  const viewer = new GS.DropInViewer({
    gpuAcceleratedSort: false, sharedMemoryForWorkers: false, integerBasedSort: true,
    dynamicScene: true, sphericalHarmonicsDegree: 0, logLevel: GS.LogLevel.None,
  });
  const holder = new THREE.Group(), spin = new THREE.Group();
  spin.add(viewer); holder.add(spin); scene.add(holder);
  holder.scale.setScalar((lm.zoom || 1) / lm.r);
  const resize = () => {
    const w = box.clientWidth, h = box.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  addEventListener("resize", resize); resize();

  let userYaw = 0, phase = 0, drag = null;
  box.addEventListener("pointerdown", (e) => { drag = e.clientX; box.setPointerCapture(e.pointerId); });
  box.addEventListener("pointermove", (e) => { if (drag !== null) { userYaw += (e.clientX - drag) * 0.01; drag = e.clientX; } });
  const up = () => { drag = null; };
  box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up);

  const url = QUALITY === "full" ? lm.model : lm.model.replace(".compressed.ply", `-${QUALITY}.compressed.ply`);
  const t0 = performance.now();
  try {
    // This renderer treats +Y as down, so turn the model upright (180° about X) — as on the cup page.
    await viewer.addSplatScene(url, { showLoadingUI: false, splatAlphaRemovalThreshold: 5, rotation: [1, 0, 0, 0] });
    status.hidden = true; $("#tip").hidden = false;
    window.kccLandmark.load = ((performance.now() - t0) / 1000).toFixed(1) + " s";
  } catch (e) { status.textContent = "The 3D model could not load. Please try again later."; }
  let n = 0, tf = performance.now();
  renderer.setAnimationLoop(() => {
    if (drag === null) phase += 0.005;
    // Smithwick's was filmed from the street only: it sways instead of turning all the way round.
    spin.rotation.y = userYaw + (lm.sweep ? Math.sin(phase * 1.5) * lm.sweep * Math.PI / 180 : phase);
    renderer.render(scene, camera);
    if (++n === 30) { const t = performance.now(); window.kccLandmark.fps = Math.round(30000 / (t - tf)); n = 0; tf = t; }
  });
}
