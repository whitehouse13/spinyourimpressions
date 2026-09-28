// MindAR 1.2.5 creates its camera <video> with setAttribute("autoplay"/"muted")
// and then waits for "loadedmetadata" without ever calling play(). iOS Safari
// (seen on iOS 18.7, Safari 27) doesn't honour those attributes set this way,
// so the video never starts and mindar.start() hangs forever on
// "Loading the city…". Watch the container for MindAR's video, set the real
// properties and call play() ourselves; if iOS still refuses (e.g. Low Power
// Mode blocks autoplay), hand a play() callback to onNeedTap so it can run
// from a user gesture.
export function kickCameraVideo(container, { onNeedTap, log = () => {} }) {
  let timer = null;
  const watch = (video) => {
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    timer = setInterval(() => {
      if (!video.srcObject) return;
      clearInterval(timer);
      video.play().then(
        () => log("video.play() ok"),
        (err) => {
          log("video.play() refused: " + err.name);
          onNeedTap(() => video.play());
        });
    }, 100);
  };
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.tagName === "VIDEO") { obs.disconnect(); watch(n); return; }
      }
    }
  });
  obs.observe(container, { childList: true });
  return () => { obs.disconnect(); clearInterval(timer); };
}
