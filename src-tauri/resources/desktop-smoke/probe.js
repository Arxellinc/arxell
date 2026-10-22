// CI-only: executed in the real embedded frontend under its packaged CSP.
(() => {
  const invoke = (args) => window.__TAURI_INTERNALS__.invoke("cmd_desktop_smoke_ready", args);
  const emptyChecks = () => ({
    dataImageDecoded: false, blobImageDecoded: false,
    dataAudioLoaded: false, blobAudioLoaded: false,
    dataFetchLoaded: false, blobFetchLoaded: false,
    inlineStyleApplied: false, inlineScriptBlocked: false
  });
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==";
  const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
  function imageDecodes(url) {
    return new Promise((resolve) => {
      const image = new Image();
      const timer = setTimeout(() => finish(false), 3000);
      const finish = (ok) => {
        clearTimeout(timer);
        image.onload = image.onerror = null;
        resolve(ok);
      };
      image.onload = () => finish(image.naturalWidth === 1 && image.naturalHeight === 1);
      image.onerror = () => finish(false);
      image.src = url;
    });
  }
  function audioLoads(url) {
    return new Promise((resolve) => {
      const audio = new Audio();
      const timer = setTimeout(() => finish(false), 3000);
      const finish = (ok) => {
        clearTimeout(timer);
        audio.onloadedmetadata = audio.onerror = null;
        audio.removeAttribute("src");
        audio.load();
        resolve(ok);
      };
      audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0);
      audio.onerror = () => finish(false);
      audio.preload = "metadata";
      audio.src = url;
      audio.load();
    });
  }
  async function fetchLoads(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const body = new Uint8Array(await response.arrayBuffer());
      return response.ok && body.length === bytes.length && body.every((byte, i) => byte === bytes[i]);
    } catch (_) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
  // A tiny PCM WAV needs no remote file, provider, playback, or user gesture.
  const wav = new Uint8Array(124);
  const view = new DataView(wav.buffer);
  const ascii = (offset, text) => [...text].forEach((char, i) => { wav[offset + i] = char.charCodeAt(0); });
  ascii(0, "RIFF"); view.setUint32(4, wav.length - 8, true); ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  ascii(36, "data"); view.setUint32(40, 80, true); wav.fill(128, 44);

  async function probe() {
    const checks = emptyChecks();
    const imageUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    const audioUrl = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    const host = document.createElement("div");
    try {
      // Use an actual innerHTML style attribute, not element.style assignment.
      host.innerHTML = '<div style="width: 42px; height: 1px"></div>';
      document.body.append(host);
      checks.inlineStyleApplied = getComputedStyle(host.firstElementChild).width === "42px";
      const script = document.createElement("script");
      window.__arxellSmokeInlineScriptRan = false;
      script.textContent = "window.__arxellSmokeInlineScriptRan = true";
      host.append(script);
      checks.inlineScriptBlocked = window.__arxellSmokeInlineScriptRan === false;
      delete window.__arxellSmokeInlineScriptRan;
      [checks.dataImageDecoded, checks.blobImageDecoded, checks.dataAudioLoaded, checks.blobAudioLoaded,
        checks.dataFetchLoaded, checks.blobFetchLoaded] = await Promise.all([
        imageDecodes(`data:image/png;base64,${png}`), imageDecodes(imageUrl),
        audioLoads(`data:audio/wav;base64,${btoa(String.fromCharCode(...wav))}`), audioLoads(audioUrl),
        // Image copying and uploaded GLB avatars fetch in-memory sources too.
        fetchLoads(`data:image/png;base64,${png}`), fetchLoads(imageUrl)
      ]);
      const result = await window.__TAURI_INTERNALS__.invoke("cmd_app_version");
      await invoke({ version: result.version, checks });
    } catch (_) {
      await invoke({ version: "probe-failed", checks }).catch(() => {});
    } finally {
      host.remove();
      URL.revokeObjectURL(imageUrl);
      URL.revokeObjectURL(audioUrl);
    }
  }

  let attempts = 0;
  const timer = setInterval(() => {
    const frame = document.querySelector("#app .app-frame");
    const bounds = frame && frame.getBoundingClientRect();
    if (frame && bounds.width > 0 && bounds.height > 0 && getComputedStyle(frame).visibility !== "hidden") {
      clearInterval(timer);
      void probe();
    } else if (++attempts >= 100) {
      clearInterval(timer);
      invoke({ version: "frontend-missing", checks: emptyChecks() }).catch(() => {});
    }
  }, 100);
})();
