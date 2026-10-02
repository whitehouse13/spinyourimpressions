import { canShareFiles } from "./env.js?v=393fd2bbe5";

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

// Greedy word wrap: split text into lines no wider than maxWidth, where
// measure(str) returns a string's rendered width. A single word longer than
// maxWidth gets its own line rather than being cut.
export function wrapLines(text, maxWidth, measure) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// The on-screen landmark caption, drawn the same way into the photo: a dark
// rounded card at the top with the name in bold and the fact below it.
function drawCaption(g, W, { name, blurb }) {
  const m = 10, pad = 12;
  const fs = Math.max(11, Math.round(W / 30));
  const maxW = W - 2 * m - 2 * pad;
  g.font = `400 ${fs}px system-ui, -apple-system, sans-serif`;
  const lines = wrapLines(blurb, maxW, (s) => g.measureText(s).width);
  const lh = Math.round(fs * 1.35);
  const h = pad * 2 + Math.round(fs * 1.15) + 4 + lines.length * lh;
  g.fillStyle = "rgba(0,0,0,.5)";
  g.beginPath();
  if (g.roundRect) g.roundRect(m, m, W - 2 * m, h, 12); else g.rect(m, m, W - 2 * m, h);
  g.fill();
  g.fillStyle = "#fff";
  g.textBaseline = "top";
  g.font = `700 ${Math.round(fs * 1.1)}px system-ui, -apple-system, sans-serif`;
  g.fillText(name, m + pad, m + pad);
  g.font = `400 ${fs}px system-ui, -apple-system, sans-serif`;
  lines.forEach((ln, i) => g.fillText(ln, m + pad, m + pad + Math.round(fs * 1.15) + 4 + i * lh));
  g.textBaseline = "alphabetic";
}

// Composite what the user sees: the camera <video> (as MindAR laid it out,
// possibly larger than the container to "cover" it) + the three.js canvas.
// The WebGL canvas is re-rendered right before drawImage, so no
// preserveDrawingBuffer is needed.
export async function capturePhoto({ video, renderer, scene, camera, container, caption = null }) {
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
  if (caption) drawCaption(g, W, caption);

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
