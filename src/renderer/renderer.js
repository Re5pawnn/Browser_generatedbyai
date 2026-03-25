const api = window.browserApi;

if (!api) {
  throw new Error("browserApi is not available");
}

const elements = {
  shell: document.getElementById("shell"),
  tabStrip: document.getElementById("tab-strip"),
  newTabBtn: document.getElementById("new-tab-btn"),
  backBtn: document.getElementById("back-btn"),
  forwardBtn: document.getElementById("forward-btn"),
  reloadBtn: document.getElementById("reload-btn"),
  homeBtn: document.getElementById("home-btn"),
  addressInput: document.getElementById("address-input"),
  bookmarkBtn: document.getElementById("bookmark-btn"),
  settingsBtn: document.getElementById("settings-btn"),
  devtoolsBtn: document.getElementById("devtools-btn"),
  bookmarkList: document.getElementById("bookmark-list")
};

const state = {
  tabs: [],
  activeTabId: null,
  bookmarks: [],
  searchEngineKey: "bing",
  searchEngineLabel: "Bing"
};

let tabDragActive = false;
let bookmarkDragActive = false;
let pendingTabState = null;
let pendingBookmarks = null;
let suppressTabClickUntil = 0;
let suppressBookmarkClickUntil = 0;
let isAddressEditing = false;
let topInsetRaf = 0;

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

function getActiveTab() {
  return state.tabs.find((tab) => tab.id === state.activeTabId) || null;
}

function buildOriginFavicon(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return `${parsed.origin}/favicon.ico`;
    }
  } catch {}
  return "";
}

function buildFaviconLetter(title, url) {
  if (typeof title === "string" && title.trim()) {
    return title.trim().slice(0, 1).toUpperCase();
  }

  try {
    const parsed = new URL(url);
    return parsed.hostname.slice(0, 1).toUpperCase() || "?";
  } catch {
    return "?";
  }
}

function createFaviconNode(kind, favicon, title, url) {
  const wrap = document.createElement("span");
  wrap.className = `${kind}-favicon-wrap`;

  const img = document.createElement("img");
  img.className = `${kind}-favicon`;
  img.alt = "";

  const fallback = document.createElement("span");
  fallback.className = `${kind}-favicon-fallback`;
  fallback.textContent = buildFaviconLetter(title, url);

  wrap.appendChild(img);
  wrap.appendChild(fallback);

  let fallbackUrl = "";
  if (typeof favicon === "string" && favicon.trim()) {
    fallbackUrl = favicon.trim();
  } else {
    fallbackUrl = buildOriginFavicon(url);
  }

  if (!fallbackUrl) {
    img.style.display = "none";
    fallback.style.display = "flex";
    return wrap;
  }

  let triedOrigin = false;
  img.addEventListener("load", () => {
    img.style.display = "block";
    fallback.style.display = "none";
  });

  img.addEventListener("error", () => {
    if (!triedOrigin) {
      triedOrigin = true;
      const originIcon = buildOriginFavicon(url);
      if (originIcon && originIcon !== img.src) {
        img.src = originIcon;
        return;
      }
    }
    img.style.display = "none";
    fallback.style.display = "flex";
  });

  img.src = fallbackUrl;

  return wrap;
}

function updateAddressPlaceholder() {
  const label = state.searchEngineLabel || "Bing";
  elements.addressInput.placeholder = `输入网址或搜索关键词 (${label})`;
}

function syncAddressValueFromActiveTab() {
  if (isAddressEditing) {
    return;
  }
  const active = getActiveTab();
  elements.addressInput.value = active?.url || "";
}

function updateEqualTabWidth() {
  const tabCount = state.tabs.length;
  if (tabCount <= 0) {
    elements.tabStrip.style.setProperty("--tab-width", "220px");
    return;
  }

  const stripWidth = elements.tabStrip.clientWidth;
  const plusWidth = Math.max(34, Math.round(elements.newTabBtn.getBoundingClientRect().width));
  const gap = 8;
  const calculated = (stripWidth - plusWidth - gap * tabCount) / tabCount;
  const width = Math.max(130, Math.min(260, Math.floor(calculated)));
  elements.tabStrip.style.setProperty("--tab-width", `${width}px`);
}

