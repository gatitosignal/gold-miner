var RewardModal = (() => {
  const overlay = document.getElementById("rewardOverlay");
  let closeHandler = null;

  function open(reward, onClose) {
    closeHandler = onClose;
    overlay.hidden = false;
    syncViewportSize();
    overlay.innerHTML = "";
    overlay.appendChild(renderShell(reward));
    bindTemplate(reward);
  }

  function close(notify = true) {
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
      const label = displayLabel(option, `选项 ${index + 1}`);
      const item = document.createElement("button");
      item.type = "button";
      item.className = "quiz-option";
      item.dataset.correct = option.correct ? "true" : "false";
      item.innerHTML = `
        ${imageBlock(option.image, label)}
        <span>${escapeHtml(label)}</span>
      `;
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
            ${imageBlock(item.image, displayLabel(item, `照片 ${index + 1}`))}
            <b>${escapeHtml(displayLabel(item, `照片 ${index + 1}`))}</b>
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
            ${imageBlock(item.image, displayLabel(item, `照片 ${index + 1}`))}
            <b>${escapeHtml(displayLabel(item, `照片 ${index + 1}`))}</b>
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
    bindImageFallbacks();
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

  function bindImageFallbacks() {
    overlay.querySelectorAll(".reward-img img").forEach((img) => {
      img.addEventListener("error", () => {
        img.hidden = true;
        img.nextElementSibling.hidden = false;
      });
      img.addEventListener("load", () => {
        img.hidden = false;
        img.nextElementSibling.hidden = true;
      });
    });
  }

  function imageBlock(src, label) {
    if (!src) {
      return `<span class="reward-img"><span class="image-placeholder">待替换图片</span></span>`;
    }
    return `
      <span class="reward-img">
        <img src="${escapeAttr(src)}" alt="${escapeAttr(label || "奖励图片")}" draggable="false" />
        <span class="image-placeholder" hidden>待替换图片</span>
      </span>
    `;
  }

  function displayLabel(item, fallback = "") {
    if (item.label) return item.label;
    return labelFromPath(item.image) || fallback;
  }

  function labelFromPath(path) {
    if (!path) return "";
    if (/^data:/i.test(path)) return "";
    const file = decodeURIComponent(path.split(/[\\/]/).pop() || "");
    const base = file.replace(/\.[^.]+$/, "");
    const cleaned = base
      .replace(/^(food|boardgame|movie|view|trip|concert|event)[-_]*/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    return cleaned || base;
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
