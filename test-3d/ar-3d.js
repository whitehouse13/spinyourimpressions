// Test only, not part of the live site: drone splat model above the cup.
// A target with a model in MODELS shows it; any other target hides it, so
// turning the cup switches models. ?nocam=1 skips the camera and just spins
// the model, to measure load time and frame rate.
import * as THREE from "three";
import * as GS from "splats";
import { MindARThree } from "mindar-image-three";
import { findWindowSpan } from "./window-span.js";
import { solveConePose, poseFromMindAR, rimInCamera, TW_CM, RIM } from "./cone-pose.js?v=13c";

// Round crops the shape of the cup, glare above the buildings cut off
// (2026-11-03); ?old=1 brings back the square building crop.
const OLD = new URLSearchParams(location.search).has("old");
const CANICE = OLD
  ? { name: "St Canice's (square)", url: "data/st-canice-building.splat", scale: 1.2, lift: 0.8 }
  : { name: "St Canice's", url: "data/st-canice-cup.compressed.ply", r: 0.41, scale: 2.0, lift: 1.5, dx: -0.15, grow: 1.21 };
const MODELS = {
  // 12v (iPhone 12u video 2026-11-19): on cup B MindAR's anchor sits ~1.3 cm higher on the cup than on
  // cup A (red dot), so with one rimY the B models floated ~1.4 cm higher (St Mary's ~2.7 cm, castle ~2 cm
  // vs St Kieran's / St Canice's ~1 cm). B_DY lowers every cup-B model; ?bdy=<target widths>.
  // Panorama A, left to right: Butter Slip (A:0), St Kieran's College (A:1),
  // St Canice's Cathedral with the Round Tower (A:2) — names fixed 2026-11-09.
  // 13c grow (iPhone 13a video 19.11: "all but St Mary's look small"): every building is already
  // ~1.5 r wide, but St Mary's stands 1.26 r tall and the low ones only 0.3-0.55 r (measured in the
  // .ply), so they read small. grow = (St Mary's area / own area)^(1/4) -> about the rim's width.
  // ?nogrow turns it off.
  "kilkenny-A:1": { name: "St Kieran's College", url: "data/st-kierans-cup.compressed.ply", up: 0.1, r: 0.53, scale: 1.5, lift: 1.5, dx: 0.12, grow: 1.37 },
  "kilkenny-A:2": CANICE,
  "kilkenny-B:1": OLD
    ? { name: "St Mary's (old)", url: "data/st-marys.compressed.ply", scale: 0.9, lift: 0.6 }
    : { name: "St Mary's", url: "data/st-marys-cup.compressed.ply", r: 0.34, scale: 1.9, lift: 1.5 },
  // 2026-11-04 shoot. Smithwick's was filmed from the street only: it sways
  // ±sweep degrees around its facade instead of turning all the way round.
  "kilkenny-B:0": { name: "Smithwick's", url: "data/smithwicks-cup.compressed.ply", r: 0.21, scale: 1.6, lift: 1.5, sweep: 40 },
  "kilkenny-B:2": { name: "Kilkenny Castle", url: "data/kilkenny-castle-cup.compressed.ply", up: 0.1, r: 0.48, scale: 1.9, lift: 1.5, dx: 0.22, grow: 1.33 },
};
const params = new URLSearchParams(location.search);
for (const [k, m] of Object.entries(MODELS)) m.cupB = k.startsWith("kilkenny-B");
const B_DY = params.has("bdy") ? parseFloat(params.get("bdy")) : -0.15;
const TILT = params.has("tilt") ? parseFloat(params.get("tilt")) : 0.5;
const TUNE = params.has("tune");
// 12r (2026-11-18, café meetings next day): the main site links here, so the status line and the
// diagnostic dots show only with ?debug (or ?tune).
const DEBUG = params.has("debug") || TUNE;
// Per-platform tuning (2026-11-14): auto-fit is tuned on Android first; iPhone keeps
// the 12e placement until its own test. ?fit / ?nofit force it either way.
const ANDROID = /Android/i.test(navigator.userAgent);
// 12s (iPhone screenshots 2026-11-18: every model at a different height / side): the Android
// tuning (12m-12q) now runs on every phone; ?nolean / ?nofit / ?roll / ?shift / ?dx=0 turn parts off.
const LEAN = !params.has("nolean");
// 12t (iPhone video 2026-11-19: size jumped as fit swung 0.66 <-> 0.94): auto-fit is off by default,
// every model has one fixed footprint instead (FOOT); ?fit turns auto-fit back on.
const FIT = params.has("fit");
const QUALITY = params.has("full") ? "full" : params.has("mid") ? "mid" : params.has("lite") ? "lite" : ANDROID ? "mid" : "full";   // 2026-11-14: user picked mid for Android
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
const SCALE_X = 1.2;
const DX_K = params.has("dx") ? parseFloat(params.get("dx")) : 1;
const DX_ON = DX_K !== 0;
let SCENE = null;           // manifest.scene: rimY, cupRadius
let fitK = 1;               // < 1 when the model would go past the top of the screen
// 12s/12t: one clear height for every model — front edge ~0.6 cm over the rim (12t) (1 target width ≈ 6.5 cm on the cup:
// cupRadius 0.604 ↔ ~3.9 cm); no per-model `up`, no fit scaling. ?gap=<factor> scales it.
const GAP = 0.062 * (params.has("gap") ? parseFloat(params.get("gap")) : 1);
// 12s: lean at least this much towards the viewer (user: "tilt a bit towards me"); ?minlean=<rad>.
// 13d (user phone test 2026-11-20: more lean shows the model, not its underside): 0.12/0.16 -> 0.2/0.28.
const MIN_LEAN = params.has("minlean") ? parseFloat(params.get("minlean")) : 0.2;   // 12t: 0.2 -> 0.12, the lean lifted the back of the disc ~1 cm
// 12t: one size for every model — ground-disc radius FOOT target widths (0.8 ≈ 5.2 cm, i.e. ~10 cm across,
// a little wider than the 9 cm rim); before, footprints ran 10-14 cm (scale × r per model). ?foot=<tw>.
const FOOT = params.has("foot") ? parseFloat(params.get("foot")) : 0.72;   // 12u: 0.8 -> 0.72 (≈ the rim, 9.4 cm across), the disc overhung the rim towards the camera
// 12u (iPhone 12t video 2026-11-19: St Mary's at eye level leaned 14° and floated ~2.5 cm, the castle
// ~1.7 cm): the lean is capped so it no longer lifts the model when the phone is low; ?maxlean=<rad>.
const MAX_LEAN = params.has("maxlean") ? parseFloat(params.get("maxlean")) : 0.28;
const place = () => {
  if (!current) return;
  const k = (current.r ? FOOT / current.r : current.scale * SCALE_X) * sizeX * fitK;   // fitK: auto-fit to the screen top (12f); SCALE_X: phone test 2026-11-12, models looked small next to the cup
  holder.scale.setScalar(k);
  if (SCENE && current.r) {
    // Phone test 2026-11-12 (with gravity): models floated 3.5-10 cm above the rim;
    // half the tilt dip and no per-model `up` give ~1.5-2 cm.
    // 12t: the models' ground is at y≈0 (measured in the .ply: 1st percentile −0.01..−0.04 model units),
    // so the old +0.06·k (~0.9 cm) only lifted them; dip = how far the front edge of the leaning disc
    // drops, so that front edge clears the rim by GAP (~0.6 cm).
    const dip = current.r * k * Math.max(0, Math.sin(holder.rotation.x)) + 0.02 * k;   // 12u: 0.03 -> 0.02
    // up = extra height for wide models (phone test 2026-11-11: castle/college looked
    // like they sat on the rim, St Mary's looked right).
    // dx (12q, Android 12p video 2026-11-18): MindAR's anchor is the landmark, which sits off the
    // window centre by a fixed amount per landmark (the inner layer turns to fixed stops): castle
    // ~0.22 target widths left, St Kieran's 0.12 left, St Canice's 0.15 right. Android only
    // (iPhone untouched until its own test); ?dx=<factor> scales it, ?dx=0 turns it off.
    holder.position.set(DX_ON ? (current.dx || 0) * DX_K : 0, SCENE.rimY + GAP * LIFT_X + dip + (current.cupB ? B_DY : 0), -SCENE.cupRadius);  // up: wide models (castle, college) sat on the rim 2026-11-12
  } else holder.position.set(0, current.lift * LIFT_X, 0);
};
// Gravity (phone test 2026-11-11: looking down at the cup, "up" followed the
// phone, so the model slid onto the rim). The cup stands upright, so take "up"
// from the phone's orientation: up in device/camera axes (x right, y up,
// z out of the screen) = (-sinγ·cosβ, sinβ, cosγ·cosβ), then undo screen rotation.
const gravityUp = new THREE.Vector3(0, 1, 0);
const NOROLL = !new URLSearchParams(location.search).has("roll");
let rawRoll = 0;
let hasGravity = false;
const _g = new THREE.Vector3();
addEventListener("deviceorientation", (e) => {
  if (e.beta == null || e.gamma == null) return;
  const b = THREE.MathUtils.degToRad(e.beta), g = THREE.MathUtils.degToRad(e.gamma);
  _g.set(-Math.sin(g) * Math.cos(b), Math.sin(b), Math.cos(g) * Math.cos(b));
  const a = THREE.MathUtils.degToRad(screen.orientation?.angle || 0);
  const x = _g.x * Math.cos(a) + _g.y * Math.sin(a), y = -_g.x * Math.sin(a) + _g.y * Math.cos(a);
  _g.set(x, y, _g.z).normalize();
  rawRoll = _g.x;
  // 12o (Android 12n dots: the model base sat ~0.1 screen right of the landmark every time):
  // drop the sideways (roll) part of "up" on Android — near upright the Euler angles lose the
  // roll anyway; ?roll keeps it. The HUD shows the raw value (roll) to confirm the cause.
  if (NOROLL) _g.setX(0).normalize();
  if (!hasGravity) { gravityUp.copy(_g); hasGravity = true; } else gravityUp.lerp(_g, 0.2).normalize();
});
async function askMotion() {   // iOS: must be called from the tap on Start
  try { if (typeof DeviceOrientationEvent?.requestPermission === "function") await DeviceOrientationEvent.requestPermission(); } catch {}
}
const BUILD = "13e";   // shown in the HUD so the phone test shows which build is live
const hud = document.getElementById("hud");
if (!DEBUG) hud.style.display = "none";
const btn = document.getElementById("start");
const nocam = new URLSearchParams(location.search).has("nocam");
const state = { target: "-", model: "-", load: "-", fps: 0, autospin: true, shift: 0 };
// 12m (Android video 2026-11-18: models sometimes sat beside the cup): the HUD shows the
// sideways window shift; ?noshift turns it off to compare.
// 12n (Android video 2026-11-18, 12m): shift jumped between the ±0.45 clamps, so it is off on
// Android by default (?shift turns it back on). Dots: red = where MindAR sees the landmark,
// green = where the model base is drawn (?nodots hides them) — tells tracking from placement.
const NOSHIFT = !params.has("shift");
const DOTS = DEBUG && !params.has("nodots");   // 12r: dots/HUD only with ?debug (user: remove them when done)
const mkDot = (c) => { const d = document.createElement("div"); d.style.cssText = `position:fixed;z-index:7;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:${c};border:2px solid #fff;display:none;pointer-events:none`; document.body.append(d); return d; };
const dotA = DOTS ? mkDot("#e33") : null, dotM = DOTS ? mkDot("#2c4") : null;
const putDot = (d, v) => { if (!d) return; if (!v) { d.style.display = "none"; return; } d.style.display = "block"; d.style.left = ((v.x + 1) / 2 * innerWidth) + "px"; d.style.top = ((1 - v.y) / 2 * innerHeight) + "px"; };
const _dv = new THREE.Vector3();
// 12x depth fix (iPhone 12w video 19.11): on the curved cup MindAR trades distance for tilt —
// at eye level from ~30 cm it put the cup up to ~1.5x too close, so the rim offset projected
// bigger and St Mary's floated 2-3 cm instead of ~0.5. The target's vertical extent on screen
// is undistorted by the curve (the cup wall is straight vertically), so take the distance
// from it: D = f * h * cos(elev) / screen height.
// 12y: OFF by default (opt-in ?depth) — on the phone (12x video 19.11) the factor swung 0.6-1.8:
// ~1.5 at eye level, 0.6 looking down at the cup in hand (model huge, far above), so it did not
// measure the real distance.
const DEPTH = params.has("depth");
const _da = new THREE.Vector3(), _db = new THREE.Vector3();
let depthK = 1;
// 13a (2026-11-19, replay of the iPhone reference videos IMG_9041/9042 on the Mac): the cup pose now
// comes from MindAR's tracked points fitted to the cup's real cone (cone-pose.js), not from MindAR's
// flat-picture guess. On those videos the old placement put the model's front edge -0.8..+8 cm over
// the rim and up to 1.9 cm to the side; the cone fit keeps it 0.6-0.9 cm over the rim, on the axis.
// The rig stands on the sleeve-top circle, "up" = the cup's own axis (also right when the cup is held
// tilted), so gravity, dx, B_DY, shift and depth are not used. ?flat = the old 12y placement.
// VFOV = the camera's field of view across the long side of the picture (iPhone 1x camera ≈ 71.6°;
// MindAR itself assumes 45°); the replay showed ±20 % here moves the model only ±0.3 cm. ?fov=<deg>.
const FLAT = params.has("flat");
const VFOV = params.has("fov") ? parseFloat(params.get("fov")) : 71.6;
const RIM_UP = 0.3 / TW_CM;    // the paper rim stands ~3 mm above the sleeve top (reference video frames)
const CONE_GAP = (params.has("cgap") ? parseFloat(params.get("cgap")) : 0.7) / TW_CM;   // front edge of the model's ground over the rim, cm
const cone = { pose: null, target: -1, at: 0, err: 0, n: 0, k: 1 };
window.kccCone = cone;
const show = () => {
  const tilt = Math.round(holder.rotation.x * 180 / Math.PI);
  hud.textContent = `target ${state.target} · model ${state.model} · load ${state.load} · ${state.fps} fps · tilt ${tilt}° · size ${sizeX.toFixed(2)} · fit ${FIT ? fitK.toFixed(2) : "off"} · ${ANDROID ? "android" : "ios"}${QUALITY === "full" ? "" : " " + QUALITY} · ${params.has("nogravity") ? "gravity OFF" : hasGravity ? "gravity" : "no gravity"} · roll ${rawRoll.toFixed(2)}${NOROLL ? " cut" : ""} · dx ${DX_ON ? (current?.dx || 0).toFixed(2) : "off"} · shift ${NOSHIFT ? "off" : state.shift.toFixed(2)} · dk ${DEPTH ? depthK.toFixed(2) : "off"} · ${FLAT ? "flat" : `cone ${cone.pose ? cone.err.toFixed(1) + "px/" + cone.n : "-"} fov ${VFOV}`} · cam ${CAM ?? "auto"} ${camInfo.label} /${camInfo.backs} ${camInfo.w}x${camInfo.h} stall ${camInfo.stalls}${camInfo.longest ? "/" + camInfo.longest.toFixed(1) + "s" : ""} mute ${camInfo.mutes} · build ${BUILD}`;
};
window.kcc3d = state;
// 13b (2026-11-19, user: in 3D they saw neither the name nor a sentence): a caption with the
// landmark's name and blurb (data/cities.json) and a "More about it" link to its page on the site
// (/landmarks/?l=<slug>). It stays 1.5 s after the target is lost so it doesn't flicker.
const SLUGS = {
  "kilkenny-A:0": "butter-slip", "kilkenny-A:1": "st-kierans", "kilkenny-A:2": "st-canice",
  "kilkenny-B:0": "smithwicks", "kilkenny-B:1": "st-marys", "kilkenny-B:2": "kilkenny-castle",
};
const NOCARD = params.has("nocard");
const card = document.getElementById("card");
let cardKey = null, cardHide = 0;
function showCard(key, lm) {
  clearTimeout(cardHide);
  if (NOCARD || !lm) return;
  if (cardKey !== key) {
    cardKey = key;
    card.querySelector("h2").textContent = lm.name;
    card.querySelector("p").textContent = lm.blurb;
    const a = card.querySelector("a");
    a.hidden = !SLUGS[key];
    a.href = `../landmarks/?l=${SLUGS[key] || ""}`;
  }
  card.classList.add("on");
}
function hideCardSoon() {
  clearTimeout(cardHide);
  cardHide = setTimeout(() => card.classList.remove("on"), 1500);
}
window.addEventListener("error", (e) => { hud.style.display = "block"; hud.textContent = "ERROR " + e.message; });

