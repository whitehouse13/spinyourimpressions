// three.js scene for one cup variant. Units: target widths; origin = tracked
// anchor on the cup surface, +z towards the camera, +y up. Angles around the
// cup: theta = 2π·u, measured from +z towards +x (same as CylinderGeometry),
// so the panorama reads left→right from outside.
//
// 2026-09-28 phone test: separate landmark cards read as confusing, so the
// scene is just the panorama ring — it rises out of the rim and spins.
import * as THREE from "three";
import { ease } from "./timeline.js?v=615094819f";

// Direction the ring spins. -1 = clockwise seen from above; the first phone
// test found +1 ran the "wrong way".
const SPIN_DIR = -1;
const RISE = 1.4;        // s, ring grows up out of the rim
const SPIN = 0.22;       // rad/s — slowed 2026-09-30 so captions can be read
const DONE_AT = 4.0;     // s, when the finale buttons appear

export function buildCupScene(sp, variant, tex, { debug = false } = {}) {
  const root = new THREE.Group();
  const cup = new THREE.Group();
  cup.position.set(0, 0, -sp.cupRadius);          // cup axis behind the surface
  root.add(cup);
  const spin = new THREE.Group();                  // turns so the tracked landmark faces us
  cup.add(spin);

  // The ring shows the panorama band twice around (keeps the band low while
  // its proportions stay unstretched), hugging the cup just above the rim.
  const RING_REPEAT = 2;
  const ringR = sp.cupRadius * 1.12;
  const img = tex.ring.image;
  tex.ring.wrapS = THREE.RepeatWrapping;
  tex.ring.repeat.set(RING_REPEAT, 1);
  tex.ring.needsUpdate = true;
  const ringH = img && img.width > 0
    ? 2 * Math.PI * ringR * (img.height / img.width) / RING_REPEAT : sp.cardHeight * 0.7;
  const geo = new THREE.CylinderGeometry(ringR, ringR, ringH, 96, 1, true);
  geo.translate(0, ringH / 2, 0);                  // pivot at the ring's bottom edge
  const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex.ring, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  ring.position.y = sp.rimY + 0.05;
  spin.add(ring);

  if (debug) {
    // ?debug guide: where the scene thinks the cup and the tracked target are.
    const cyl = new THREE.LineSegments(new THREE.EdgesGeometry(
      new THREE.CylinderGeometry(sp.cupRadius, sp.cupRadius, sp.rimY * 2, 24, 1, true)),
      new THREE.LineBasicMaterial({ color: 0x00ff66 }));
    cup.add(cyl);                                   // centred on the target's height, top at the rim
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color: 0xff3366 }));
    root.add(box);                                  // the tracked target, 1×1 target widths
  }

  // Which landmark a ring position shows: the ring wraps the panorama
  // RING_REPEAT times, so ring u → panorama u = frac(u · RING_REPEAT).
  function nearestLandmark(panoU) {
    let best = 0, bestD = Infinity;
    variant.landmarks.forEach((l, i) => {
      const d = Math.min(Math.abs(l.u - panoU), 1 - Math.abs(l.u - panoU));
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }
  const panoAt = (ringU) => (((ringU * RING_REPEAT) % 1) + 1) % 1;

  return {
    root,
    ring,
    cards: [],                                      // no tappable cards any more
    isRisen(t) { return t >= RISE; },
    // Landmark on the side of the ring facing the camera (root is kept upright
    // and camera-facing, so that's the ring's +z side, CylinderGeometry u=0).
    frontIndex() {
      const phi = spin.rotation.y + ring.rotation.y;
      return nearestLandmark(panoAt(((-phi / (2 * Math.PI)) % 1 + 1) % 1));
    },
    landmarkAtUV(uv) { return nearestLandmark(panoAt(uv.x)); },
    setTracked(i) { spin.rotation.y = -2 * Math.PI * variant.landmarks[i].u; },
    setFirst() {},
    isDone(t) { return t >= DONE_AT; },
    update(t) {
      const r = ease(t / RISE);
      ring.scale.set(1, Math.max(r, 0.001), 1);
      ring.material.opacity = r;
      ring.visible = r > 0.001;
      ring.rotation.y = SPIN_DIR * t * SPIN;
    },
  };
}
