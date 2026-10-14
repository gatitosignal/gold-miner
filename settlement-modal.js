var CollectionStore = (() => {
  const key = "goldMinerSurpriseCollection";

  function readIds() {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function has(id) {
    return readIds().includes(id);
  }

  function add(id) {
    const ids = readIds();
    if (!ids.includes(id)) {
      ids.push(id);
      try {
        localStorage.setItem(key, JSON.stringify(ids));
      } catch (_) {}
    }
  }

  function rewards() {
    const ids = readIds();
    return ids.map((id) => REWARDS.find((reward) => reward.id === id)).filter(Boolean);
  }

  return { add, has, rewards };
})();

var SettlementModal = (() => {
  const overlay = document.getElementById("rewardOverlay");

  function open({ score, onContinue, onOpenReward }) {
    const collected = CollectionStore.rewards();
    overlay.hidden = false;
    syncViewportSize();
    overlay.innerHTML = `
      <section class="settlement-shell">
        <div class="settlement-frame">
          <header class="settlement-header">
            <h2>游戏结束！</h2>
            <p>本轮最终得分：<strong>${score}</strong></p>
          </header>
          <section class="collection-panel">
            <h3>惊喜收藏</h3>
            <div class="collection-list">
              ${collected.length ? collected.map(renderCollectionItem).join("") : `<div class="collection-empty">还没有获得惊喜，继续挖矿试试吧。</div>`}
            </div>
          </section>
          <footer class="settlement-footer">
            <button class="settlement-continue" type="button">继续游戏</button>
          </footer>
        </div>
      </section>
    `;
    bindImageFallbacks();
    overlay.querySelector(".settlement-continue")?.addEventListener("click", onContinue);
    overlay.querySelectorAll(".collection-item").forEach((button) => {
      button.addEventListener("click", () => {
        const reward = REWARDS.find((item) => item.id === button.dataset.rewardId);
        if (reward) onOpenReward(reward);
      });
    });
  }

  function close() {
    overlay.hidden = true;
    overlay.innerHTML = "";
  }

  function renderCollectionItem(reward) {
    return `
      <button class="collection-item" type="button" data-reward-id="${escapeAttr(reward.id)}">
        ${thumbBlock(reward)}
        <span>${escapeHtml(reward.title || reward.couponName || reward.id)}</span>
      </button>
    `;
  }

  function thumbBlock(reward) {
    const src = rewardThumb(reward);
    if (!src) return `<span class="collection-thumb"><span class="image-placeholder">惊喜</span></span>`;
    return `
      <span class="collection-thumb">
        <img src="${escapeAttr(src)}" alt="${escapeAttr(reward.title || reward.couponName || "惊喜")}" draggable="false" />
        <span class="image-placeholder" hidden>惊喜</span>
      </span>
    `;
  }

  function rewardThumb(reward) {
    if (reward.options?.[0]?.image) return reward.options[0].image;
    if (reward.images?.[0]?.image) return reward.images[0].image;
    if (reward.itemType === "stone") return "assets/Rock.png";
    if (reward.itemType === "bomb") return "assets/Bomb.png";
    if (reward.itemType === "mystery") return "assets/MysteryBag.png";
    if (reward.itemType === "gold") return "assets/GoldSmall.png";
    return "";
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

  function bindImageFallbacks() {
    overlay.querySelectorAll(".collection-thumb img").forEach((img) => {
      img.addEventListener("error", () => {
        img.hidden = true;
        img.nextElementSibling.hidden = false;
      });
    });
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
