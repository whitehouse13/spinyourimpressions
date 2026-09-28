// three.js scene for one cup variant. Units: target widths; origin = tracked
// anchor on the cup surface, +z towards the camera, +y up. Angles around the
// cup: theta = 2π·u, measured from +z towards +x (same as CylinderGeometry),
// so the panorama reads left→right from outside.
import * as THREE from "three";
import { timeline, orderFrom, ease } from "./timeline.js?v=96a885b366";

export function buildCupScene(sp, variant, tex) {
  const root = new THREE.Group();
  const cup = new THREE.Group();
  cup.position.set(0, 0, -sp.cupRadius);          // cup axis behind the surface
  root.add(cup);
  const spin = new THREE.Group();                  // turns so the tracked landmark faces us
  cup.add(spin);
  const orbit = new THREE.Group();
  spin.add(orbit);

  const cw = sp.cardWidth * 0.8, ch = sp.cardHeight * 0.8;
  const geo = new THREE.PlaneGeometry(cw, ch);
  geo.translate(0, ch / 2, 0);                     // pivot at the card's bottom edge
  const cards = variant.landmarks.map((lm, i) => {
    const holder = new THREE.Group();
    holder.rotation.y = 2 * Math.PI * lm.u;
    orbit.add(holder);
    const mat = new THREE.MeshBasicMaterial({
      map: tex.cards[i], transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, sp.rimY, sp.cupRadius * 1.05);
    m.userData.index = i;
    holder.add(m);
    return m;
  });

  // The ring texture is the whole panorama band, wrapped once around the ring:
  // size its height from the texture's aspect so it isn't stretched sideways.
  const ringR = sp.cupRadius * 1.35;
  const img = tex.ring.image;
  const ringH = img && img.width > 0 ? 2 * Math.PI * ringR * (img.height / img.width) : ch * 0.9;
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(ringR, ringR, ringH, 96, 1, true),
    new THREE.MeshBasicMaterial({ map: tex.ring, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false }));
  ring.position.y = sp.rimY + ringH / 2 + 0.05;
  ring.visible = false;
  spin.add(ring);

  let first = 0;
  return {
    root, cards,
    setTracked(i) { spin.rotation.y = -2 * Math.PI * variant.landmarks[i].u; },
    setFirst(i) { first = i; },
    isDone(t) { return timeline(t, cards.length).done; },
    update(t) {
      const s = timeline(t, cards.length);
      orderFrom(cards.length, first).forEach((idx, k) => {
        const m = cards[idx];
        const r = s.rise[k] * (1 - s.merge);
        m.visible = r > 0.001;
        m.scale.set(1, Math.max(r, 0.001), 1);
        m.material.opacity = r;
        m.position.z = sp.cupRadius * (1.05 + 0.45 * ease(s.orbitT));
      });
      orbit.rotation.y = s.orbitAngle;
      ring.visible = s.merge > 0;
      ring.material.opacity = s.merge;
      ring.rotation.y = s.orbitAngle + s.ringSpin;   // pick up where the cards' orbit left off
    },
  };
}
