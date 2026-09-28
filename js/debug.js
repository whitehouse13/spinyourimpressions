// On-screen startup log for diagnosing phones without a remote debugger.
// Active only with ?debug in the URL; a classic (non-module) script so it
// still reports when the ES module graph fails to load.
(function () {
  if (!/[?&]debug\b/.test(location.search)) return;
  var t0 = performance.now();
  var box = document.createElement("pre");
  box.style.cssText = "position:fixed;left:0;right:0;top:0;max-height:45vh;overflow:auto;" +
    "margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,Menlo,monospace;color:#0f0;" +
    "background:rgba(0,0,0,.8);z-index:99;white-space:pre-wrap;pointer-events:auto";
  function log(msg) {
    var line = ((performance.now() - t0) / 1000).toFixed(1) + "s " + msg;
    box.textContent += line + "\n";
    box.scrollTop = box.scrollHeight;
  }
  window.kccDebug = log;
  document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(box); });
  log("UA " + navigator.userAgent);
  log("secure=" + window.isSecureContext + " mediaDevices=" + !!navigator.mediaDevices +
      " importmap=" + !!(HTMLScriptElement.supports && HTMLScriptElement.supports("importmap")));

  window.addEventListener("error", function (e) {
    log("ERROR " + (e.message || e.type) + (e.filename ? " @" + e.filename.split("/").pop() + ":" + e.lineno : "") +
        (e.target && e.target.src ? " src=" + e.target.src : ""));
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    log("REJECT " + (e.reason && (e.reason.stack || e.reason.message) || e.reason));
  });
  ["error", "warn"].forEach(function (k) {
    var orig = console[k];
    console[k] = function () {
      log(k.toUpperCase() + " " + Array.prototype.map.call(arguments, String).join(" ").slice(0, 300));
      return orig.apply(console, arguments);
    };
  });

  var origFetch = window.fetch;
  window.fetch = function (input) {
    var url = String(input && input.url || input).split("/").slice(-2).join("/");
    log("fetch → " + url);
    return origFetch.apply(this, arguments).then(function (r) {
      log("fetch ← " + url + " " + r.status + " len=" + r.headers.get("content-length"));
      return r;
    }, function (err) { log("fetch ✗ " + url + " " + err); throw err; });
  };

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    var gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (c) {
      log("getUserMedia " + JSON.stringify(c));
      return gum(c).then(function (s) {
        var t = s.getVideoTracks()[0], st = t && t.getSettings ? t.getSettings() : {};
        log("camera ok " + st.width + "x" + st.height);
        return s;
      }, function (err) { log("camera ✗ " + err.name + ": " + err.message); throw err; });
    };
  }

  ["loadedmetadata", "playing", "pause", "stalled", "error"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (e.target && e.target.tagName === "VIDEO") log("video " + ev + " " + e.target.videoWidth + "x" + e.target.videoHeight);
    }, true);
  });

  var seen = {};
  setInterval(function () {
    ["loading", "scanning", "picker", "nocam", "inapp", "loading-city", "lost"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var vis = !el.hidden;
      if (seen[id] !== vis) { seen[id] = vis; log("#" + id + (vis ? " shown" : " hidden")); }
    });
    if (window.kccAR && !seen.ar) { seen.ar = true; log("app ready (mindar.start resolved)"); }
  }, 250);
})();
