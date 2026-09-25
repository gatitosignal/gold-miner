class MineObject {
  constructor(type, x, y) {
    const cfg = CONFIG.objects[type];
    const scale = rand(cfg.scale[0], cfg.scale[1]);
    this.type = type;
    this.sprite = cfg.sprite;
    this.reward = cfg.reward;
    this.radius = cfg.radius * scale;
    this.returnSpeed = cfg.speed;
    this.weight = cfg.weight;
    this.x = x;
    this.y = y;
    this.rotation = rand(-0.22, 0.22);
    this.scale = scale;
    this.alive = true;
    this.attachToHook = false;
    this.offset = CONFIG.hook.grabOffset;
  }

  hit(point) {
    if (!this.alive || this.attachToHook) return false;
    return Math.hypot(point.x - this.x, point.y - this.y) <= this.radius;
  }

  attach(hookAnchor) {
    this.attachToHook = true;
    this.syncToHook(hookAnchor);
  }

  syncToHook(hookAnchor) {
    this.x = hookAnchor.x;
    this.y = hookAnchor.y + this.offset;
  }

  collect() {
    this.alive = false;
    this.attachToHook = false;
  }

  draw(ctx) {
    if (!this.alive) return;
    const img = Assets.get(this.sprite);
    if (!img || !img.complete || !img.naturalWidth) return;
    const base = Math.max(img.naturalWidth, img.naturalHeight);
    const drawScale = (this.radius * 2) / base;
    const w = img.naturalWidth * drawScale;
    const h = img.naturalHeight * drawScale;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

function createMineObjects() {
  const defs = [
    ["GoldSmall", 288, 338], ["GoldSmall", 1114, 338], ["GoldSmall", 474, 502],
    ["GoldSmall", 678, 516], ["GoldSmall", 916, 474], ["GoldSmall", 488, 684],
    ["GoldSmall", 840, 640], ["GoldSmall", 762, 768], ["GoldLarge", 130, 610],
    ["GoldLarge", 1278, 644], ["Rock", 292, 572], ["Rock", 1182, 420],
    ["Rock", 1044, 696], ["Rock", 604, 922], ["Bomb", 524, 588],
    ["Bomb", 1056, 590], ["MysteryBag", 490, 922],
  ];
  return defs.map(([type, x, y]) => new MineObject(type, x + rand(-18, 18), y + rand(-12, 18)));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}
