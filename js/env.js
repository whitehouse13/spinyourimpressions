// Environment checks, kept pure (arguments instead of globals) so they run under node --test.
const IN_APP = /Instagram|FBAN|FBAV|musical_ly|BytedanceWebview|TikTok/i;

export function isInAppBrowser(ua) {
  return IN_APP.test(ua || "");
}

export function hasCamera(nav) {
  return !!(nav && nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === "function");
}

export function hasWebGL(doc) {
  try {
    const c = doc.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    // Release the probe context now: browsers cap live WebGL contexts (~16) and
    // MindAR/three create their own right after this check.
    if (gl) gl.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch (_) {
    return false;
  }
}

export function canShareFiles(nav, file) {
  try {
    return !!(nav && typeof nav.canShare === "function" && nav.canShare({ files: [file] }));
  } catch (_) {
    return false;
  }
}
