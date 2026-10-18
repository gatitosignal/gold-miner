var RewardImageLoader = (() => {
  const VERSION = "20261018-decoded-cache-v5";
  const MAX_CONCURRENT = 2;
  const REQUEST_TIMEOUT = 45000;
  const DECODE_TIMEOUT = 12000;
  const MAX_CACHE_BYTES = 4 * 1024 * 1024;
  const MAX_DECODED_BYTES = 12 * 1024 * 1024;
  const MAX_CACHE_ENTRIES = 24;
  const RETRIES = 2;
  const queue = [];
  const scopes = new WeakMap();
  const blobCache = new Map();
  const records = [];
  let active = 0;
  let cachedBytes = 0;
  let decodedBytes = 0;

  function markup(src, label, fallback = "图片加载失败") {
    if (!src) {
      return `<span class="reward-img"><span class="image-placeholder">待替换图片</span></span>`;
    }
    return `
      <span class="reward-img is-loading">
        <img data-reward-src="${escapeAttr(src)}" alt="${escapeAttr(label || "奖励图片")}" draggable="false" hidden />
        <span class="image-placeholder" role="status">
          <span class="image-status">图片加载中…</span>
          <span class="image-retry" role="button" tabindex="0" hidden>${escapeHtml(fallback)}，点此重试</span>
        </span>
      </span>
    `;
  }

  function bind(root) {
    dispose(root);
    const scope = { root, disposed: false, controllers: new Set(), transientUrls: new Set() };
    scopes.set(root, scope);
    root.querySelectorAll("img[data-reward-src]").forEach((img) => enqueue(() => loadElement(scope, img)));
    scope.clickHandler = (event) => {
      const retry = event.target.closest?.(".image-retry");
      if (!retry || !root.contains(retry)) return;
      event.preventDefault();
      event.stopPropagation();
      const img = retry.closest(".reward-img")?.querySelector("img[data-reward-src]");
      if (img) enqueue(() => loadElement(scope, img));
    };
    scope.keyHandler = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const retry = event.target.closest?.(".image-retry");
      if (retry) retry.click();
    };
    root.addEventListener("click", scope.clickHandler);
    root.addEventListener("keydown", scope.keyHandler);
    return scope;
  }

  function dispose(root) {
    const scope = scopes.get(root);
    if (!scope) return;
    scope.disposed = true;
    scope.controllers.forEach((controller) => controller.abort());
    scope.controllers.clear();
    root.removeEventListener("click", scope.clickHandler);
    root.removeEventListener("keydown", scope.keyHandler);
    root.querySelectorAll("img[data-reward-src]").forEach((img) => {
      const key = img.dataset.rewardCacheKey;
      const cached = key ? blobCache.get(key) : null;
      if (cached?.image === img) {
        img.remove();
        cached.lastUsed = performance.now();
      } else {
        img.removeAttribute("src");
      }
    });
    scope.transientUrls.forEach((url) => URL.revokeObjectURL(url));
    scope.transientUrls.clear();
    trimCache();
    scopes.delete(root);
  }

  function enqueue(task) {
    queue.push(task);
    pump();
  }

  function pump() {
    while (active < MAX_CONCURRENT && queue.length) {
      const task = queue.shift();
      active += 1;
      Promise.resolve()
        .then(task)
        .catch(() => {})
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  async function loadElement(scope, img) {
    if (scope.disposed || !img.isConnected) return;
    const holder = img.closest(".reward-img");
    const source = img.dataset.rewardSrc;
    let lastError = null;
    setState(holder, "loading", "图片加载中…");
    for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
      if (scope.disposed) return;
      const record = {
        source,
        requestUrl: versionedUrl(source),
        attempt,
        phase: "network",
        ok: false,
        errorType: "",
        error: "",
        status: null,
        contentType: "",
        bytes: 0,
        width: 0,
        height: 0,
        renderedWidth: 0,
        renderedHeight: 0,
        startedAt: Math.round(performance.now()),
        durationMs: 0,
        fromCache: false,
        fromDecodedCache: false,
        downloadMs: 0,
        decodeMs: 0,
        displayMs: 0,
      };
      records.push(record);
      if (records.length > 100) records.shift();
      try {
        const resource = await fetchBlob(scope, record);
        if (scope.disposed) return;
        record.phase = "decode";
        setState(holder, "loading", `正在解码${attempt > 1 ? `（重试 ${attempt}）` : ""}…`);
        const displayedImage = await showBlob(scope, img, resource, record);
        if (scope.disposed) return;
        record.ok = true;
        record.phase = "ready";
        record.durationMs = Math.round(performance.now() - record.startedAt);
        setState(holder, "ready", "");
        requestAnimationFrame(() => auditRender(displayedImage, record));
        return;
      } catch (error) {
        if (scope.disposed || error?.imageType === "cancelled") return;
        lastError = error;
        const failedPhase = record.phase;
        record.phase = "failed";
        record.errorType = error?.imageType || "network";
        record.error = error?.message || String(error);
        record.durationMs = Math.round(performance.now() - record.startedAt);
        if (failedPhase === "decode") removeFromCache(record.requestUrl);
        console.warn(`[RewardImage] ${record.errorType} failure`, record.requestUrl, error);
        if (attempt < RETRIES) {
          setState(holder, "loading", `加载失败，正在重试（${attempt + 1}/${RETRIES}）…`);
          await delay(300 * attempt);
        }
      }
    }
    img.hidden = true;
    setState(holder, "error", `${errorLabel(lastError)}；点此重试`);
  }

  async function fetchBlob(scope, record) {
    const url = record.requestUrl;
    const cached = blobCache.get(url);
    if (cached) {
      cached.lastUsed = performance.now();
      record.fromCache = true;
      record.fromDecodedCache = !!(cached.image?.complete && cached.image.naturalWidth);
      record.contentType = cached.blob.type;
      record.bytes = cached.blob.size;
      record.phase = "cache";
      return cached;
    }

    const downloadStartedAt = performance.now();
    const controller = new AbortController();
    scope.controllers.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT);
    try {
      const response = await fetch(url, {
        cache: "default",
        credentials: "same-origin",
        signal: controller.signal,
      });
      record.status = response.status;
      record.contentType = response.headers.get("content-type") || "";
      if (!response.ok) throw imageError("network", `HTTP ${response.status}`);
      const mediaType = record.contentType.toLowerCase().split(";", 1)[0].trim();
      if (mediaType && !mediaType.startsWith("image/") && mediaType !== "application/octet-stream") {
        throw imageError("decode", `unexpected Content-Type: ${record.contentType}`);
      }
      record.phase = "download";
      const blob = await response.blob();
      if (!blob.size) throw imageError("network", "empty response body");
      record.bytes = blob.size;
      record.downloadMs = Math.round(performance.now() - downloadStartedAt);
      return addToCache(url, blob);
    } catch (error) {
      if (error?.imageType) throw error;
      if (timedOut) throw imageError("timeout", `download timeout after ${REQUEST_TIMEOUT}ms`);
      if (controller.signal.aborted) throw imageError("cancelled", "modal closed");
      throw imageError("network", error?.message || "request failed");
    } finally {
      clearTimeout(timer);
      scope.controllers.delete(controller);
    }
  }

  function showBlob(scope, img, resource, record) {
    return new Promise((resolve, reject) => {
      const decodeStartedAt = performance.now();
      if (resource.image?.complete && resource.image.naturalWidth && resource.image.naturalHeight) {
        const cachedImage = resource.image;
        cachedImage.alt = img.alt;
        cachedImage.dataset.rewardSrc = img.dataset.rewardSrc;
        cachedImage.dataset.rewardCacheKey = record.requestUrl;
        cachedImage.hidden = false;
        img.replaceWith(cachedImage);
        resource.lastUsed = performance.now();
        record.fromDecodedCache = true;
        record.width = cachedImage.naturalWidth;
        record.height = cachedImage.naturalHeight;
        record.decodeMs = 0;
        resolve(cachedImage);
        return;
      }

      const objectUrl = resource.objectUrl || URL.createObjectURL(resource.blob);
      resource.objectUrl = objectUrl;
      if (!resource.cached) scope.transientUrls.add(objectUrl);
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        if (fn === reject) {
          img.removeAttribute("src");
          if (!resource.cached) {
            URL.revokeObjectURL(objectUrl);
            scope.transientUrls.delete(objectUrl);
          }
        }
        fn(value);
      };
      const timer = setTimeout(() => finish(reject, imageError("timeout", `decode timeout after ${DECODE_TIMEOUT}ms`)), DECODE_TIMEOUT);
      img.onload = () => {
        if (!img.naturalWidth || !img.naturalHeight) {
          finish(reject, imageError("decode", "decoded image has zero dimensions"));
          return;
        }
        record.width = img.naturalWidth;
        record.height = img.naturalHeight;
        record.decodeMs = Math.round(performance.now() - decodeStartedAt);
        if (resource.cached) {
          resource.image = img;
          resource.decodedBytes = img.naturalWidth * img.naturalHeight * 4;
          resource.lastUsed = performance.now();
          img.dataset.rewardCacheKey = record.requestUrl;
          recalculateDecodedBytes();
          trimCache();
        }
        img.hidden = false;
        finish(resolve, img);
      };
      img.onerror = () => finish(reject, imageError("decode", "browser rejected WebP image data"));
      img.src = objectUrl;
    });
  }

  function auditRender(img, record) {
    if (!img.isConnected || img.hidden) return;
    const rect = img.getBoundingClientRect();
    const style = getComputedStyle(img);
    record.renderedWidth = Math.round(rect.width);
    record.renderedHeight = Math.round(rect.height);
    record.displayMs = Math.round(performance.now() - record.startedAt);
    if (!rect.width || !rect.height || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      record.ok = false;
      record.phase = "failed";
      record.errorType = "render";
      record.error = `not visible (${rect.width}x${rect.height}, ${style.display}/${style.visibility}/${style.opacity})`;
      console.warn("[RewardImage] render failure", record.requestUrl, record.error);
    }
  }

  function setState(holder, state, message) {
    if (!holder) return;
    holder.classList.toggle("is-loading", state === "loading");
    holder.classList.toggle("is-error", state === "error");
    const placeholder = holder.querySelector(".image-placeholder");
    const status = holder.querySelector(".image-status");
    const retry = holder.querySelector(".image-retry");
    const img = holder.querySelector("img[data-reward-src]");
    if (placeholder) placeholder.hidden = state === "ready";
    if (status) {
      status.hidden = state === "error";
      status.textContent = message;
    }
    if (retry) {
      retry.hidden = state !== "error";
      retry.textContent = message;
    }
    if (img && state !== "ready") img.hidden = true;
  }

  function addToCache(url, blob) {
    if (blob.size > MAX_CACHE_BYTES) {
      return { blob, lastUsed: performance.now(), objectUrl: "", image: null, decodedBytes: 0, cached: false };
    }
    const resource = { blob, lastUsed: performance.now(), objectUrl: "", image: null, decodedBytes: 0, cached: true };
    blobCache.set(url, resource);
    cachedBytes += blob.size;
    trimCache();
    return resource;
  }

  function removeFromCache(url) {
    const cached = blobCache.get(url);
    if (!cached) return;
    blobCache.delete(url);
    cachedBytes -= cached.blob.size;
    decodedBytes -= cached.decodedBytes || 0;
    if (cached.image) cached.image.removeAttribute("src");
    if (cached.objectUrl) URL.revokeObjectURL(cached.objectUrl);
  }

  function dropDecodedResource(resource) {
    if (!resource || resource.image?.isConnected) return false;
    if (resource.image) resource.image.removeAttribute("src");
    if (resource.objectUrl) URL.revokeObjectURL(resource.objectUrl);
    resource.image = null;
    resource.objectUrl = "";
    resource.decodedBytes = 0;
    return true;
  }

  function recalculateDecodedBytes() {
    decodedBytes = [...blobCache.values()].reduce((sum, item) => sum + (item.decodedBytes || 0), 0);
  }

  function trimCache() {
    recalculateDecodedBytes();
    while (decodedBytes > MAX_DECODED_BYTES) {
      const oldestDecoded = [...blobCache.values()]
        .filter((item) => item.decodedBytes && !item.image?.isConnected)
        .sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!oldestDecoded || !dropDecodedResource(oldestDecoded)) break;
      recalculateDecodedBytes();
    }
    while (blobCache.size > MAX_CACHE_ENTRIES || cachedBytes > MAX_CACHE_BYTES) {
      const oldest = [...blobCache.entries()]
        .filter(([, item]) => !item.image?.isConnected)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (!oldest) break;
      removeFromCache(oldest[0]);
    }
  }

  function versionedUrl(source) {
    const url = new URL(source, document.baseURI);
    url.searchParams.set("v", VERSION);
    return url.href;
  }

  function errorLabel(error) {
    const type = error?.imageType || "network";
    if (type === "decode") return "图片解码失败";
    if (type === "timeout") return "图片加载超时";
    if (type === "render") return "图片渲染失败";
    return "图片下载失败";
  }

  function imageError(type, message) {
    const error = new Error(message);
    error.imageType = type;
    return error;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function stats() {
    return {
      active,
      queued: queue.length,
      cachedBytes,
      decodedBytes,
      cacheEntries: blobCache.size,
      maxCacheBytes: MAX_CACHE_BYTES,
      maxDecodedBytes: MAX_DECODED_BYTES,
      maxCacheEntries: MAX_CACHE_ENTRIES,
      records: records.map((record) => ({ ...record })),
    };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  return { markup, bind, dispose, stats };
})();