function renderTabs() {
  const fragment = document.createDocumentFragment();

  for (const tab of state.tabs) {
    const item = document.createElement("div");
    item.className = `tab-item${tab.id === state.activeTabId ? " active" : ""}`;
    item.dataset.tabId = String(tab.id);

    const faviconNode = createFaviconNode("tab", tab.favicon, tab.title, tab.url);

    const titleNode = document.createElement("span");
    titleNode.className = "tab-title";
    titleNode.textContent = tab.title || "新建标签页";

    const closeNode = document.createElement("button");
    closeNode.className = "tab-close";
    closeNode.type = "button";
    closeNode.title = "关闭标签页";
    closeNode.textContent = "×";

    item.appendChild(faviconNode);
    item.appendChild(titleNode);
    item.appendChild(closeNode);
    fragment.appendChild(item);
  }

  elements.tabStrip.querySelectorAll(".tab-item").forEach((node) => node.remove());
  elements.tabStrip.insertBefore(fragment, elements.newTabBtn);
  updateEqualTabWidth();
}

function renderBookmarks() {
  const active = getActiveTab();
  const activeUrl = active?.url || "";
  const fragment = document.createDocumentFragment();

  for (const bookmark of state.bookmarks) {
    const item = document.createElement("div");
    item.className = `bookmark-item${bookmark.url === activeUrl ? " active" : ""}`;
    item.dataset.url = bookmark.url;
    item.title = bookmark.title || bookmark.url;

    const faviconNode = createFaviconNode("bookmark", bookmark.favicon, bookmark.title, bookmark.url);

    const textNode = document.createElement("span");
    textNode.className = "bookmark-text";
    textNode.textContent = bookmark.title || bookmark.url;

    item.appendChild(faviconNode);
    item.appendChild(textNode);
    fragment.appendChild(item);
  }

  elements.bookmarkList.replaceChildren(fragment);
}

function isActiveUrlBookmarked() {
  const active = getActiveTab();
  if (!active?.url) {
    return false;
  }
  return state.bookmarks.some((item) => item.url === active.url);
}

function updateControls() {
  const active = getActiveTab();

  elements.backBtn.disabled = !active || !active.canGoBack;
  elements.forwardBtn.disabled = !active || !active.canGoForward;
  elements.reloadBtn.disabled = !active;
  elements.homeBtn.disabled = !active;
  elements.bookmarkBtn.disabled = !active;

  elements.bookmarkBtn.classList.toggle("active", isActiveUrlBookmarked());

  syncAddressValueFromActiveTab();
  updateAddressPlaceholder();
}

function scheduleTopInsetSync() {
  if (topInsetRaf) {
    return;
  }
  topInsetRaf = window.requestAnimationFrame(() => {
    topInsetRaf = 0;
    const nextInset = Math.ceil(elements.shell.getBoundingClientRect().height);
    api.setTopInset(nextInset).catch(() => {});
  });
}

function applyTabState(payload) {
  state.tabs = Array.isArray(payload?.tabs) ? payload.tabs : [];
  state.activeTabId = Number.isFinite(payload?.activeTabId) ? payload.activeTabId : null;

  renderTabs();
  renderBookmarks();
  updateControls();
  scheduleTopInsetSync();
}

function applyBookmarks(nextBookmarks) {
  state.bookmarks = Array.isArray(nextBookmarks) ? nextBookmarks : [];
  renderBookmarks();
  updateControls();
  scheduleTopInsetSync();
}

function applySettings(nextSettings) {
  if (!nextSettings || typeof nextSettings !== "object") {
    return;
  }

  if (typeof nextSettings.searchEngineKey === "string") {
    state.searchEngineKey = nextSettings.searchEngineKey;
  }
  if (typeof nextSettings.searchEngineLabel === "string" && nextSettings.searchEngineLabel.trim()) {
    state.searchEngineLabel = nextSettings.searchEngineLabel.trim();
  }
  updateAddressPlaceholder();
}

function focusAddressBar() {
  elements.addressInput.focus();
  elements.addressInput.select();
}

