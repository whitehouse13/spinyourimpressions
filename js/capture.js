import { canShareFiles } from "./env.js?v=15329fcd4e";

export const STAMP = "@spin.your.impressions · spinyourimpressions.ie";

const stampFont = (fs) => `600 ${fs}px system-ui, -apple-system, sans-serif`;

// Largest font size (from W/30, min 12, shrinking to 6 at worst) whose stamp
// pill — text width + fs padding — fits the photo width minus 12 px margins.
// measure(fs) returns the stamp's text width at that size.
export function stampFontSize(W, measure) {
  let fs = Math.max(12, Math.round(W / 30));
  while (fs > 6 && measure(fs) + fs > W - 24) fs -= 1;
  return fs;
}

// Composite what the user sees: the camera <video> (as MindAR laid it out,
// possibly larger than the container to "cover" it) + the three.js canvas.
// The WebGL canvas is re-rendered right before drawImage, so no
// preserveDrawingBuffer is needed.
export async function capturePhoto({ video, renderer, scene, camera, container }) {
  const cr = container.getBoundingClientRect();
  const W = cr.width, H = cr.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const c = document.createElement("canvas");
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  const vr = video.getBoundingClientRect();
  g.drawImage(video, vr.left - cr.left, vr.top - cr.top, vr.width, vr.height);
  renderer.render(scene, camera);
  g.drawImage(renderer.domElement, 0, 0, W, H);

  const fs = stampFontSize(W, (f) => {
    g.font = stampFont(f);
    return g.measureText(STAMP).width;
  });
  g.font = stampFont(fs);
  const tw = g.measureText(STAMP).width;
  g.fillStyle = "rgba(0,0,0,.45)";
  g.fillRect(12, H - fs * 2 - 12, tw + fs, fs * 2);
  g.fillStyle = "#fff";
  g.fillText(STAMP, 12 + fs / 2, H - 12 - fs * 0.65);

  const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.92));
  if (!blob) throw new Error("capturePhoto: canvas.toBlob produced no blob");
  return new File([blob], "spin-your-impressions.jpg", { type: "image/jpeg" });
}

// Must be called from a fresh user gesture (the preview's Share button):
// iOS Safari rejects navigator.share() after long async work.
export async function sharePhoto(file, nav = navigator) {
  if (canShareFiles(nav, file)) {
    try {
      await nav.share({ files: [file], text: "#SpinYourImpressions @spin.your.impressions" });
      return "shared";
    } catch (e) {
      if (e && e.name === "AbortError") return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return "downloaded";
}
