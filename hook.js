class HookSystem {
  constructor(anchor) {
    this.base = anchor;
    this.angle = 0;
    this.length = CONFIG.hook.minLength;
    this.state = "IDLE";
    this.swingDir = 1;
    this.grabbed = null;
    this.grabTimer = 0;
  }

  get hookAnchor() {
    const d = this.direction();
    return {
      x: this.base.x + d.x * this.length,
      y: this.base.y + d.y * this.length,
    };
  }

  get collisionPoint() {
    const d = this.direction();
    const a = this.hookAnchor;
    return {
      x: a.x + d.x * CONFIG.hook.clawTipOffset,
      y: a.y + d.y * CONFIG.hook.clawTipOffset,
    };
  }

  direction() {
    return { x: Math.sin(this.angle), y: Math.cos(this.angle) };
  }

  shoot() {
    if (this.state === "IDLE") this.state = "SHOOT";
  }

  update(dt, objects, onCollect) {
    if (this.state === "IDLE") {
      this.angle += this.swingDir * dt * CONFIG.hook.swingSpeed;
      if (this.angle > CONFIG.hook.swingLimit) {
        this.angle = CONFIG.hook.swingLimit;
        this.swingDir = -1;
      } else if (this.angle < -CONFIG.hook.swingLimit) {
        this.angle = -CONFIG.hook.swingLimit;
        this.swingDir = 1;
      }
      this.length = CONFIG.hook.minLength;
      return;
    }

    if (this.state === "SHOOT") {
      const delta = dt * CONFIG.hook.shootSpeed;
      this.length += delta;
      const hit = objects.find((obj) => obj.hit(this.collisionPoint));
      if (hit) {
        this.grabbed = hit;
        hit.attach(this.hookAnchor);
        this.state = "GRAB";
        this.grabTimer = CONFIG.hook.grabDelay;
      } else if (this.outOfBounds()) {
        this.state = "RETURN";
      }
      return;
    }

    if (this.state === "GRAB") {
      this.grabTimer -= dt;
      if (this.grabbed) this.grabbed.syncToHook(this.hookAnchor);
      if (this.grabTimer <= 0) this.state = "RETURN";
      return;
    }

    if (this.state === "RETURN") {
      const speed = this.grabbed ? this.grabbed.returnSpeed : 720;
      const delta = dt * speed;
      this.length -= delta;
      if (this.grabbed) this.grabbed.syncToHook(this.hookAnchor);
      if (this.length <= CONFIG.hook.minLength) {
        this.length = CONFIG.hook.minLength;
        if (this.grabbed) {
          onCollect(this.grabbed);
          this.grabbed = null;
        }
        this.state = "IDLE";
      }
    }
  }

  outOfBounds() {
    const p = this.collisionPoint;
    return this.length >= CONFIG.hook.maxLength || p.x < 18 || p.x > CONFIG.width - 18 || p.y > CONFIG.height - 18;
  }

  draw(ctx) {
    const anchor = this.hookAnchor;
    drawRopeSprite(ctx, this.base, anchor);
    drawClawSprite(ctx, anchor, this.angle);
  }
}

function drawRopeSprite(ctx, from, to) {
  const img = Assets.get("Rope");
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) - Math.PI / 2;
  ctx.save();
  ctx.translate(from.x, from.y);
  ctx.rotate(angle);
  if (img && img.complete && img.naturalWidth) {
    const pieceH = 54;
    const ropeW = 17;
    for (let y = 0; y < len; y += pieceH - 2) {
      const h = Math.min(pieceH, len - y + 2);
      ctx.drawImage(img, 0, 0, img.naturalWidth, Math.min(img.naturalHeight, 120), -ropeW / 2, y, ropeW, h);
    }
  } else {
    ctx.strokeStyle = "#b57228";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, len);
    ctx.stroke();
  }
  ctx.restore();
}

function drawClawSprite(ctx, anchor, angle) {
  const img = Assets.get("Claw");
  if (!img || !img.complete || !img.naturalWidth) return;
  const w = CONFIG.hook.clawWidth;
  const h = w * (img.naturalHeight / img.naturalWidth);
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(-angle);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}