function setupBasicEvents() {
  elements.newTabBtn.addEventListener("click", () => {
    api.createTab("").catch(console.error);
  });

  elements.tabStrip.addEventListener("click", (event) => {
    if (Date.now() < suppressTabClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const closeBtn = event.target.closest(".tab-close");
    if (closeBtn) {
      event.preventDefault();
      event.stopPropagation();
      const tabNode = closeBtn.closest(".tab-item");
      const tabId = Number(tabNode?.dataset.tabId);
      if (Number.isFinite(tabId)) {
        api.closeTab(tabId).catch(console.error);
      }
      return;
    }

    const tabNode = event.target.closest(".tab-item");
    if (!tabNode) {
      return;
    }

    const tabId = Number(tabNode.dataset.tabId);
    if (Number.isFinite(tabId)) {
      api.selectTab(tabId).catch(console.error);
    }
  });

  elements.bookmarkList.addEventListener("click", (event) => {
    if (Date.now() < suppressBookmarkClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const bookmarkNode = event.target.closest(".bookmark-item");
    if (!bookmarkNode) {
      return;
    }

    const url = bookmarkNode.dataset.url;
    if (url) {
      api.openBookmark(url).catch(console.error);
    }
  });

  elements.backBtn.addEventListener("click", () => api.navAction("back").catch(console.error));
  elements.forwardBtn.addEventListener("click", () => api.navAction("forward").catch(console.error));
  elements.reloadBtn.addEventListener("click", () => api.navAction("reload").catch(console.error));
  elements.homeBtn.addEventListener("click", () => api.navAction("home").catch(console.error));
  elements.devtoolsBtn.addEventListener("click", () => api.navAction("devtools").catch(console.error));

  elements.bookmarkBtn.addEventListener("click", async () => {
    const active = getActiveTab();
    if (!active?.url) {
      return;
    }

    try {
      const bookmarked = state.bookmarks.some((item) => item.url === active.url);
      if (bookmarked) {
        await api.removeBookmark(active.url);
        return;
      }
      await api.addBookmark();
    } catch (error) {
      console.error("Failed to toggle bookmark:", error);
    }
  });

  elements.settingsBtn.addEventListener("click", () => {
    const rect = elements.settingsBtn.getBoundingClientRect();
    api
      .showSettingsMenu({
        x: Math.round(rect.left),
        y: Math.round(rect.bottom + 6)
      })
      .catch(console.error);
  });

  elements.addressInput.addEventListener("focus", () => {
    isAddressEditing = true;
  });

  elements.addressInput.addEventListener("blur", () => {
    isAddressEditing = false;
    syncAddressValueFromActiveTab();
  });

  elements.addressInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const target = elements.addressInput.value.trim();
      api.navigate(target).catch(console.error);
      elements.addressInput.blur();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      elements.addressInput.blur();
      syncAddressValueFromActiveTab();
    }
  });

  window.addEventListener("resize", () => {
    updateEqualTabWidth();
    scheduleTopInsetSync();
  });

  const shellResizeObserver = new ResizeObserver(() => {
    scheduleTopInsetSync();
    updateEqualTabWidth();
  });
  shellResizeObserver.observe(elements.shell);

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const shortcut = event.ctrlKey || event.metaKey;

    if (shortcut && key === "t") {
      event.preventDefault();
      api.createTab("").catch(console.error);
      return;
    }

    if (shortcut && key === "w") {
      const active = getActiveTab();
      if (!active) {
        return;
      }
      event.preventDefault();
      api.closeTab(active.id).catch(console.error);
      return;
    }

    if (shortcut && key === "l") {
      event.preventDefault();
      focusAddressBar();
      return;
    }

    if (shortcut && key === "r") {
      event.preventDefault();
      api.navAction("reload").catch(console.error);
      return;
    }

    if (shortcut && key === "d") {
      event.preventDefault();
      elements.bookmarkBtn.click();
      return;
    }

    if (event.key === "F12") {
      event.preventDefault();
      api.navAction("devtools").catch(console.error);
    }
  });
}

function snapshotPositions(items, keyName) {
  const map = new Map();
  for (const item of items) {
    map.set(item.dataset[keyName], item.offsetLeft);
  }
  return map;
}

function playFlip(items, beforePositions, keyName, draggedItem) {
  for (const item of items) {
    if (item === draggedItem) {
      continue;
    }
    const key = item.dataset[keyName];
    const beforeLeft = beforePositions.get(key);
    if (beforeLeft === undefined) {
      continue;
    }

    const afterLeft = item.offsetLeft;
    const deltaX = beforeLeft - afterLeft;
    if (Math.abs(deltaX) < 0.5) {
      continue;
    }

    item.style.transition = "none";
    item.style.transform = `translateX(${deltaX}px)`;
    window.requestAnimationFrame(() => {
      item.style.transition = "transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      item.style.transform = "";
    });
  }
}

