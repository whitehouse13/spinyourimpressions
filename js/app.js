import * as THREE from "three";
import { MindARThree } from "mindar-image-three";
import { isInAppBrowser, hasCamera, hasWebGL } from "./env.js?v=dc80648b1c";
import { SceneClock } from "./timeline.js?v=dc80648b1c";
import { buildCupScene } from "./scene.js?v=dc80648b1c";
import { capturePhoto, sharePhoto } from "./capture.js?v=dc80648b1c";
import { kickCameraVideo } from "./camera-kick.js?v=dc80648b1c";

// Tells ar.html's inline watchdog that the module graph loaded (CDN reachable,
// import maps supported); failures after this point are handled by main().catch.
window.kccBoot = true;

// People who come from social media without a cup can still try the scene,
// but people with a cup shouldn't be interrupted: after a while only a small
// "No cup?" link appears; the full picker opens when it's tapped.
const NO_CUP_LINK_AFTER_MS = 12000;
const $ = (id) => document.getElementById(id);
const setHidden = (id, h) => { $(id).hidden = h; };
// Build version from our own module URL (js/app.js?v=<hex hash>, stamped by
// build-ar-site.py into ar.html and the ./x.js?v= imports) — appended to data
// URLs so a redeploy never mixes a fresh page with stale cached data. Unbuilt
// source carries the unstamped placeholder, which isn't hex → no versioning.
const VERSION = ((v) => (/^[0-9a-f]+$/.test(v || "") ? v : null))(
  new URL(import.meta.url).searchParams.get("v"));
const versioned = (url) => (VERSION ? `${url}?v=${VERSION}` : url);

