const Assets = (() => {
  const sources = {
    Miner: "assets/Miner.png",
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