function createHorizontalReorder(options) {
  const {
    container,
    itemSelector,
    keyName,
    ignoreTarget,
    setSuppressClickUntil,
    onDragStateChange,
    onCommitOrder,
    onDropEnd
  } = options;

  let drag = null;
  const DIRECTION_SWITCH_EPSILON_PX = 1.5;

  function getItems() {
    return Array.from(container.querySelectorAll(itemSelector));
  }

  function handleMouseDown(event) {
    if (event.button !== 0) {
      return;
    }

    const item = event.target.closest(itemSelector);
    if (!item || !container.contains(item)) {
      return;
    }

    if (ignoreTarget && ignoreTarget(event.target)) {
      return;
    }

    const items = getItems();
    if (items.length < 2) {
      return;
    }

    drag = {
      item,
      startX: event.clientX,
      startY: event.clientY,
      lastClientX: event.clientX,
      direction: 0,
      pointerOffsetX: 0,
      active: false,
      key: item.dataset[keyName],
      startOrder: items.map((node) => node.dataset[keyName])
    };

    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    window.addEventListener("blur", handleWindowBlur, true);
  }

  function startDrag() {
    if (!drag) {
      return;
    }

    drag.active = true;
    const containerRect = container.getBoundingClientRect();
    const pointerXInContainer = drag.startX - containerRect.left + container.scrollLeft;
    drag.pointerOffsetX = pointerXInContainer - drag.item.offsetLeft;

    drag.item.classList.add("dragging-active");
    drag.item.style.transition = "none";
    drag.item.style.zIndex = "30";
    drag.item.style.willChange = "transform";

    container.classList.add("reordering");
    document.body.classList.add("dragging");
    onDragStateChange(true);
  }

  function updateDrag(clientX) {
    if (!drag || !drag.active) {
      return;
    }

    const moveDeltaX = clientX - drag.lastClientX;
    drag.lastClientX = clientX;
    if (moveDeltaX > DIRECTION_SWITCH_EPSILON_PX) {
      drag.direction = 1;
    } else if (moveDeltaX < -DIRECTION_SWITCH_EPSILON_PX) {
      drag.direction = -1;
    }

    const containerRect = container.getBoundingClientRect();
    const pointerXInContainer = clientX - containerRect.left + container.scrollLeft;
    const draggedLeftInContainer = pointerXInContainer - drag.pointerOffsetX;
    const offsetX = draggedLeftInContainer - drag.item.offsetLeft;
    drag.item.style.transform = `translateX(${Math.round(offsetX)}px)`;

    const items = getItems();
    if (items.length < 2) {
      return;
    }

    let swapped = false;

    if (drag.direction > 0) {
      while (true) {
        const ordered = getItems();
        const currentIndex = ordered.indexOf(drag.item);
        if (currentIndex < 0 || currentIndex >= ordered.length - 1) {
          break;
        }

        const nextItem = ordered[currentIndex + 1];
        const nextLeftEdge = nextItem.offsetLeft;
        if (pointerXInContainer < nextLeftEdge) {
          break;
        }

        const beforePositions = snapshotPositions(ordered, keyName);
        container.insertBefore(nextItem, drag.item);
        const afterItems = getItems();
        playFlip(afterItems, beforePositions, keyName, drag.item);
        swapped = true;
      }
    } else if (drag.direction < 0) {
      while (true) {
        const ordered = getItems();
        const currentIndex = ordered.indexOf(drag.item);
        if (currentIndex <= 0) {
          break;
        }

        const prevItem = ordered[currentIndex - 1];
        const prevRightEdge = prevItem.offsetLeft + prevItem.offsetWidth;
        if (pointerXInContainer > prevRightEdge) {
          break;
        }

        const beforePositions = snapshotPositions(ordered, keyName);
        container.insertBefore(drag.item, prevItem);
        const afterItems = getItems();
        playFlip(afterItems, beforePositions, keyName, drag.item);
        swapped = true;
      }
    }

    if (swapped) {
      const nextOffsetX = draggedLeftInContainer - drag.item.offsetLeft;
      drag.item.style.transform = `translateX(${Math.round(nextOffsetX)}px)`;
    }
  }

  function finish(commit) {
    if (!drag) {
      return;
    }

    const current = drag;
    drag = null;

    window.removeEventListener("mousemove", handleMouseMove, true);
    window.removeEventListener("mouseup", handleMouseUp, true);
    window.removeEventListener("blur", handleWindowBlur, true);

    if (!current.active) {
      return;
    }

    current.item.classList.remove("dragging-active");
    current.item.style.transform = "";
    current.item.style.transition = "";
    current.item.style.zIndex = "";
    current.item.style.willChange = "";

    container.classList.remove("reordering");
    document.body.classList.remove("dragging");
    const nextOrder = getItems().map((node) => node.dataset[keyName]);
    const changed = !arraysEqual(current.startOrder, nextOrder);
    onDragStateChange(false, { changed });
    onDropEnd(changed);

    setSuppressClickUntil(Date.now() + 220);

    if (commit && changed) {
      onCommitOrder(nextOrder);
    }
  }

  function handleMouseMove(event) {
    if (!drag) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (!drag.active) {
      if (Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) {
        return;
      }

      if (Math.abs(deltaX) <= Math.abs(deltaY)) {
        finish(false);
        return;
      }

      startDrag();
    }

    event.preventDefault();
    updateDrag(event.clientX);
  }

  function handleMouseUp() {
    finish(true);
  }

  function handleWindowBlur() {
    finish(false);
  }

  container.addEventListener("mousedown", handleMouseDown);
  container.addEventListener("dragstart", (event) => event.preventDefault());
}