async function main() {
  setHidden("loading", true);
  setHidden("nocam", true);   // in case ar.html's watchdog fired on a very slow network
  if (isInAppBrowser(navigator.userAgent)) return setHidden("inapp", false);
  if (!hasCamera(navigator) || !hasWebGL(document)) return setHidden("nocam", false);
  setHidden("loading", false);

  const res = await fetch(versioned("data/cities.json"));
  if (!res.ok) throw new Error(`data/cities.json: HTTP ${res.status}`);
  const manifest = await res.json();
  const mindar = new MindARThree({
    container: $("stage"), imageTargetSrc: versioned("data/targets.mind"), maxTrack: 1,
    uiLoading: "no", uiScanning: "no", uiError: "no",
    // Steadier pose on a hand-held curved cup (phone test showed heavy
    // jitter and lost/found flicker): stronger One-Euro smoothing, and ride
    // out short tracking drop-outs instead of pausing on every missed frame.
    filterMinCF: 0.0001, filterBeta: 0.001, missTolerance: 20,
  });
  const { renderer, scene, camera } = mindar;
  kickCameraVideo($("stage"), {
    log: (m) => window.kccDebug?.(m),
    onNeedTap: (play) => {
      const btn = $("tap-start");
      btn.hidden = false;
      btn.onclick = () => { btn.hidden = true; play().catch((e) => { console.error(e); btn.hidden = false; }); };
    },
  });
  const loader = new THREE.TextureLoader();
  const load = (url) => new Promise((res, rej) => loader.load(versioned(url), (t) => {
    t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, rej));

  const clock = new SceneClock();
  const cache = new Map();           // id -> Promise<{v, cup}>, in-flight or settled
  let active = null;                 // {v, cup}
  let pickerTimer = null;
  const hintTimers = {};
  const flashError = (id, ms = 2500) => {
    clearTimeout(hintTimers[id]);
    setHidden(id, false);
    hintTimers[id] = setTimeout(() => setHidden(id, true), ms);
  };

  // "Loading the city…" while a variant's textures (~2 MB) download. Counted,
  // because several anchors / a picker tap can be waiting at once.
  let loadingCity = 0;
  async function withCityLoading(promise) {
    if (loadingCity++ === 0) { setHidden("scanning", true); setHidden("loading-city", false); }
    try {
      return await promise;
    } finally {
      if (--loadingCity === 0) {
        setHidden("loading-city", true);
        if (!active) setHidden("scanning", false);
      }
    }
  }

  // Cache the *promise*, set synchronously, so concurrent detections of the same
  // variant (several anchors per variant) share one load and one scene — otherwise
  // the later one would look like a different entry and restart the clock.
  function entryFor(id) {
    if (!cache.has(id)) {
      const p = (async () => {
        const v = manifest.variants.find((x) => x.id === id);
        const tex = { ring: await load(v.ring) };   // ring-only scene since 2026-09-28
        return { v, cup: buildCupScene(manifest.scene, v, tex, { debug: !!window.kccDebug }) };
      })();
      cache.set(id, p);
      p.catch(() => { if (cache.get(id) === p) cache.delete(id); });  // failed load: allow retry
    }
    return cache.get(id);
  }

  function start(entry, firstLandmark) {
    if (active && active !== entry) active.cup.root.removeFromParent();
    active = entry;
    entry.cup.setFirst(firstLandmark);
    clock.reset();
    clock.running = true;
    setHidden("scanning", true);
    setHidden("picker", true);
    setHidden("no-cup", true);
    setHidden("hud-buttons", false);
  }

  // Hand-held cups lose tracking for a moment all the time (phone test
  // 2026-09-30: lost/found every 1–8 s). Only pause and nag after a real loss.
  const LOST_HINT_AFTER_MS = 1500;
  let lostTimer = null;

  // Tracked placement takes only the cup's POSITION from MindAR; the ring stays
  // upright to the screen. Phone test 2026-09-30: MindAR's rotation for our
  // strongly curved target tilted/shifted and jittered the ring, while the
  // untracked picker mode (no rotation) looked level. Smoothed, and kept in
  // place through short tracking losses instead of vanishing.
  const FOLLOW_SMOOTH = 0.25;
  const follow = new THREE.Group();
  follow.visible = false;
  scene.add(follow);
  let trackedAnchor = null;
  let placed = false;
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  function updateFollow() {
    if (!trackedAnchor || !trackedAnchor.group.visible) return;
    trackedAnchor.group.updateMatrixWorld(true);
    trackedAnchor.group.matrixWorld.decompose(_p, _q, _s);
    if (!placed) {
      follow.position.copy(_p);
      follow.scale.setScalar(_s.x);
      placed = true;
    } else {
      follow.position.lerp(_p, FOLLOW_SMOOTH);
      follow.scale.setScalar(follow.scale.x + (_s.x - follow.scale.x) * FOLLOW_SMOOTH);
    }
    follow.visible = true;
  }

  manifest.targets.forEach((tg, i) => {
    const anchor = mindar.addAnchor(i);
    anchor.onTargetFound = async () => {
      clearTimeout(pickerTimer);
      clearTimeout(lostTimer);
      let entry;
      try {
        entry = await withCityLoading(entryFor(tg.variant));
      } catch (err) {
        console.error(err);
        return flashError("load-error", 4000);   // next detection retries the load
      }
      if (active !== entry) start(entry, tg.landmark);
      if (trackedAnchor !== anchor) placed = false;  // snap to a newly found landmark
      trackedAnchor = anchor;                       // follow whichever landmark is in the window
      follow.add(entry.cup.root);
      entry.cup.setTracked(tg.landmark);
      // The target may have been lost while the textures loaded — onTargetLost
      // then fired before root was parented here and did nothing. Use the
      // anchor's real state instead of assuming it's still in view.
      clock.running = anchor.visible;
      setHidden("lost", anchor.visible);
    };
    anchor.onTargetLost = () => {
      if (!(active && trackedAnchor === anchor)) return;
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (anchor.visible) return;
        clock.running = false;
        follow.visible = false;
        setHidden("lost", false);
      }, LOST_HINT_AFTER_MS);
    };
  });

  // Untracked fallback: the scene floats in front of the camera.
  // MindAR's camera works in target *pixels* (near ≈ 10, far ≈ 1e5) — anchors are
  // scaled by the target's pixel width — so express the fallback in "target widths"
  // by scaling the group, otherwise it sits inside the near plane and is clipped.
  const FREE_UNIT = 100;
  const free = new THREE.Group();
  free.scale.setScalar(FREE_UNIT);
  free.position.set(0, -1.6 * FREE_UNIT, -4 * FREE_UNIT);   // cards+ring span y ≈ 1.1…2.3
  scene.add(free);

  function openPicker() {
    const list = $("picker-list");
    list.replaceChildren(...manifest.variants.map((v) => {
      const b = document.createElement("button");
      b.className = "btn primary";
      b.textContent = `${v.city} — ${v.title || v.variant}`;
      const sub = document.createElement("small");
      sub.style.cssText = "display:block;font-weight:400;opacity:.7;margin-top:2px";
      sub.textContent = v.landmarks.map((l) => l.name).join(" · ");
      b.appendChild(sub);
      b.onclick = async () => {
        if (b.disabled) return;
        b.disabled = true;
        try {
          const entry = await withCityLoading(entryFor(v.id));
          start(entry, 0);
          entry.cup.setTracked(0);
          trackedAnchor = null;
          free.add(entry.cup.root);
        } catch (err) {
          console.error(err);
          flashError("load-error", 4000);
        } finally {
          b.disabled = false;
        }
      };
      return b;
    }));
    setHidden("picker", false);
  }
  $("picker-retry").onclick = () => setHidden("picker", true);
  $("no-cup").onclick = () => { setHidden("no-cup", true); openPicker(); };

  // Tap a card → name + blurb.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  // Listen on the stage, not the canvas: MindAR stacks its CSS3DRenderer <div> on
  // top of the WebGL canvas, which swallows pointer events aimed at the canvas.
  $("stage").addEventListener("pointerdown", (e) => {
    if (!active) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(active.cup.cards.filter((c) => c.visible))[0];
    if (!hit) return setHidden("info", true);
    const lm = active.v.landmarks[hit.object.userData.index];
    $("info-name").textContent = lm.name;
    $("info-blurb").textContent = lm.blurb;
    setHidden("info", false);
  });

  $("replay-btn").onclick = () => { clock.reset(); clock.running = true; };

  let photo = null;
  let previewURL = null;
  $("photo-btn").onclick = async () => {
    const btn = $("photo-btn");
    if (btn.disabled) return;               // re-entrancy guard: ignore rapid double-clicks
    btn.disabled = true;
    try {
      photo = await capturePhoto({ video: mindar.video, renderer, scene, camera, container: $("stage") });
      if (previewURL) URL.revokeObjectURL(previewURL);   // drop the previous preview's URL, if any
      previewURL = URL.createObjectURL(photo);
      $("preview-img").src = previewURL;
      setHidden("preview", false);
    } catch (err) {
      console.error(err);
      flashError("photo-error");
    } finally {
      btn.disabled = false;
    }
  };
  $("share-btn").onclick = async () => {
    if (!photo) return;
    try {
      await sharePhoto(photo);
    } catch (err) {
      console.error(err);
      flashError("photo-error");
    }
  };
  $("preview-close").onclick = () => {
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = null;
    setHidden("preview", true);
  };

  // mindar.start() downloads data/targets.mind before asking for the camera.
  $("loading").querySelector("p").textContent = "Loading the city…";
  try {
    window.kccDebug?.("mindar.start() …");
    await mindar.start();
    window.kccDebug?.("mindar.start() done");
  } catch (err) {
    console.error(err);
    setHidden("loading", true);
    return setHidden("nocam", false);
  }
  setHidden("loading", true);
  setHidden("scanning", false);
  pickerTimer = setTimeout(() => { if (!active) setHidden("no-cup", false); }, NO_CUP_LINK_AFTER_MS);

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    clock.tick((now - last) / 1000);
    last = now;
    updateFollow();
    if (active) {
      active.cup.update(clock.t);
      setHidden("finale", !active.cup.isDone(clock.t));
    }
    renderer.render(scene, camera);
  });

  window.kccAR = { mindar, clock, active: () => active };
}

main().catch((err) => {
  // Anything outside mindar.start()'s own handler (manifest fetch, MindAR
  // constructor, …): never leave the visitor on the loading panel.
  console.error(err);
  setHidden("loading", true);
  setHidden("nocam", false);
});
