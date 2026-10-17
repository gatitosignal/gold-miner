(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = CONFIG.width;
  const H = CONFIG.height;
  if (!ctx) throw new Error("Canvas 2D context is unavailable");
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
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
    startButton: { x: 75, y: 45, w: 510, h: 515 },
  };
  let last = performance.now();
  let frames = 0;
  let lastTelemetry = 0;

  // Rendering starts immediately. Asset completion is an enhancement, never a gate.
  requestAnimationFrame(frame);
  Promise.resolve(Assets.load()).catch((error) => Assets.reportRuntimeError(error));

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
      if (!Assets.progress().complete) return;
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

  if (window.PointerEvent) {
    canvas.addEventListener("pointerdown", pointer, { passive: false });
  } else {
    let lastTouchAt = 0;
    canvas.addEventListener("touchstart", (event) => {
      lastTouchAt = performance.now();
      pointer(event);
    }, { passive: false });
    canvas.addEventListener("mousedown", (event) => {
      if (performance.now() - lastTouchAt > 700) pointer(event);
    });
  }

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
    const cover = Assets.peek("StartScreen");
    if (Assets.isReady("StartScreen") && cover) {
      game.startButton = { x: 75, y: 45, w: 510, h: 515 };
      ctx.drawImage(cover, 0, 0, W, H);
      drawLoadingProgress();
      return;
    }
    drawCaveBackground();
    drawStartFallback();
    drawLoadingProgress();
  }

  function drawStartFallback() {
    const b = { x: 86, y: 650, w: 520, h: 183 };
    game.startButton = b;
    const gold = Assets.get("GoldLarge") || Assets.get("GoldSmall");
    const miner = Assets.get("Miner");
    if (gold && gold.complete && gold.naturalWidth) {
      ctx.save();
      ctx.shadowColor = "rgba(255, 224, 0, 0.65)";
      ctx.shadowBlur = 48;
      ctx.drawImage(gold, b.x, b.y + 80, b.w * 0.62, b.w * 0.46);
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = "#f1c315";
      ctx.beginPath();
      ctx.ellipse(b.x + b.w * 0.28, b.y + b.h * 0.45, b.w * 0.25, b.h * 0.22, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (miner && miner.complete && miner.naturalWidth) {
      const mh = H * 0.62;
      const mw = mh * (miner.naturalWidth / miner.naturalHeight);
      ctx.drawImage(miner, W - mw * 0.72, H * 0.24, mw, mh);
    }

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffd52e";
    ctx.font = "900 84px 'Microsoft YaHei', Arial";
    ctx.fillText("黄金矿工", 350, 185);
    const button = Assets.peek("StartButton");
    if (Assets.isReady("StartButton") && button) {
      ctx.drawImage(button, b.x, b.y, b.w, b.h);
    } else {
      drawNativeStartButton(b, Assets.progress().complete ? "开始游戏" : "素材加载中");
    }
    ctx.restore();
  }

  function drawNativeStartButton(b, label = "开始游戏") {
    ctx.save();
    const gradient = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    gradient.addColorStop(0, "#fff237");
    gradient.addColorStop(0.55, "#ffc400");
    gradient.addColorStop(1, "#d68a00");
    ctx.fillStyle = gradient;
    ctx.strokeStyle = "#663700";
    ctx.lineWidth = 14;
    drawRoundRect(b.x, b.y, b.w, b.h, 55);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#5b3200";
    ctx.font = "900 68px 'Microsoft YaHei', Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 3);
    ctx.restore();
  }

  function drawLoadingProgress() {
    const progress = Assets.progress();
    if (progress.complete) return;
    const width = 720;
    const height = 34;
    const x = (W - width) / 2;
    const y = H - 82;
    ctx.save();
    ctx.fillStyle = "rgba(20, 10, 2, 0.84)";
    drawRoundRect(x - 28, y - 54, width + 56, 112, 24);
    ctx.fill();
    ctx.fillStyle = "#4a2807";
    drawRoundRect(x, y, width, height, 17);
    ctx.fill();
    ctx.fillStyle = "#ffd529";
    drawRoundRect(x, y, Math.max(height, width * progress.ratio), height, 17);
    ctx.fill();
    ctx.fillStyle = "#fff1a8";
    ctx.font = "900 30px 'Microsoft YaHei', Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`资源加载中 ${progress.settled}/${progress.total}`, W / 2, y - 27);
    ctx.restore();
  }

  function drawRoundRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
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
    if (game.hook.state === "SHOOT") return Assets.get("MinerLower") || Assets.get("Miner");
    return Assets.get("MinerRaise") || Assets.get("MinerLower") || Assets.get("Miner");
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

  function frame(now) {
    try {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      update(dt, now);
      draw();
      frames += 1;
      if (now - lastTelemetry > 1000) {
        const rect = canvas.getBoundingClientRect();
        Assets.setRuntimeInfo({
          canvas: `${canvas.width}x${canvas.height}`,
          css: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          frames,
          painted: true,
          error: "",
        });
        lastTelemetry = now;
      }
    } catch (error) {
      Assets.reportRuntimeError(error);
      drawEmergencyStart();
    }
    requestAnimationFrame(frame);
  }

  function drawEmergencyStart() {
    try {
      ctx.fillStyle = "#241406";
      ctx.fillRect(0, 0, W, H);
      const b = { x: W / 2 - 270, y: H / 2 - 90, w: 540, h: 180 };
      game.startButton = b;
      drawNativeStartButton(b);
    } catch (_) {
      // Keep the animation loop alive even if this browser loses its canvas context.
    }
  }

  if (new URLSearchParams(location.search).has("debug")) {
    window.__goldMinerDebug = {
      game,
      startGame,
      endGame,
      Assets,
      rewards: typeof REWARDS !== "undefined" ? REWARDS : [],
    };
  }
})();












