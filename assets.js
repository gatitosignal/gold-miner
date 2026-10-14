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
  const attempts = 3;
  const core = Object.keys(sources);
  let panel = null;

  function load() {
    const jobs = Object.entries(sources).map(([name, src]) => loadImage(name, src));
    return Promise.all(jobs).then(() => {
      updateDebugPanel();
      const failedCore = core.filter((name) => !records[name]?.ok);
      if (failedCore.length) {
        console.warn("[Assets] Core images failed:", failedCore.map((name) => records[name]));
      }
      return records;
    });
  }

  function get(name) {
    return images[name];
  }

  function loadImage(name, src, index = 0) {
    const url = withVersion(src, index);
    records[name] = {
      name,
      src,
      url,
      ok: false,
      attempts: index + 1,
      width: 0,
      height: 0,
      error: "",
    };
    updateDebugPanel();

    return new Promise((resolve) => {
      const img = new Image();
      images[name] = img;
      const retry = (reason) => {
        records[name].error = reason;
        console.warn(`[Assets] ${name} failed (${reason})`, url);
        if (index + 1 < attempts) {
          setTimeout(() => resolve(loadImage(name, src, index + 1)), 160 * (index + 1));
        } else {
          updateDebugPanel();
          resolve(img);
        }
      };

      img.onload = () => {
        const decoded = typeof img.decode === "function"
          ? img.decode().catch((err) => Promise.reject(err))
          : Promise.resolve();
        decoded.then(() => {
          records[name] = {
            name,
            src,
            url,
            ok: !!img.naturalWidth,
            attempts: index + 1,
            width: img.naturalWidth || 0,
            height: img.naturalHeight || 0,
            error: img.naturalWidth ? "" : "decoded-empty-image",
          };
          updateDebugPanel();
          if (!img.naturalWidth) retry("decoded-empty-image");
          else resolve(img);
        }).catch((err) => retry(`decode: ${err?.message || err || "unknown"}`));
      };
      img.onerror = () => retry("network-or-decode-error");
      img.src = url;
    });
  }

  function withVersion(src, index) {
    return src;
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
      .map((item) => `${item.ok ? "OK" : "FAIL"} ${item.name}: ${item.width}x${item.height}${item.error ? ` ${item.error}` : ""}`)
      .join("<br>");
    panel.innerHTML = `<b>素材加载</b> ${data.loaded.length}/${data.total}<br>${rows}`;
  }

  return { load, get, stats };
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