const viewer = new GS.DropInViewer({
  gpuAcceleratedSort: false, sharedMemoryForWorkers: false, integerBasedSort: true,
  dynamicScene: true, sphericalHarmonicsDegree: 0, logLevel: GS.LogLevel.None,
});
const holder = new THREE.Group(), spin = new THREE.Group();
spin.add(viewer); holder.add(spin);
holder.visible = false;
holder.rotation.x = TILT;   // the model floats above eye level: lean it towards the viewer

// Finger control: drag left/right = turn (up/down = tilt only with ?tune), two-finger pinch =
// size, double tap = auto-spin on/off. The HUD shows tilt and size.
let drag = null, lastTap = 0, pinch = null;
const touchGap = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
addEventListener("touchstart", (e) => {
  if (TUNE && e.touches.length === 2) { pinch = { d: touchGap(e.touches), s: sizeX }; drag = null; }
}, { passive: true });
addEventListener("touchmove", (e) => {
  if (pinch && e.touches.length === 2) {
    sizeX = Math.min(4, Math.max(0.3, pinch.s * touchGap(e.touches) / pinch.d)); place(); show();
  }
}, { passive: true });
addEventListener("touchend", (e) => { if (e.touches.length < 2) pinch = null; });
addEventListener("pointerdown", (e) => {
  if (e.target.id === "start" || e.target.closest?.("#card") || pinch) return;
  const now = performance.now();
  // 12h: double tap / pinch only with ?tune — a stray pinch (size 1.23) counted as a
  // double tap and stopped the spin on iPhone (2026-11-14).
  if (TUNE && now - lastTap < 300) state.autospin = !state.autospin;
  lastTap = now;
  drag = { x: e.clientX, y: e.clientY };
});
addEventListener("pointermove", (e) => {
  if (!drag || pinch) return;
  userYaw += (e.clientX - drag.x) * 0.01;
  // Tilt by finger only with ?tune: on iPhone a stray vertical swipe (Control
  // Centre / screen recording, 2026-11-14) pushed tilt to the 92° limit and the
  // models showed from straight above.
  if (TUNE) holder.rotation.x = Math.min(1.6, Math.max(-0.3, holder.rotation.x + (e.clientY - drag.y) * 0.005));
  drag = { x: e.clientX, y: e.clientY }; place(); show();
});
addEventListener("pointerup", () => { drag = null; });
addEventListener("pointercancel", () => { drag = null; });