var RewardModal = (() => {
  const overlay = document.getElementById("rewardOverlay");
  let closeHandler = null;

  function open(reward, onClose) {
    closeHandler = onClose;
    RewardImageLoader.dispose(overlay);
    overlay.hidden = false;
    syncViewportSize();
    overlay.innerHTML = "";
    overlay.appendChild(renderShell(reward));
    bindTemplate(reward);
  }

  function close(notify = true) {
    RewardImageLoader.dispose(overlay);
    overlay.hidden = true;
    overlay.innerHTML = "";
    const handler = closeHandler;
    closeHandler = null;
    if (notify && handler) handler();
  }

  function renderShell(reward) {
    const shell = document.createElement("section");
    shell.className = `reward-shell reward-theme-${themeForReward(reward)}`;
    const title = reward.template === "coupon" ? "" : (reward.title || reward.couponName || "奖励");
    shell.innerHTML = `
      <div class="reward-frame">
        ${title ? `<header class="reward-header"><h2>${escapeHtml(title)}</h2></header>` : ""}
        <div class="reward-body"></div>
        <footer class="reward-footer"></footer>
      </div>
    `;

    const body = shell.querySelector(".reward-body");
    const footer = shell.querySelector(".reward-footer");
    body.appendChild(renderTemplate(reward));
    footer.appendChild(renderButton(reward));
    return shell;
  }

  function syncViewportSize() {
    const widths = [window.visualViewport?.width, window.innerWidth, window.screen?.width, document.documentElement.clientWidth].filter(Boolean);
    const heights = [window.visualViewport?.height, window.innerHeight, window.screen?.height, document.documentElement.clientHeight].filter(Boolean);
    const width = Math.min(...widths);
    const height = Math.min(...heights);
    overlay.style.setProperty("--visual-vw", `${Math.floor(width)}px`);
    overlay.style.setProperty("--visual-vh", `${Math.floor(height)}px`);
    overlay.style.width = `${Math.floor(width)}px`;
    overlay.style.height = `${Math.floor(height)}px`;
  }

  function renderButton(reward) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reward-action";
    button.textContent = actionText(reward);
    if (reward.template === "quiz") button.disabled = true;
    button.addEventListener("click", () => close());
    return button;
  }

  function actionText(reward) {
    if (reward.template === "coupon") return "收入囊中";
    if (reward.template === "gift") return "继续挖矿";
    return "继续挖矿";
  }

  function renderTemplate(reward) {
    const wrap = document.createElement("div");
    wrap.className = `reward-template reward-template-${reward.template}`;
    if (reward.template === "quiz") renderQuiz(wrap, reward);
    else if (reward.template === "envelope") renderEnvelope(wrap, reward);
    else if (reward.template === "circular") renderCircular(wrap, reward);
    else if (reward.template === "stack") renderStack(wrap, reward);
    else if (reward.template === "coupon") renderCoupon(wrap, reward);
    else if (reward.template === "gift") renderGift(wrap, reward);
    else wrap.textContent = "奖励内容待配置";
    return wrap;
  }

  function renderQuiz(wrap, reward) {
    const options = reward.options || [];
    const list = document.createElement("div");
    list.className = "quiz-grid";
    options.forEach((option, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "quiz-option";
      item.setAttribute("aria-label", `选择第 ${index + 1} 张图片`);
      item.dataset.correct = option.correct ? "true" : "false";
      item.innerHTML = imageBlock(option.thumbnail || option.image, "奖励选项图片");
      list.appendChild(item);
    });
    const feedback = document.createElement("p");
    feedback.className = "quiz-feedback";
    feedback.textContent = "请选择一张图片";
    wrap.append(list, feedback);
  }

  function renderEnvelope(wrap, reward) {
    wrap.innerHTML = `
      <div class="envelope-scene">
        <button class="envelope-stage" type="button" aria-label="打开信封">
          <span class="envelope-mask">
            <span class="env-back"></span>
            <span class="letter">
              <span class="letter-title">${escapeHtml(reward.title || "回忆信封")}</span>
              <span class="letter-text">${escapeHtml(reward.text || "待替换文字")}</span>
            </span>
            <span class="env-flap"></span>
            <span class="env-front"></span>
            <span class="env-bottom"></span>
          </span>
        </button>
      </div>
    `;
  }

  function renderCircular(wrap, reward) {
    const images = reward.images || [];
    wrap.innerHTML = `
      <div class="circular-wrap">
        <div class="arc-stage">
        ${images.map((item, index) => `
          <article class="arc-card" data-index="${index}">
            ${imageBlock(item.image, "奖励图片")}
          </article>
        `).join("")}
        </div>
      </div>
    `;
  }

  function renderStack(wrap, reward) {
    const images = reward.images || [];
    wrap.innerHTML = `
      <div class="stack-wrap">
        <button class="card-stack" type="button" aria-label="切换照片">
        ${images.map((item, index) => `
          <article class="stack-card" data-index="${index}">
            ${imageBlock(item.image, "奖励图片")}
          </article>
        `).join("")}
        </button>
      </div>
    `;
  }

  function renderCoupon(wrap, reward) {
    wrap.innerHTML = `
      <div class="coupon-card">
        <span class="coupon-kicker">SPECIAL COUPON</span>
        <strong>${escapeHtml(reward.couponName || "兑换券")}</strong>
        <p>${escapeHtml(reward.description || "")}</p>
        <small>${escapeHtml(reward.note || "")}</small>
      </div>
    `;
  }

  function renderGift(wrap, reward) {
    wrap.innerHTML = `
      <div class="gift-wrap">
        <div class="gift-card">
          <div class="gift-icon" aria-hidden="true">🎁</div>
          <p>${escapeHtml(reward.text || "")}</p>
          <div class="gift-note">${escapeHtml(reward.hint || "")}</div>
        </div>
      </div>
    `;
  }

  function bindTemplate(reward) {
    RewardImageLoader.bind(overlay);
    if (reward.template === "quiz") bindQuiz(reward);
    if (reward.template === "envelope") bindEnvelope();
    if (reward.template === "circular") bindCircular();
    if (reward.template === "stack") bindStack();
  }

  function bindQuiz(reward) {
    const feedback = overlay.querySelector(".quiz-feedback");
    const action = overlay.querySelector(".reward-action");
    let answered = false;
    overlay.querySelectorAll(".quiz-option").forEach((button) => {
      button.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        const correct = button.dataset.correct === "true";
        overlay.querySelectorAll(".quiz-option").forEach((item) => item.classList.remove("is-selected", "is-right", "is-wrong"));
        button.classList.add("is-selected", correct ? "is-right" : "is-wrong");
        feedback.textContent = correct ? (reward.success || "答对啦！") : (reward.fail || "选错啦。");
        if (typeof AudioManager !== "undefined") AudioManager.play(correct ? "quizCorrect" : "quizWrong", 0.6);
        action.disabled = false;
      });
    });
  }

  function bindEnvelope() {
    overlay.querySelector(".envelope-stage")?.addEventListener("click", (evt) => {
      evt.currentTarget.classList.toggle("open");
    });
  }

  function bindCircular() {
    const wrap = overlay.querySelector(".circular-wrap");
    if (!wrap) return;
    const cards = Array.from(wrap.querySelectorAll(".arc-card"));
    let offset = 0;
    let drag = false;
    let startX = 0;
    let startOffset = 0;
    const spacing = 22;
    const draw = () => {
      cards.forEach((card, index) => {
        const angle = (index - (cards.length - 1) / 2) * spacing + offset;
        const abs = Math.abs(angle);
        const y = abs * 0.2;
        const scale = Math.max(0.8, 1 - abs / 230);
        card.style.transform = `rotate(${angle}deg) translateY(${y}px) scale(${scale})`;
        card.style.zIndex = String(100 - Math.round(abs));
        card.style.opacity = String(Math.max(0.58, 1 - abs / 155));
        card.style.filter = `saturate(${Math.max(0.7, 1 - abs / 180)})`;
      });
    };
    draw();
    wrap.addEventListener("pointerdown", (evt) => {
      drag = true;
      startX = evt.clientX;
      startOffset = offset;
      wrap.setPointerCapture?.(evt.pointerId);
    });
    wrap.addEventListener("pointermove", (evt) => {
      if (!drag) return;
      offset = startOffset + (evt.clientX - startX) * 0.18;
      draw();
    });
    wrap.addEventListener("pointerup", () => {
      drag = false;
    });
    wrap.addEventListener("pointercancel", () => {
      drag = false;
    });
    wrap.addEventListener("wheel", (evt) => {
      evt.preventDefault();
      offset += (evt.deltaY || evt.deltaX) * -0.035;
      draw();
    }, { passive: false });
  }

  function bindStack() {
    const stack = overlay.querySelector(".card-stack");
    if (!stack) return;
    let order = Array.from(stack.querySelectorAll(".stack-card"));
    const layout = () => {
      order.forEach((card, index) => {
        const rot = (index % 2 === 0 ? -1 : 1) * index * 2.1;
        card.style.zIndex = String(order.length - index);
        card.style.transform = `translate(${index * 3}px,${index * 7}px) rotate(${rot}deg) scale(${1 - index * 0.025})`;
        card.style.opacity = String(Math.max(0.74, 1 - index * 0.07));
      });
    };
    layout();
    stack.addEventListener("click", () => {
      const top = order[0];
      if (!top) return;
      top.style.transform = "translate(160px,-18px) rotate(15deg) scale(.92)";
      top.style.opacity = "0";
      setTimeout(() => {
        order.push(order.shift());
        top.style.transition = "none";
        layout();
        top.offsetHeight;
        top.style.transition = "";
        layout();
      }, 420);
    });
  }

  function imageBlock(src, label) {
    return RewardImageLoader.markup(src, label);
  }

  function themeForReward(reward) {
    if (reward.itemType === "stone") return "rock";
    if (reward.itemType === "bomb") return "bomb";
    if (reward.itemType === "mystery") return "mystery";
    return "gold";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  return { open, close };
})();
