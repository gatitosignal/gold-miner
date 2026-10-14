const GOLD_LARGE_REWARD_IDS = new Set(["gold_01", "gold_06"]);

class MineObject {
  constructor(type, x, y, rewardData) {
    const cfg = CONFIG.objects[type];
    const scale = rand(cfg.scale[0], cfg.scale[1]);
    this.type = type;
    this.x = x;
    this.y = y;
    this.baseX = x;
    this.baseY = y;
    this.radius = cfg.radius * scale;
    this.scale = scale;
    this.angle = rand(-0.35, 0.35);
    this.sprite = cfg.sprite;
    this.returnSpeed = cfg.speed;
    this.reward = 1;
    this.alive = true;
    this.attachToHook = false;
    this.rewardData = rewardData;
    this.rewardTriggered = false;
  }

  hit(point) {
    if (!this.alive || this.attachToHook) return false;
    const dx = point.x - this.x;
    const dy = point.y - this.y;
    return Math.hypot(dx, dy) <= this.radius * 1.22 + 18;
  }

  attach(hookAnchor) {
    this.attachToHook = true;
    this.syncToHook(hookAnchor);
  }

  syncToHook(hookAnchor) {
    this.x = hookAnchor.x;
    this.y = hookAnchor.y + CONFIG.hook.grabOffset;
  }

  collect() {
    this.alive = false;
    this.attachToHook = false;
  }

  draw(ctx) {
    if (!this.alive) return;
    const img = Assets.get(this.sprite);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    if (img && img.complete && img.naturalWidth) {
      const ratio = img.naturalHeight / img.naturalWidth;
      const w = this.radius * 2;
      const h = w * ratio;
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      ctx.fillStyle = "#d7a13d";
      ctx.beginPath();
      ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function createMineObjects() {
  if (typeof resetRewardClaims === "function") resetRewardClaims();
  const placed = [];
  const rewards = shuffle(REWARDS.map((reward) => reward));
  for (const reward of rewards) {
    const type = objectTypeForReward(reward);
    const spot = findSpotForReward(reward, type, placed);
    const obj = new MineObject(type, spot.x, spot.y, reward);
    placed.push(obj);
  }
  return placed;
}

function objectTypeForReward(reward) {
  if (reward.itemType === "stone") return "Rock";
  if (reward.itemType === "bomb") return "Bomb";
  if (reward.itemType === "mystery") return "MysteryBag";
  if (reward.itemType === "gold") {
    return GOLD_LARGE_REWARD_IDS.has(reward.id) ? "GoldLarge" : "GoldSmall";
  }
  return "GoldSmall";
}

function findSpotForReward(reward, type, placed) {
  const top = CONFIG.height * CONFIG.topRatio;
  const cfg = CONFIG.objects[type];
  const radius = cfg.radius * 1.12;
  const range = placementRange(reward, top);
  const safe = placementSafeArea(radius, top);
  const minY = Math.max(range.minY, safe.minY);
  const maxY = Math.min(range.maxY, safe.maxY);
  for (let i = 0; i < 220; i += 1) {
    const x = rand(safe.minX, safe.maxX);
    const y = rand(minY, maxY);
    if (isReachable(x, y, radius) && isFarEnough(x, y, radius, placed)) return { x, y };
  }
  return fallbackSpot(type, placed.length, top);
}

function placementRange(reward, top) {
  if (reward.itemType === "mystery") {
    return {
      minY: Math.min(CONFIG.height - 230, top + 610),
      maxY: CONFIG.height - 130,
    };
  }
  if (reward.itemType === "gold") {
    const bands = [
      { minY: top + 120, maxY: top + 300 },
      { minY: top + 310, maxY: top + 540 },
      { minY: top + 560, maxY: CONFIG.height - 150 },
    ];
    const index = Number(reward.id.replace(/\D+/g, "")) || 1;
    return bands[(index - 1) % bands.length];
  }
  if (reward.itemType === "bomb") {
    return { minY: top + 230, maxY: CONFIG.height - 260 };
  }
  return { minY: top + CONFIG.placement.rockTopDepth, maxY: CONFIG.height - 160 };
}

function placementSafeArea(radius, top) {
  const placement = CONFIG.placement;
  const minX = Math.max(radius + 70, placement.safeMarginX);
  const maxX = CONFIG.width - minX;
  return {
    minX,
    maxX,
    minY: top + placement.safeTopDepth,
    maxY: CONFIG.height - placement.bottomMargin,
  };
}

function isReachable(x, y, radius) {
  const base = hookBasePoint();
  const dx = x - base.x;
  const dy = y - base.y;
  if (dy <= CONFIG.hook.minLength * 0.65) return false;
  const angle = Math.abs(Math.atan2(dx, dy));
  const distance = Math.hypot(dx, dy);
  return angle <= CONFIG.hook.swingLimit * 0.92 && distance <= CONFIG.hook.maxLength - radius * 0.45;
}

function hookBasePoint() {
  return {
    x: CONFIG.width / 2 - 26,
    y: Math.round(CONFIG.height * CONFIG.topRatio) - 6,
  };
}

function isFarEnough(x, y, radius, placed) {
  return placed.every((obj) => {
    const minDistance = radius + obj.radius + 36;
    return Math.hypot(x - obj.x, y - obj.y) >= minDistance;
  });
}

function fallbackSpot(type, index, top) {
  const cfg = CONFIG.objects[type];
  const radius = cfg.radius * 1.12;
  const safe = placementSafeArea(radius, top);
  const columns = 5;
  for (let row = 0; row < 5; row += 1) {
    for (let offset = 0; offset < columns; offset += 1) {
      const col = (index + offset) % columns;
      const x = safe.minX + col * ((safe.maxX - safe.minX) / (columns - 1));
      const y = Math.min(safe.maxY, Math.max(safe.minY, top + 210 + row * 135));
      if (isReachable(x, y, radius)) return { x, y };
    }
  }
  return { x: CONFIG.width / 2, y: Math.min(safe.maxY, Math.max(safe.minY, top + 360)) };
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
