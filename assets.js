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

  function load() {
    const jobs = Object.entries(sources).map(([name, src]) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img);
      img.src = src;
      images[name] = img;
    }));
    return Promise.all(jobs);
  }

  function get(name) {
    return images[name];
  }

  return { load, get };
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

