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
  let unlocked = false;

  function getAudio(name) {
    const src = SOUND_EFFECTS[name];
    if (!src) return null;
    if (!sounds[name]) {
      const audio = new Audio(src);
      audio.preload = "auto";
      sounds[name] = audio;
    }
    return sounds[name];
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    for (const name of Object.keys(SOUND_EFFECTS)) {
      const audio = getAudio(name);
      if (!audio) continue;
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
    const audio = getAudio(name);
    if (!audio) return;
    audio.volume = volume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  return { unlock, play };
})();