function setupReorderControllers() {
  function bindUnifiedHorizontalReorder(config) {
    createHorizontalReorder({
      container: config.container,
      itemSelector: config.itemSelector,
      keyName: config.keyName,
      ignoreTarget: config.ignoreTarget,
      setSuppressClickUntil: config.setSuppressClickUntil,
      onDragStateChange: config.onDragStateChange,
      onCommitOrder: config.onCommitOrder,
      onDropEnd: config.onDropEnd
    });
  }

  bindUnifiedHorizontalReorder({
    container: elements.tabStrip,
    itemSelector: ".tab-item",
    keyName: "tabId",
    ignoreTarget: (target) => Boolean(target.closest(".tab-close")),
    setSuppressClickUntil: (value) => {
      suppressTabClickUntil = value;
    },
    onDragStateChange: (active, meta = {}) => {
      tabDragActive = active;
      if (!active && !meta.changed && pendingTabState) {
        const next = pendingTabState;
        pendingTabState = null;
        applyTabState(next);
      }
    },
    onCommitOrder: async (nextOrder) => {
      pendingTabState = null;
      try {
        const order = nextOrder.map((item) => Number(item)).filter((item) => Number.isFinite(item));
        if (order.length !== state.tabs.length) {
          return;
        }

        const result = await api.reorderTabs(order);
        if (!result?.ok) {
          const fresh = await api.getState();
          applyTabState(fresh);
          return;
        }

        const fresh = await api.getState();
        applyTabState(fresh);
      } catch (error) {
        console.error("Failed to reorder tabs:", error);
      }
    },
    onDropEnd: (changed) => {
      if (changed) {
        pendingTabState = null;
      }
    }
  });

  bindUnifiedHorizontalReorder({
    container: elements.bookmarkList,
    itemSelector: ".bookmark-item",
    keyName: "url",
    ignoreTarget: () => false,
    setSuppressClickUntil: (value) => {
      suppressBookmarkClickUntil = value;
    },
    onDragStateChange: (active, meta = {}) => {
      bookmarkDragActive = active;
      if (!active && !meta.changed && pendingBookmarks) {
        const next = pendingBookmarks;
        pendingBookmarks = null;
        applyBookmarks(next);
      }
    },
    onCommitOrder: async (nextOrder) => {
      pendingBookmarks = null;
      try {
        const result = await api.reorderBookmarks(nextOrder);
        if (!result?.ok) {
          const list = await api.listBookmarks();
          applyBookmarks(list);
          return;
        }

        const list = await api.listBookmarks();
        applyBookmarks(list);
      } catch (error) {
        console.error("Failed to reorder bookmarks:", error);
      }
    },
    onDropEnd: (changed) => {
      if (changed) {
        pendingBookmarks = null;
      }
    }
  });
}

function setupIpcListeners() {
  api.onState((payload) => {
    if (tabDragActive) {
      pendingTabState = payload;
      return;
    }
    applyTabState(payload);
  });

  api.onBookmarks((payload) => {
    if (bookmarkDragActive) {
      pendingBookmarks = payload;
      return;
    }
    applyBookmarks(payload);
  });

  api.onSettings((payload) => {
    applySettings(payload);
  });

  api.onMenuCommand((payload) => {
    if (payload?.type === "focus-address") {
      focusAddressBar();
    }
  });
}

async function bootstrap() {
  setupBasicEvents();
  setupReorderControllers();
  setupIpcListeners();

  const [mainState, bookmarks] = await Promise.all([api.getState(), api.listBookmarks()]);
  applyTabState(mainState);
  applySettings(mainState);
  applyBookmarks(bookmarks);

  scheduleTopInsetSync();
}

bootstrap().catch((error) => {
  console.error("Failed to bootstrap renderer:", error);
});
