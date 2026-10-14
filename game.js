(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = CONFIG.width;
  const H = CONFIG.height;
  const TOP_H = Math.round(H * CONFIG.topRatio);
  const WINCH_EXIT = { x: W / 2 - 26, y: TOP_H - 6 };

  const game = {
    screen: "START",
    hook: new HookSystem(WINCH_EXIT),
    items: [],
    treasure: 0,
    target: CONFIG.target,
    level: CONFIG.level,
    timeLeft: CONFIG.time,
    freePlay: false,
    lastClock: performance.now(),
    flash: 0,
    modal: null,
    startButton: { x: 88, y: 72, w: 500, h: 520 },
  };

  Assets.load().then(() => {
    requestAnimationFrame(frame);
  });

  function startGame() {
    game.screen = "PLAY";
    game.hook = new HookSystem(WINCH_EXIT);
    game.items = createMineObjects();
    game.treasure = 0;
    game.timeLeft = CONFIG.time;
    game.freePlay = false;
    game.lastClock = performance.now();
    game.flash = 0;
    game.modal = null;
    if (typeof SettlementModal !== "undefined") SettlementModal.close();
    if (typeof RewardModal !== "undefined") RewardModal.close(false);
  }

  function pointer(evt) {
    evt.preventDefault();
    AudioManager.unlock();
    const p = pointerPos(evt);
    if (game.screen === "START") {
      const b = game.startButton;
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        startGame();
      }
      return;
    }
    if (game.modal) {
      return;
    }
    if (game.hook.state === "IDLE") AudioManager.play("rope");
    game.hook.shoot();
  }

  function pointerPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const src = evt.touches ? evt.touches[0] : evt;
    return {
      x: ((src.clientX - rect.left) / rect.width) * W,
      y: ((src.clientY - rect.top) / rect.height) * H,
    };
  }

  canvas.addEventListener("pointerdown", pointer);
  canvas.addEventListener("touchstart", pointer, { passive: false });
  window.addEventListener("pointerdown", () => AudioManager.unlock(), { passive: true });
  window.addEventListener("touchstart", () => AudioManager.unlock(), { passive: true });

  function update(dt, now) {
    if (game.screen !== "PLAY") return;
    if (game.modal) {
      game.lastClock = now;
      return;
    }
    if (!game.freePlay && now - game.lastClock >= 1000) {
      game.timeLeft = Math.max(0, game.timeLeft - 1);
      game.lastClock = now;
      if (game.timeLeft <= 0) {
        endGame();
        return;
      }
    }
    if (game.flash > 0) game.flash = Math.max(0, game.flash - dt);
    game.hook.update(dt, game.items, collectItem);
    if (game.freePlay && !game.modal && !hasRemainingItems()) endGame();
  }

  function collectItem(item) {
    playCollectSound(item);
    game.treasure += item.reward;
    item.collect();
    maybeOpenReward(item);
  }

  function playCollectSound(item) {
    const key = rewardKeyFor(item.type);
    if (key) AudioManager.play(key);
  }

  function maybeOpenReward(item) {
    const content = item.rewardData;
    if (!content || item.rewardTriggered || content.claimed) return;
    item.rewardTriggered = true;
    content.claimed = true;
    if (typeof CollectionStore !== "undefined") {
      CollectionStore.add(content.id);
    }
    openRewardModal(content);
  }

  function rewardKeyFor(type) {
    if (type === "GoldSmall" || type === "GoldLarge") return "gold";
    if (type === "Rock") return "rock";
    if (type === "Bomb") return "bomb";
    if (type === "MysteryBag") return "mystery";
    return "";
  }

  function openRewardModal(content) {
    game.modal = { content };
    if (window.RewardModal || typeof RewardModal !== "undefined") {
      RewardModal.open(content, closeRewardModal);
    }
  }

  function closeRewardModal() {
    if (window.RewardModal || typeof RewardModal !== "undefined") {
      RewardModal.close(false);
    }
    game.modal = null;
    game.lastClock = performance.now();
    if (game.screen === "PLAY" && game.freePlay && !hasRemainingItems()) endGame();
    else if (game.screen === "PLAY" && !game.freePlay && game.timeLeft <= 0) endGame();
  }

  function endGame() {
    if (game.screen !== "PLAY") return;
    game.screen = "GAME_OVER";
    game.modal = { type: "settlement" };
    if (typeof SettlementModal !== "undefined") {
      SettlementModal.open({
        score: game.treasure,
        onContinue: continueCurrentGame,
        onOpenReward: openCollectedReward,
      });
    }
  }

  function continueCurrentGame() {
    if (!hasRemainingItems()) {
      startGame();
      return;
    }
    if (typeof SettlementModal !== "undefined") SettlementModal.close();
    game.screen = "PLAY";
    game.modal = null;
    game.hook = new HookSystem(WINCH_EXIT);
    game.freePlay = true;
    game.timeLeft = 0;
    game.lastClock = performance.now();
  }

  function hasRemainingItems() {
    return game.items.some((item) => item.alive);
  }

  function openCollectedReward(reward) {
    game.modal = { type: "collectionReward", content: reward };
    if (typeof RewardModal !== "undefined") {
      RewardModal.open(reward, () => {
        game.modal = { type: "settlement" };
        if (typeof SettlementModal !== "undefined") {
          SettlementModal.open({
            score: game.treasure,
            onContinue: continueCurrentGame,
            onOpenReward: openCollectedReward,
          });
        }
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (game.screen === "START") drawStart();
    else drawGame();
  }

  function drawStart() {
    const cover = Assets.get("StartScreen");
    if (cover && cover.complete && cover.naturalWidth) {
      ctx.drawImage(cover, 0, 0, W, H);
      return;
    }
    drawCaveBackground();
  }

  function drawGame() {
    drawHeader();
    drawMineBackground();
    for (const item of game.items) item.draw(ctx);
    game.hook.draw(ctx);
    drawTopMiner();
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255, 224, 78, ${game.flash * 1.8})`;
      ctx.fillRect(0, TOP_H, W, H - TOP_H);
    }
  }

  function drawHeader() {
    const g = ctx.createLinearGradient(0, 0, 0, TOP_H);
    g.addColorStop(0, "#ffe13a");
    g.addColorStop(1, "#f5ad2d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, TOP_H);
    ctx.fillStyle = "#15100a";
    ctx.fillRect(0, 0, W, 8);
    ctx.fillStyle = "#704315";
    ctx.fillRect(0, TOP_H - 12, W, 8);
    ctx.fillStyle = "#f7d07c";
    ctx.fillRect(0, TOP_H - 20, W, 5);

    hud("宝藏", game.treasure, 54, 70, "#00a838");
    hud("目标", game.target, 54, 132, "#ff5c1b");
    hud("时间:", game.timeLeft, 1240, 70, "#ff5c1b");
    hud("关卡:", game.level, 1240, 132, "#b81b0f");
  }

  function hud(label, value, x, y, color) {
    ctx.font = "900 38px Microsoft YaHei, Arial";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(81, 48, 0, 0.35)";
    ctx.fillStyle = "#705004";
    ctx.strokeText(label, x, y);
    ctx.fillText(label, x, y);
    ctx.fillStyle = color;
    ctx.strokeText(String(value), x + 108, y);
    ctx.fillText(String(value), x + 108, y);
  }

  function drawTopMiner() {
    const group = minerGroupLayout();
    ctx.save();
    ctx.beginPath();
    ctx.arc(group.backdropX, group.backdropY, group.backdropRadius, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = "#183a9e";
    ctx.fill();

    const frame = topMinerFrame();
    if (frame && frame.complete && frame.naturalWidth) {
      const drawW = group.width;
      const drawH = drawW * (frame.naturalHeight / frame.naturalWidth);
      ctx.drawImage(frame, group.x, group.y, drawW, drawH);
    }
    ctx.restore();
  }

  function minerGroupLayout() {
    const width = 276;
    const frame = topMinerFrame();
    const ratio = frame && frame.naturalWidth ? frame.naturalHeight / frame.naturalWidth : 0.79;
    const height = width * ratio;
    const bottom = TOP_H - 10;
    return {
      width,
      height,
      x: W / 2 - width / 2 - 8,
      y: bottom - height,
      backdropX: W / 2,
      backdropY: TOP_H - 18,
      backdropRadius: 125,
    };
  }

  function topMinerFrame() {
    if (game.hook.state === "SHOOT") return Assets.get("MinerLower");
    if (game.hook.state === "RETURN" || game.hook.state === "GRAB") return Assets.get("MinerRaise");
    return Assets.get("MinerRaise");
  }

  function drawCaveBackground() {
    const bg = ctx.createRadialGradient(W * 0.58, H * 0.44, 80, W * 0.5, H * 0.48, 820);
    bg.addColorStop(0, "#6a4a1b");
    bg.addColorStop(0.45, "#21150b");
    bg.addColorStop(1, "#020100");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(0, 0, W, H);
    drawTunnelLines(0, 1);
  }

  function drawMineBackground() {
    const earth = ctx.createLinearGradient(0, TOP_H, W, H);
    earth.addColorStop(0, "#d98d2e");
    earth.addColorStop(0.34, "#95501d");
    earth.addColorStop(0.74, "#c97924");
    earth.addColorStop(1, "#6c3617");
    ctx.fillStyle = earth;
    ctx.fillRect(0, TOP_H, W, H - TOP_H);
    drawSandWave(TOP_H + 214, "#f4c57c", -50, 0.7);
    drawSandWave(842, "#efbd73", 130, 0.54);
    drawTunnelLines(TOP_H, 0.36);
  }

  function drawSandWave(y, color, phase, amp) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 24) {
      ctx.lineTo(x, y + Math.sin((x + phase) / 96) * 24 * amp + Math.sin(x / 44) * 9 * amp);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,232,181,0.74)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawTunnelLines(top, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#d69a55";
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i += 1) {
      const y = top + 245 + i * 145;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 38) {
        const yy = y + Math.sin(x / 130 + i) * 19;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt, now);
    draw();
    requestAnimationFrame(frame);
  }
})();