async function loadModel(m) {
  const t0 = performance.now();
  state.load = "…"; show();
  if (viewer.getSceneCount() > 0) await viewer.removeSplatScene(0, false);
  current = m; userYaw = 0; phase = 0; place();
  // Android (2026-11-14, 9-21 fps with the model on screen): lighter copies made with
  // splat-transform --decimate-adaptive (SH 0): lite ~120k, mid ~200k splats.
  // ?lite / ?mid / ?full pick one on any phone.
  const url = QUALITY === "full" ? m.url : m.url.replace(".compressed.ply", `-${QUALITY}.compressed.ply`);
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

// 13e (Android screen video 20.11, 13d): the camera picture went black twice for 4-7 s right after a
// fast move, while the page kept drawing (fps 15-21) — the camera stream itself stalled. MindAR asks
// only for "facingMode: environment", so on a phone with several back lenses the browser may switch
// lenses on its own. Diagnosis in the HUD (?debug): cam = chosen back camera / all back cameras,
// picture size, stall = how many times the picture froze > 0.5 s (and the longest, s), mute = how
// many times the browser muted the track. ?cam=N opens back camera N (0-based, in the browser's list).
const CAM = params.has("cam") ? parseInt(params.get("cam"), 10) : null;
const camInfo = { label: "-", backs: 0, w: 0, h: 0, stalls: 0, longest: 0, mutes: 0 };
window.kccCam = camInfo;
async function pickBackCamera() {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  let devs = await navigator.mediaDevices.enumerateDevices();
  if (CAM !== null && devs.every((d) => !d.label)) {   // labels appear only after camera permission
    try { const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); s.getTracks().forEach((t) => t.stop()); } catch {}
    devs = await navigator.mediaDevices.enumerateDevices();
  }
  const vids = devs.filter((d) => d.kind === "videoinput");
  const backs = vids.filter((d) => /back|rear|environment|задн/i.test(d.label));
  camInfo.backs = backs.length || vids.length;
  if (CAM === null) return null;
  const list = backs.length ? backs : vids;
  return list[Math.max(0, Math.min(list.length - 1, CAM))]?.deviceId || null;
}
function watchCamera(video) {
  const tr = video.srcObject?.getVideoTracks?.()[0];
  if (tr) {
    camInfo.label = (tr.label || "?").replace(/,? facing back/i, "").slice(0, 18);
    tr.addEventListener("mute", () => { camInfo.mutes++; });
  }
  navigator.mediaDevices.enumerateDevices().then((ds) => {   // labels are known now
    const v = ds.filter((d) => d.kind === "videoinput"), b = v.filter((d) => /back|rear|environment|задн/i.test(d.label));
    camInfo.backs = b.length || v.length;
  }).catch(() => {});
  let last = -1, since = performance.now(), frozen = false;
  setInterval(() => {
    const now = performance.now(), ct = video.currentTime;
    camInfo.w = video.videoWidth; camInfo.h = video.videoHeight;
    if (ct !== last) { if (frozen) camInfo.longest = Math.max(camInfo.longest, (now - since) / 1000); last = ct; since = now; frozen = false; }
    else if (!frozen && now - since > 500) { frozen = true; camInfo.stalls++; }
    else if (frozen) camInfo.longest = Math.max(camInfo.longest, (now - since) / 1000);
  }, 100);
}

