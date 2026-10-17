const Assets = (() => {
  const sources = {
    Miner: "assets/Miner.png",
    MinerLower: "assets/MinerLower.png",
    MinerRaise: "assets/MinerRaise.png",
    Winch: "assets/Winch.png",
    Claw: "assets/Claw.png",
    Rope: "assets/Rope.png",
    GoldSmall: "assets/GoldSmall.png",
    GoldLarge: "assets/GoldLarge.png",
    Rock: "assets/Rock.png",
    Bomb: "assets/Bomb.png",
    MysteryBag: "assets/MysteryBag.png",
    StartButton: "assets/StartButton.png",
    StartScreen: "assets/start-reference.png",
  };

  const images = {};
  const records = {};
  const attempts = 2;
  const NETWORK_TIMEOUT = 8000;
  const DECODE_TIMEOUT = 5000;
  const ASSET_VERSION = "20261017-mobile-render-v2";
  const core = Object.keys(sources);
  let panel = null;
  let loadPromise = null;
  let runtimeInfo = {};

  function load() {
    if (loadPromise) return loadPromise;
    const jobs = Object.entries(sources).map(([name, src]) => loadImage(name, src));
    loadPromise = Promise.all(jobs.map((job) => job.catch((error) => error))).then(() => {
      updateDebugPanel();
      const failedCore = core.filter((name) => !records[name]?.ok);
      if (failedCore.length) {
        console.warn("[Assets] Core images failed:", failedCore.map((name) => records[name]));
      }
      return records;
    });
    return loadPromise;
  }

  function get(name) {
    const image = images[name];
    if (isUsable(image)) return image;
    if (name === "MinerRaise") return firstUsable("Miner", "MinerLower") || image;
    if (name === "MinerLower") return firstUsable("Miner", "MinerRaise") || image;
    return image;
  }

  function peek(name) {
    return images[name];
  }

  function isReady(name) {
    return !!records[name]?.ok && isUsable(images[name]);
  }

  async function loadImage(name, src) {
    for (let index = 0; index < attempts; index += 1) {
      const result = await loadAttempt(name, src, index);
      if (result) return result;
    }
    return null;
  }

  async function loadAttempt(name, src, index) {
    const url = withVersion(src, index);
    const requestUrl = new URL(url, document.baseURI).href;
    const startedAt = performance.now();
    records[name] = {
      name,
      src,
      requestUrl,
      ok: false,
      attempts: index + 1,
      width: 0,
      height: 0,
      phase: "network",
      errorType: "",
      error: "",
      httpStatus: null,
      contentType: "",
      durationMs: 0,
    };
    updateDebugPanel();

    try {
      const response = await fetchWithTimeout(requestUrl, NETWORK_TIMEOUT);
      records[name].httpStatus = response.status;
      records[name].contentType = response.headers.get("content-type") || "";
      if (!response.ok) throw assetError("network", `HTTP ${response.status}`);
      if (records[name].contentType && !records[name].contentType.toLowerCase().startsWith("image/")) {
        throw assetError("decode", `unexpected Content-Type: ${records[name].contentType}`);
      }

      records[name].phase = "download";
      updateDebugPanel();
      const blob = await withTimeout(response.blob(), NETWORK_TIMEOUT, "timeout", "response body timeout");
      if (!blob.size) throw assetError("network", "empty response body");

      records[name].phase = "decode";
      updateDebugPanel();
      const img = await decodeBlob(blob, DECODE_TIMEOUT);
      images[name] = img;
      records[name].ok = true;
      records[name].phase = "ready";
      records[name].width = img.naturalWidth || 0;
      records[name].height = img.naturalHeight || 0;
      records[name].durationMs = Math.round(performance.now() - startedAt);
      updateDebugPanel();
      return img;
    } catch (err) {
      const type = err?.assetType || (err?.name === "AbortError" ? "timeout" : "network");
      records[name].phase = "failed";
      records[name].errorType = type;
      records[name].error = err?.message || String(err);
      records[name].durationMs = Math.round(performance.now() - startedAt);
      console.warn(`[Assets] ${name} ${type} failure`, requestUrl, err);
      updateDebugPanel();
      if (index + 1 < attempts) await delay(180 * (index + 1));
      return null;
    }
  }

  function withVersion(src, index) {
    const separator = src.includes("?") ? "&" : "?";
    return `${src}${separator}v=${encodeURIComponent(ASSET_VERSION)}&try=${index + 1}`;
  }

  async function fetchWithTimeout(url, timeoutMs) {
    if (typeof fetch !== "function") throw assetError("network", "Fetch API unavailable");
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer = null;
    try {
      const request = fetch(url, {
        cache: "default",
        credentials: "same-origin",
        signal: controller?.signal,
      });
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller?.abort();
          reject(assetError("timeout", `network timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      return await Promise.race([request, timeout]);
    } catch (err) {
      if (err?.assetType) throw err;
      if (err?.name === "AbortError") throw assetError("timeout", `network timeout after ${timeoutMs}ms`);
      throw assetError("network", err?.message || "request failed");
    } finally {
      clearTimeout(timer);
    }
  }

  function decodeBlob(blob, timeoutMs) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        if (fn === reject) URL.revokeObjectURL(objectUrl);
        fn(value);
      };
      const timer = setTimeout(() => {
        finish(reject, assetError("timeout", `image decode timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      img.onload = () => {
        if (!img.naturalWidth || !img.naturalHeight) {
          finish(reject, assetError("decode", "decoded image has zero dimensions"));
          return;
        }
        // onload already guarantees a drawable frame. Some mobile WebKit versions
        // leave img.decode() pending, so it must never gate rendering here.
        finish(resolve, img);
      };
      img.onerror = () => finish(reject, assetError("decode", "browser rejected image data"));
      img.src = objectUrl;
    });
  }

  function withTimeout(promise, timeoutMs, type, message) {
    let timer = null;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(assetError(type, message)), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  function assetError(type, message) {
    const error = new Error(message);
    error.assetType = type;
    return error;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isUsable(img) {
    return !!(img && img.complete && img.naturalWidth && img.naturalHeight);
  }

  function firstUsable(...names) {
    for (const name of names) {
      if (isUsable(images[name])) return images[name];
    }
    return null;
  }

  function stats() {
    const list = Object.values(records);
    const loaded = list.filter((item) => item.ok);
    const failed = list.filter((item) => !item.ok && item.error);
    return { total: Object.keys(sources).length, loaded, failed, records };
  }

  function updateDebugPanel() {
    const data = stats();
    const shouldShow = data.failed.length || new URLSearchParams(location.search).has("debug");
    if (!shouldShow) {
      if (panel) panel.hidden = true;
      return;
    }
    if (!panel) {
      panel = document.createElement("aside");
      panel.className = "asset-debug";
      document.body.appendChild(panel);
    }
    panel.hidden = false;
    const rows = Object.values(records)
      .map((item) => {
        const state = item.ok ? "OK" : item.phase === "failed" ? "FAIL" : "WAIT";
        const detail = item.error ? ` [${item.errorType}] ${item.error}` : ` [${item.phase}]`;
        const response = item.httpStatus ? ` HTTP ${item.httpStatus}${item.contentType ? ` ${escapeHtml(item.contentType)}` : ""}` : "";
        return `${state} ${item.name}: ${item.width}x${item.height}${detail}${response}<br><small>${escapeHtml(item.requestUrl || "")}</small>`;
      })
      .join("<br>");
    const runtime = runtimeInfo.canvas
      ? `<br><b>Canvas</b> ${runtimeInfo.canvas} CSS ${runtimeInfo.css || "?"} frame ${runtimeInfo.frames || 0} painted ${runtimeInfo.painted ? "yes" : "no"}${runtimeInfo.error ? `<br><b>Runtime</b> ${escapeHtml(runtimeInfo.error)}` : ""}`
      : "";
    panel.innerHTML = `<b>素材加载</b> ${data.loaded.length}/${data.total}<br>${rows}${runtime}`;
  }

  function setRuntimeInfo(info) {
    runtimeInfo = { ...runtimeInfo, ...info };
    updateDebugPanel();
  }

  function reportRuntimeError(error) {
    const message = error?.stack || error?.message || String(error);
    console.error("[Game runtime]", error);
    setRuntimeInfo({ error: message });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { load, get, peek, isReady, stats, setRuntimeInfo, reportRuntimeError };
})();
const AudioManager = (() => {
  const sounds = {};
  const buffers = {};
  const loadingBuffers = {};
  let context = null;
  let unlocked = false;

  function getAudio(name) {
    const src = SOUND_EFFECTS[name];
    if (!src) return null;
    if (!sounds[name]) {
      const audio = new Audio(src);
      audio.preload = "auto";
      audio.playsInline = true;
      sounds[name] = audio;
    }
    return sounds[name];
  }

  function getContext() {
    if (context) return context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    return context;
  }

  function loadBuffer(name) {
    const ctx = getContext();
    const src = SOUND_EFFECTS[name];
    if (!ctx || !src) return Promise.resolve(null);
    if (buffers[name]) return Promise.resolve(buffers[name]);
    if (loadingBuffers[name]) return loadingBuffers[name];
    loadingBuffers[name] = fetch(src)
      .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error("sound load failed")))
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        buffers[name] = buffer;
        return buffer;
      })
      .catch(() => null);
    return loadingBuffers[name];
  }

  function playBuffer(name, volume) {
    const ctx = getContext();
    const buffer = buffers[name];
    if (!ctx || !buffer || ctx.state !== "running") return false;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
    return true;
  }

  function tapSilentNode() {
    const ctx = getContext();
    if (!ctx) return;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    const ctx = getContext();
    if (ctx) {
      ctx.resume?.().then(tapSilentNode).catch(() => {});
    }
    for (const name of Object.keys(SOUND_EFFECTS)) {
      const audio = getAudio(name);
      if (!audio) continue;
      audio.load?.();
      loadBuffer(name);
      audio.muted = true;
      audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
      }).catch(() => {
        audio.muted = false;
      });
    }
  }

  function play(name, volume = 0.85) {
    if (playBuffer(name, volume)) return;
    loadBuffer(name).then((buffer) => {
      if (buffer) playBuffer(name, volume);
    });
    const audio = getAudio(name);
    if (!audio) return;
    audio.volume = volume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  return { unlock, play };
})();