async function startAR() {
  btn.remove();
  const envId = await pickBackCamera().catch(() => null);
  const manifest = await (await fetch("data/cities.json")).json();
  SCENE = manifest.scene;
  const mindar = new MindARThree({
    container: document.getElementById("stage"), imageTargetSrc: "data/targets.mind", maxTrack: 1,
    uiLoading: "no", uiScanning: "no", uiError: "no",
    filterMinCF: 0.0001, filterBeta: 0.001, missTolerance: 20,
  });
  if (envId) mindar.environmentDeviceId = envId;   // 13e ?cam=N
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
  const base = new THREE.Vector3(), top = new THREE.Vector3();
  const toCam = new THREE.Vector3(), side = new THREE.Vector3(), basis = new THREE.Matrix4(), rigQ = new THREE.Quaternion();
  const coneUp = new THREE.Vector3(0, 1, 0);
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
    anchor.kccIndex = i;
    const key = `${tg.variant}:${tg.landmark}`;
    anchor.onTargetFound = async () => {
      state.target = key;
      showCard(key, manifest.variants.find((v) => v.id === tg.variant)?.landmarks[tg.landmark]);
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
      state.target = "lost"; holder.visible = false; hideCardSoon(); show();
    };
  });
  await mindar.start();
  try { watchCamera(mindar.video); } catch {}
  // 13a: take MindAR's per-frame point matches (target px <-> camera px) and fit the cone to them.
  const ctrl = mindar.controller;
  if (!FLAT && ctrl?.tracker) {
    const track = ctrl.tracker.track.bind(ctrl.tracker);
    ctrl.tracker.track = (inputT, mvt, ti) => {
      const r = track(inputT, mvt, ti);
      try {
        if (r.worldCoords.length >= 6) {
          const P = ctrl.projectionTransform, fm = P[0][0];
          const f = Math.max(ctrl.inputWidth, ctrl.inputHeight) / 2 / Math.tan(VFOV * Math.PI / 360);
          const now = performance.now();
          const init = cone.pose && cone.target === ti && now - cone.at < 300 ? cone.pose : poseFromMindAR(mvt, fm, f);
          const p = solveConePose(r.worldCoords, r.screenCoords, { f, cx: P[0][2], cy: P[1][2] }, init);
          if (p && p.err < 4) Object.assign(cone, { pose: p, target: ti, at: now, err: p.err, n: p.n, k: f / fm });
        }
      } catch (e) { console.warn("cone pose", e); }
      return r;
    };
  }
  show();
  const draw = renderer.render.bind(renderer);
  let n = 0, t0 = performance.now();
  renderer.setAnimationLoop(() => {
    renderer.clear();
    draw(scene, camera);
    turn();
    const coneOK = !FLAT && tracked && tracked.group.visible && cone.pose && cone.target === tracked.kccIndex && performance.now() - cone.at < 500;
    if (coneOK) {
      // 13a: rig = sleeve-top centre, oriented by the cup's axis and the direction to the camera.
      const { C, up: u } = rimInCamera(cone.pose);
      const goal = pos.set(C[0], -C[1], -C[2]).divideScalar(TW_CM);   // CV camera (cm) -> three.js camera (tw)
      const upC = _da.set(u[0], -u[1], -u[2]).normalize();
      if (rig.userData.placed) {
        const jump = rig.position.distanceTo(goal) / Math.max(0.5, goal.length() * 0.1);
        rig.position.lerp(goal, Math.min(0.5, 0.15 + 0.3 * jump * jump));
        coneUp.lerp(upC, 0.25).normalize();
      } else { rig.position.copy(goal); coneUp.copy(upC); rig.userData.placed = true; }
      toCam.copy(rig.position).negate().addScaledVector(coneUp, rig.position.dot(coneUp));
      if (toCam.lengthSq() > 1e-6) {
        toCam.normalize(); side.crossVectors(coneUp, toCam);
        basis.makeBasis(side, coneUp, toCam); rig.quaternion.setFromRotationMatrix(basis);
      }
      if (LEAN && !TUNE) {
        const elev = Math.asin(Math.max(-1, Math.min(1, -_db.copy(rig.position).normalize().dot(coneUp))));
        holder.rotation.x += (Math.max(MIN_LEAN, Math.min(MAX_LEAN, TILT, TILT - elev)) - holder.rotation.x) * 0.1;
      }
      if (current) {
        const k = (current.r ? FOOT / current.r : current.scale * SCALE_X) * sizeX * (params.has("nogrow") ? 1 : current.grow || 1);
        holder.scale.setScalar(k);
        const dip = current.r ? current.r * k * Math.max(0, Math.sin(holder.rotation.x)) + 0.02 * k : 0;
        holder.position.set(0, RIM_UP + CONE_GAP + dip, 0);
      }
      splatCamera.projectionMatrix.copy(camera.projectionMatrix);
      splatCamera.projectionMatrix.elements[0] *= cone.k;   // true focal (MindAR draws with its 45° one)
      splatCamera.projectionMatrix.elements[5] *= cone.k;
      splatCamera.projectionMatrix.elements[10] = -100.01 / 99.99;
      splatCamera.projectionMatrix.elements[14] = -2 / 99.99;
      splatCamera.projectionMatrixInverse.copy(splatCamera.projectionMatrix).invert();
      rig.updateMatrixWorld(true);
      if (DOTS) {   // red = rim point nearest the camera (cone fit), green = front edge of the model's ground
        _dv.copy(toCam).multiplyScalar(RIM.r / TW_CM).add(rig.position).addScaledVector(coneUp, RIM_UP);
        putDot(dotA, _dv.project(splatCamera));
        const fr = current?.r ? current.r * holder.scale.x : FOOT;   // front edge of the (grown) ground disc
        _dv.set(0, -fr * Math.sin(holder.rotation.x), fr * Math.cos(holder.rotation.x)).add(holder.position).applyMatrix4(rig.matrixWorld);
        putDot(dotM, _dv.project(splatCamera));
      }
      draw(splatScene, splatCamera);
    } else if (FLAT && tracked && tracked.group.visible) {
      tracked.group.updateWorldMatrix(true, false);
      tracked.group.matrixWorld.decompose(pos, rot, size);
      putDot(dotA, _dv.copy(pos).project(camera));
      const now = performance.now();
      if (!NOSHIFT && now - fix.at >= 150) {
        fix.at = now;
        const dx = windowShift(pos, size.x);
        // Clamp (2026-11-12): the white gate flap beside the cup fooled the edge
        // search; the window centre can't be more than ~half a window from the landmark.
        if (dx !== null) { fix.goal = Math.max(-0.45, Math.min(0.45, dx)); fix.good = now; } else if (now - fix.good > 1000) fix.goal = 0;
      }
      fix.dx += (fix.goal - fix.dx) * 0.2;
      state.shift = fix.dx;
      pos.x += fix.dx;
      if (DEPTH) {
        const g = tracked.group.matrixWorld, cw = stage.clientWidth, ch = stage.clientHeight;
        _da.set(0, 0.25, 0).applyMatrix4(g).project(camera);
        _db.set(0, -0.25, 0).applyMatrix4(g).project(camera);
        const pxH = Math.hypot((_da.x - _db.x) * cw / 2, (_da.y - _db.y) * ch / 2);
        const fpx = (ch / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
        const dEst = pos.length() / size.x;
        const sinE = hasGravity ? Math.max(-1, Math.min(1, -_dv.copy(pos).normalize().dot(gravityUp))) : 0;
        if (pxH > 4 && dEst > 0) {
          const k = Math.max(0.6, Math.min(1.8, fpx * 0.5 * Math.sqrt(1 - sinE * sinE) / pxH / dEst));
          depthK += (k - depthK) * 0.15;
        }
        pos.multiplyScalar(depthK);
      }
      const goal = pos.divideScalar(size.x);
      // Adaptive smoothing (phone test 2026-11-12, build 12c: models jumped even with the
      // cup and phone still). Small jumps = tracking noise → follow slowly; big moves → fast.
      if (rig.userData.placed) {
        const jump = rig.position.distanceTo(goal) / Math.max(0.5, goal.length() * 0.1);
        rig.position.lerp(goal, Math.min(0.35, 0.04 + 0.3 * jump * jump));
      } else { rig.position.copy(goal); rig.userData.placed = true; }
      if (hasGravity && !params.has("nogravity")) {
        const up = gravityUp;
        toCam.copy(rig.position).negate().addScaledVector(up, rig.position.dot(up)); // horizontal, cup -> camera
        if (toCam.lengthSq() > 1e-6) {
          toCam.normalize(); side.crossVectors(up, toCam);
          basis.makeBasis(side, up, toCam); rigQ.setFromRotationMatrix(basis);
          rig.quaternion.slerp(rigQ, 0.08);
        }
      } else rig.quaternion.identity();
      // Adaptive lean (Android, 12l): the model leans TILT towards the viewer so it reads
      // from eye level; looking down at the cup it showed from straight above (St Mary's in
      // hand, 2026-11-14). Lean less by the camera's height angle over the cup.
      if (LEAN && hasGravity && !TUNE) {
        const elev = Math.asin(Math.max(-1, Math.min(1, -rig.position.clone().normalize().dot(gravityUp))));
        const want = Math.max(MIN_LEAN, Math.min(MAX_LEAN, TILT, TILT - elev));
        if (Math.abs(want - holder.rotation.x) > 0.01) { holder.rotation.x += (want - holder.rotation.x) * 0.1; place(); }
      }
      splatCamera.projectionMatrix.copy(camera.projectionMatrix);
      // MindAR's near plane is 10, past the shrunk model; use near 0.01, far 100.
      splatCamera.projectionMatrix.elements[10] = -100.01 / 99.99;
      splatCamera.projectionMatrix.elements[14] = -2 / 99.99;
      splatCamera.projectionMatrixInverse.copy(splatCamera.projectionMatrix).invert();
      // Auto-fit (phone test 2026-11-14, Android): with the cup close to the camera the
      // model sat above the top of the screen and the phone had to be tilted a lot.
      // Project the model's base and top; if the top passes 85 % of the screen height,
      // shrink the model (it stays on the rim) so it fits; grow back when there is room.
      if (SCENE && current?.r && FIT) {
        // 12g (iPhone stayed at fit 1.00 while the model was cut off): check the whole
        // ground-disc rim and the roof line, not only the centre — looking down at the
        // cup, the back edge of the tilted disc is what reaches the screen top.
        rig.updateMatrixWorld(true);
        base.copy(holder.position).applyMatrix4(rig.matrixWorld).project(splatCamera);
        let topY = -Infinity;
        const r = current.r;
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          top.set(Math.cos(a) * r, 0, Math.sin(a) * r);   // ground-disc rim; holder space = model units, +Y up
          holder.localToWorld(top).project(splatCamera);
          if (top.y > topY) topY = top.y;
        }
        top.set(0, 0.9 * r, 0); holder.localToWorld(top).project(splatCamera);   // roof over the centre
        if (top.y > topY) topY = top.y;
        const room = 0.92 - base.y, need = topY - base.y;   // 12h: 12g (0.85, min 0.45) shrank to the minimum almost always
        let want = fitK;
        if (need > 1e-3) want = Math.max(0.6, Math.min(1, fitK * room / need));
        // 12p (Android 2026-11-18: St Mary's, the tallest model, "jumped" most — fit swung
        // 0.61 <-> 0.99 every second): ignore small changes and follow slowly.
        if (Math.abs(want - fitK) > 0.06) { fitK += (want - fitK) * 0.04; place(); }
      }
      rig.updateMatrixWorld(true);
      putDot(dotM, _dv.copy(holder.position).applyMatrix4(rig.matrixWorld).project(splatCamera));
      draw(splatScene, splatCamera);
    } else { putDot(dotA, null); putDot(dotM, null); }
    if (++n === 30) {
      const t = performance.now();
      state.fps = Math.round(30000 / (t - t0)); n = 0; t0 = t; show();
    }
  });
}

show();
btn.onclick = () => askMotion().then(() => (nocam ? startNoCam() : startAR())).catch((e) => { hud.style.display = "block"; hud.textContent = "ERROR " + e.message; });
if (nocam) btn.click();
