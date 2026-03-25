const { app, BrowserWindow, BrowserView, Menu, clipboard, dialog, ipcMain, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const WINDOW_WIDTH = 1500;
const WINDOW_HEIGHT = 920;
const DEFAULT_TOP_INSET = 140;

const SEARCH_ENGINES = {
  bing: {
    label: "Bing",
    menuLabel: "必应 (Bing)",
    home: "https://cn.bing.com/",
    search: "https://cn.bing.com/search?q="
  },
  baidu: {
    label: "Baidu",
    menuLabel: "百度",
    home: "https://www.baidu.com/",
    search: "https://www.baidu.com/s?wd="
  },
  google: {
    label: "Google",
    menuLabel: "谷歌 (Google)",
    home: "https://www.google.com/",
    search: "https://www.google.com/search?q="
  },
  duckduckgo: {
    label: "DuckDuckGo",
    menuLabel: "DuckDuckGo",
    home: "https://duckduckgo.com/",
    search: "https://duckduckgo.com/?q="
  }
};

const DEFAULT_SEARCH_ENGINE_KEY = "bing";

let mainWindow = null;
let nextTabId = 1;
let activeTabId = null;
let topInset = DEFAULT_TOP_INSET;
const tabs = new Map();
let tabOrder = [];

let bookmarks = [];
let bookmarksFile = "";
let extensionsFile = "";
let extensionPaths = [];
let settingsFile = "";
let searchEngineKey = DEFAULT_SEARCH_ENGINE_KEY;

function ensureBookmarksLoaded() {
  if (!bookmarksFile) {
    bookmarksFile = path.join(app.getPath("userData"), "bookmarks.json");
  }

  try {
    const raw = fs.readFileSync(bookmarksFile, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      bookmarks = parsed
        .filter((item) => item && typeof item.url === "string")
        .map((item) => ({
          title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : item.url,
          url: item.url,
          favicon: typeof item.favicon === "string" ? item.favicon : ""
        }));
    }
  } catch {
    bookmarks = [];
  }
}

function getFallbackFavicon(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return `${parsed.origin}/favicon.ico`;
    }
  } catch {}
  return "";
}

function persistBookmarks() {
  try {
    fs.mkdirSync(path.dirname(bookmarksFile), { recursive: true });
    fs.writeFileSync(bookmarksFile, JSON.stringify(bookmarks, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to write bookmarks:", error);
  }
}

function ensureSettingsLoaded() {
  if (!settingsFile) {
    settingsFile = path.join(app.getPath("userData"), "settings.json");
  }

  try {
    const raw = fs.readFileSync(settingsFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.searchEngineKey === "string" && SEARCH_ENGINES[parsed.searchEngineKey]) {
      searchEngineKey = parsed.searchEngineKey;
    }
  } catch {
    searchEngineKey = DEFAULT_SEARCH_ENGINE_KEY;
  }
}

function persistSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(
      settingsFile,
      JSON.stringify(
        {
          searchEngineKey
        },
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    console.error("Failed to write settings:", error);
  }
}

function getCurrentSearchEngine() {
  return SEARCH_ENGINES[searchEngineKey] || SEARCH_ENGINES[DEFAULT_SEARCH_ENGINE_KEY];
}

function getCurrentHomePage() {
  return getCurrentSearchEngine().home;
}

function buildSearchUrl(query) {
  return `${getCurrentSearchEngine().search}${encodeURIComponent(query)}`;
}

function ensureExtensionsStoreLoaded() {
  if (!extensionsFile) {
    extensionsFile = path.join(app.getPath("userData"), "extensions.json");
  }

  try {
    const raw = fs.readFileSync(extensionsFile, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      extensionPaths = parsed.filter((item) => typeof item === "string").map((item) => path.resolve(item));
    }
  } catch {
    extensionPaths = [];
  }
}

function persistExtensions() {
  try {
    fs.mkdirSync(path.dirname(extensionsFile), { recursive: true });
    fs.writeFileSync(extensionsFile, JSON.stringify(extensionPaths, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to write extension store:", error);
  }
}

function getLoadedExtensions() {
  return session.defaultSession
    .getAllExtensions()
    .map((extension) => ({
      id: extension.id,
      name: extension.name,
      version: extension.version,
      path: extension.path
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function persistExtensionPath(extensionPath) {
  const resolved = path.resolve(extensionPath);
  if (!extensionPaths.includes(resolved)) {
    extensionPaths.push(resolved);
    persistExtensions();
  }
}

function removePersistedExtensionPath(extensionPath) {
  const resolved = path.resolve(extensionPath);
  const before = extensionPaths.length;
  extensionPaths = extensionPaths.filter((item) => path.resolve(item) !== resolved);
  if (extensionPaths.length !== before) {
    persistExtensions();
  }
}

async function loadExtensionFromDirectory(extensionDir, saveToStore = true) {
  if (!extensionDir || typeof extensionDir !== "string") {
    return { ok: false, reason: "Invalid extension directory" };
  }

  const resolvedDir = path.resolve(extensionDir);
  const manifestPath = path.join(resolvedDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, reason: "manifest.json not found in the selected folder" };
  }

  const existing = getLoadedExtensions().find((item) => path.resolve(item.path) === resolvedDir);
  if (existing) {
    if (saveToStore) {
      persistExtensionPath(resolvedDir);
    }
    return { ok: true, extension: existing, alreadyLoaded: true };
  }

  try {
    const extension = await session.defaultSession.loadExtension(resolvedDir, { allowFileAccess: true });
    if (saveToStore) {
      persistExtensionPath(resolvedDir);
    }
    return {
      ok: true,
      extension: {
        id: extension.id,
        name: extension.name,
        version: extension.version,
        path: extension.path
      }
    };
  } catch (error) {
    return { ok: false, reason: error.message || String(error) };
  }
}

async function loadPersistedExtensions() {
  if (!extensionPaths.length) {
    return;
  }

  const validPaths = [];
  for (const extensionPath of extensionPaths) {
    const resolved = path.resolve(extensionPath);
    if (!fs.existsSync(resolved)) {
      continue;
    }
    const result = await loadExtensionFromDirectory(resolved, false);
    if (result.ok) {
      validPaths.push(resolved);
    } else {
      console.error("Failed to load extension:", resolved, result.reason);
    }
  }
  extensionPaths = validPaths;
  persistExtensions();
}

async function unloadExtensionById(extensionId) {
  const target = getLoadedExtensions().find((item) => item.id === extensionId);
  if (!target) {
    return { ok: false, reason: "Extension not found" };
  }

  try {
    session.defaultSession.removeExtension(extensionId);
    if (target.path) {
      removePersistedExtensionPath(target.path);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message || String(error) };
  }
}

function looksLikeLocalHost(input) {
  return /^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(?:\/.*)?$/i.test(input);
}

function looksLikeUrl(input) {
  return /^[a-zA-Z\d.-]+\.[a-zA-Z]{2,}(?::\d+)?(?:\/.*)?$/.test(input) || looksLikeLocalHost(input);
}

function normalizeTarget(rawInput) {
  const input = `${rawInput || ""}`.trim();
  if (!input) {
    return getCurrentHomePage();
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(input)) {
    try {
      const parsed = new URL(input);
      if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "file:") {
        return input;
      }
      return buildSearchUrl(input);
    } catch {
      return buildSearchUrl(input);
    }
  }

  if (looksLikeUrl(input)) {
    const protocol = looksLikeLocalHost(input) ? "http://" : "https://";
    try {
      return new URL(`${protocol}${input}`).toString();
    } catch {
      return buildSearchUrl(input);
    }
  }

  return buildSearchUrl(input);
}

function normalizeTopInset(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return topInset;
  }
  return Math.max(100, Math.min(400, Math.round(value)));
}

function getTab(tabId) {
  return tabs.get(tabId) || null;
}

function getActiveTab() {
  return getTab(activeTabId);
}

function allTabStates() {
  return tabOrder
    .map((id) => tabs.get(id))
    .filter(Boolean)
    .map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      favicon: tab.favicon || getFallbackFavicon(tab.url),
      loading: tab.loading,
      active: tab.id === activeTabId,
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward
    }));
}

function pushBookmarks() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("bookmarks:updated", bookmarks);
}

function pushSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const engine = getCurrentSearchEngine();
  mainWindow.webContents.send("settings:updated", {
    searchEngineKey,
    searchEngineLabel: engine.label
  });
}

function pushState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("tabs:state", {
    tabs: allTabStates(),
    activeTabId
  });
}

function updateTabFromWebContents(tab) {
  if (!tab || tab.view.webContents.isDestroyed()) {
    return;
  }

  const wc = tab.view.webContents;
  tab.url = wc.getURL() || tab.url || getCurrentHomePage();
  tab.title = wc.getTitle() || tab.title || "New Tab";
  tab.loading = wc.isLoading();
  tab.canGoBack = wc.canGoBack();
  tab.canGoForward = wc.canGoForward();
}

function syncActiveViewBounds() {
  const tab = getActiveTab();
  if (!mainWindow || !tab) {
    return;
  }

  const [width, height] = mainWindow.getContentSize();
  tab.view.setBounds({
    x: 0,
    y: topInset,
    width,
    height: Math.max(0, height - topInset)
  });
}

function showPageContextMenu(tab, params) {
  if (!mainWindow || mainWindow.isDestroyed() || !tab) {
    return;
  }

  const wc = tab.view.webContents;
  const hasLink = Boolean(params.linkURL);
  const hasSelection = Boolean(params.selectionText);
  const canCopy = params.editFlags?.canCopy || hasSelection;
  const canCut = params.editFlags?.canCut;
  const canPaste = params.editFlags?.canPaste;
  const canSelectAll = params.editFlags?.canSelectAll;

  const template = [
    {
      label: "Back",
      enabled: wc.canGoBack(),
      click: () => wc.goBack()
    },
    {
      label: "Forward",
      enabled: wc.canGoForward(),
      click: () => wc.goForward()
    },
    {
      label: "Reload",
      click: () => wc.reload()
    },
    { type: "separator" },
    {
      label: "New Tab",
      click: () => createTab("", true)
    },
    {
      label: "Bookmark This Page",
      click: () => addBookmarkFromActiveTab()
    }
  ];

  if (hasLink) {
    template.push(
      { type: "separator" },
      {
        label: "Open Link in New Tab",
        click: () => createTab(params.linkURL, true)
      },
      {
        label: "Copy Link Address",
        click: () => clipboard.writeText(params.linkURL)
      }
    );
  }

  template.push(
    { type: "separator" },
    {
      label: "Cut",
      enabled: Boolean(canCut),
      click: () => wc.cut()
    },
    {
      label: "Copy",
      enabled: Boolean(canCopy),
      click: () => wc.copy()
    },
    {
      label: "Paste",
      enabled: Boolean(canPaste),
      click: () => wc.paste()
    },
    {
      label: "Select All",
      enabled: Boolean(canSelectAll),
      click: () => wc.selectAll()
    },
    { type: "separator" },
    {
      label: "View Page Source",
      click: () => createTab(`view-source:${tab.url}`, true)
    },
    {
      label: "Inspect",
      click: () => {
        wc.inspectElement(params.x, params.y);
        if (!wc.isDevToolsOpened()) {
          wc.openDevTools({ mode: "detach" });
        }
      }
    }
  );

  const menu = Menu.buildFromTemplate(template);
  menu.popup({
    window: mainWindow
  });
}

function registerViewEvents(tab) {
  const wc = tab.view.webContents;

  wc.on("did-start-loading", () => {
    updateTabFromWebContents(tab);
    pushState();
  });

  wc.on("did-stop-loading", () => {
    updateTabFromWebContents(tab);
    pushState();
  });

  wc.on("did-navigate", () => {
    updateTabFromWebContents(tab);
    pushState();
  });

  wc.on("did-navigate-in-page", () => {
    updateTabFromWebContents(tab);
    pushState();
  });

  wc.on("page-title-updated", (event) => {
    event.preventDefault();
    updateTabFromWebContents(tab);
    pushState();
  });

  wc.on("page-favicon-updated", (_event, favicons) => {
    if (Array.isArray(favicons) && favicons.length > 0) {
      tab.favicon = favicons[0];
    }
    pushState();
  });

  wc.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) {
      return;
    }
    tab.title = "Load Failed";
    tab.url = validatedURL || tab.url;
    tab.loading = false;
    console.error("Navigation failed:", errorCode, errorDescription, validatedURL);
    pushState();
  });

  wc.on("context-menu", (_event, params) => {
    showPageContextMenu(tab, params);
  });

  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      createTab(url, true);
    } else {
      shell.openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });
}

function attachTab(tabId) {
  const tab = getTab(tabId);
  if (!mainWindow || !tab) {
    return;
  }

  const currentViews = mainWindow.getBrowserViews();
  for (const view of currentViews) {
    mainWindow.removeBrowserView(view);
  }
  mainWindow.addBrowserView(tab.view);
  activeTabId = tabId;
  syncActiveViewBounds();
  tab.view.webContents.focus();
  updateTabFromWebContents(tab);
  pushState();
}

function createTab(initialTarget, makeActive) {
  const target = normalizeTarget(initialTarget || getCurrentHomePage());
  const id = nextTabId++;

  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const tab = {
    id,
    view,
    title: "New Tab",
    url: target,
    favicon: getFallbackFavicon(target),
    loading: true,
    canGoBack: false,
    canGoForward: false
  };

  tabs.set(id, tab);
  tabOrder.push(id);
  registerViewEvents(tab);

  view.webContents
    .loadURL(target)
    .then(() => {
      updateTabFromWebContents(tab);
      pushState();
    })
    .catch((error) => {
      tab.loading = false;
      tab.title = "Load Failed";
      console.error("Failed to load URL:", target, error);
      pushState();
    });

  if (makeActive || activeTabId === null) {
    attachTab(id);
  } else {
    pushState();
  }

  return id;
}

function closeTab(tabId) {
  const tab = getTab(tabId);
  if (!tab) {
    return;
  }

  const closeIndex = tabOrder.indexOf(tabId);
  if (closeIndex >= 0) {
    tabOrder.splice(closeIndex, 1);
  }

  if (mainWindow) {
    const allViews = mainWindow.getBrowserViews();
    if (allViews.includes(tab.view)) {
      mainWindow.removeBrowserView(tab.view);
    }
  }

  if (!tab.view.webContents.isDestroyed()) {
    tab.view.webContents.destroy();
  }
  tabs.delete(tabId);

  if (tabOrder.length === 0) {
    activeTabId = null;
    createTab(getCurrentHomePage(), true);
    return;
  }

  if (activeTabId === tabId) {
    const fallbackIndex = closeIndex >= 0 ? Math.min(closeIndex, tabOrder.length - 1) : tabOrder.length - 1;
    attachTab(tabOrder[fallbackIndex]);
    return;
  }

  pushState();
}

function reorderTabs(nextOrder) {
  if (!Array.isArray(nextOrder) || nextOrder.length !== tabOrder.length) {
    return false;
  }

  const current = new Set(tabOrder);
  const unique = new Set();
  for (const tabId of nextOrder) {
    if (!current.has(tabId) || unique.has(tabId)) {
      return false;
    }
    unique.add(tabId);
  }

  tabOrder = [...nextOrder];
  pushState();
  return true;
}

function navigateActiveTab(rawInput) {
  const tab = getActiveTab();
  if (!tab) {
    return;
  }
  const target = normalizeTarget(rawInput);
  tab.view.webContents.loadURL(target).catch((error) => {
    console.error("Navigation error:", error);
  });
}

function addBookmarkFromActiveTab() {
  const tab = getActiveTab();
  if (!tab || !tab.url) {
    return { ok: false, reason: "No active tab" };
  }

  const exists = bookmarks.some((item) => item.url === tab.url);
  if (exists) {
    return { ok: false, reason: "Already bookmarked" };
  }

  bookmarks.push({
    title: tab.title || tab.url,
    url: tab.url,
    favicon: tab.favicon || getFallbackFavicon(tab.url)
  });
  persistBookmarks();
  pushBookmarks();
  return { ok: true };
}

function toggleBookmarkFromActiveTab() {
  const tab = getActiveTab();
  if (!tab || !tab.url) {
    return { ok: false, reason: "No active tab" };
  }

  const existing = bookmarks.find((item) => item.url === tab.url);
  if (existing) {
    return removeBookmark(tab.url);
  }
  return addBookmarkFromActiveTab();
}

function removeBookmark(url) {
  const before = bookmarks.length;
  bookmarks = bookmarks.filter((item) => item.url !== url);
  if (bookmarks.length !== before) {
    persistBookmarks();
    pushBookmarks();
    return { ok: true };
  }
  return { ok: false, reason: "Bookmark not found" };
}

function reorderBookmarks(nextOrder) {
  if (!Array.isArray(nextOrder) || nextOrder.length !== bookmarks.length) {
    return { ok: false, reason: "Invalid bookmark order" };
  }

  const currentUrls = bookmarks.map((item) => item.url);
  const currentSet = new Set(currentUrls);
  const nextSet = new Set(nextOrder);
  if (currentSet.size !== nextSet.size || currentSet.size !== bookmarks.length) {
    return { ok: false, reason: "Bookmark set mismatch" };
  }
  for (const url of nextOrder) {
    if (!currentSet.has(url)) {
      return { ok: false, reason: "Bookmark set mismatch" };
    }
  }

  const byUrl = new Map(bookmarks.map((item) => [item.url, item]));
  bookmarks = nextOrder.map((url) => byUrl.get(url)).filter(Boolean);
  persistBookmarks();
  pushBookmarks();
  return { ok: true };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 980,
    minHeight: 680,
    title: "Nebula Browser",
    backgroundColor: "#0f1624",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.once("did-finish-load", () => {
    pushState();
    pushBookmarks();
    pushSettings();
  });
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.on("resize", syncActiveViewBounds);
  mainWindow.on("maximize", syncActiveViewBounds);
  mainWindow.on("unmaximize", syncActiveViewBounds);
  mainWindow.on("closed", () => {
    mainWindow = null;
    tabs.clear();
    tabOrder = [];
    activeTabId = null;
  });

  createTab(getCurrentHomePage(), true);
}

function notifyRendererCommand(type) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("menu:command", { type });
}

function buildExtensionSubmenu() {
  const loaded = getLoadedExtensions();
  if (loaded.length === 0) {
    return [{ label: "暂无已加载扩展", enabled: false }];
  }

  return loaded.map((extension) => ({
    label: `${extension.name} (${extension.version})`,
    submenu: [
      {
        label: "卸载",
        click: async () => {
          const result = await unloadExtensionById(extension.id);
          if (!result.ok) {
            dialog.showErrorBox("卸载扩展失败", result.reason || "未知错误");
          }
        }
      }
    ]
  }));
}

function buildSearchEngineSubmenu() {
  return Object.entries(SEARCH_ENGINES).map(([key, engine]) => ({
    label: engine.menuLabel,
    type: "radio",
    checked: key === searchEngineKey,
    click: () => {
      searchEngineKey = key;
      persistSettings();
      warmupHomeConnection();
      pushSettings();
    }
  }));
}

function showSettingsMenu(anchor) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, reason: "主窗口不可用" };
  }

  const activeTab = getActiveTab();
  const hasActiveTab = Boolean(activeTab);
  const isBookmarked = hasActiveTab && bookmarks.some((item) => item.url === activeTab.url);

  const x = Number.isFinite(anchor?.x) ? Math.max(0, Math.round(anchor.x)) : 0;
  const y = Number.isFinite(anchor?.y) ? Math.max(0, Math.round(anchor.y)) : 0;

  const menu = Menu.buildFromTemplate([
    {
      label: "新建标签页",
      click: () => createTab("", true)
    },
    {
      label: "关闭当前标签页",
      enabled: hasActiveTab,
      click: () => {
        if (hasActiveTab) {
          closeTab(activeTab.id);
        }
      }
    },
    { type: "separator" },
    {
      label: "聚焦地址栏",
      click: () => notifyRendererCommand("focus-address")
    },
    {
      label: isBookmarked ? "移除书签" : "添加书签",
      enabled: hasActiveTab,
      click: () => {
        if (hasActiveTab) {
          toggleBookmarkFromActiveTab();
        }
      }
    },
    {
      label: "刷新页面",
      enabled: hasActiveTab,
      click: () => {
        const tab = getActiveTab();
        if (tab) {
          tab.view.webContents.reload();
        }
      }
    },
    {
      label: "打开主页",
      enabled: hasActiveTab,
      click: () => {
        const tab = getActiveTab();
        if (tab) {
          tab.view.webContents.loadURL(getCurrentHomePage());
        }
      }
    },
    { type: "separator" },
    {
      label: "搜索引擎",
      submenu: buildSearchEngineSubmenu()
    },
    { type: "separator" },
    {
      label: "加载 Chrome 扩展",
      click: async () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return;
        }
        const selection = await dialog.showOpenDialog(mainWindow, {
          title: "选择 Chrome 扩展目录",
          properties: ["openDirectory", "dontAddToRecent"]
        });
        if (selection.canceled || selection.filePaths.length === 0) {
          return;
        }
        const result = await loadExtensionFromDirectory(selection.filePaths[0], true);
        if (!result.ok && !result.canceled) {
          dialog.showErrorBox("加载扩展失败", result.reason || "未知错误");
        }
      }
    },
    {
      label: "已加载扩展",
      submenu: buildExtensionSubmenu()
    },
    { type: "separator" },
    {
      label: "退出浏览器",
      click: () => app.quit()
    }
  ]);

  menu.popup({
    window: mainWindow,
    x,
    y
  });

  return { ok: true };
}

function installIpc() {
  ipcMain.handle("state:get", () => ({
    tabs: allTabStates(),
    activeTabId,
    searchEngineKey,
    searchEngineLabel: getCurrentSearchEngine().label
  }));

  ipcMain.handle("tab:create", (_event, initialTarget) => {
    createTab(initialTarget || getCurrentHomePage(), true);
    return { ok: true };
  });

  ipcMain.handle("tab:select", (_event, tabId) => {
    if (tabs.has(tabId)) {
      attachTab(tabId);
    }
    return { ok: true };
  });

  ipcMain.handle("tab:close", (_event, tabId) => {
    closeTab(tabId);
    return { ok: true };
  });

  ipcMain.handle("tab:reorder", (_event, nextOrder) => ({
    ok: reorderTabs(nextOrder)
  }));

  ipcMain.handle("layout:setTopInset", (_event, nextTopInset) => {
    topInset = normalizeTopInset(nextTopInset);
    syncActiveViewBounds();
    return { ok: true };
  });

  ipcMain.handle("nav:go", (_event, target) => {
    navigateActiveTab(target);
    return { ok: true };
  });

  ipcMain.handle("nav:action", (_event, action) => {
    const tab = getActiveTab();
    if (!tab) {
      return { ok: false, reason: "No active tab" };
    }

    const wc = tab.view.webContents;
    switch (action) {
      case "back":
        if (wc.canGoBack()) {
          wc.goBack();
        }
        break;
      case "forward":
        if (wc.canGoForward()) {
          wc.goForward();
        }
        break;
      case "reload":
        wc.reload();
        break;
      case "home":
        wc.loadURL(getCurrentHomePage());
        break;
      case "stop":
        wc.stop();
        break;
      case "devtools":
        if (wc.isDevToolsOpened()) {
          wc.closeDevTools();
        } else {
          wc.openDevTools({ mode: "detach" });
        }
        break;
      default:
        return { ok: false, reason: "Unknown action" };
    }
    return { ok: true };
  });

  ipcMain.handle("bookmark:add", () => addBookmarkFromActiveTab());

  ipcMain.handle("bookmark:remove", (_event, url) => removeBookmark(url));

  ipcMain.handle("bookmark:open", (_event, url) => {
    createTab(url, true);
    return { ok: true };
  });

  ipcMain.handle("bookmark:reorder", (_event, nextOrder) => reorderBookmarks(nextOrder));

  ipcMain.handle("bookmark:list", () => bookmarks);

  ipcMain.handle("extension:list", () => ({
    ok: true,
    extensions: getLoadedExtensions()
  }));

  ipcMain.handle("extension:pickAndLoad", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, reason: "Main window unavailable" };
    }

    const selection = await dialog.showOpenDialog(mainWindow, {
      title: "选择 Chrome 扩展目录",
      properties: ["openDirectory", "dontAddToRecent"]
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    return loadExtensionFromDirectory(selection.filePaths[0], true);
  });

  ipcMain.handle("extension:unload", (_event, extensionId) => unloadExtensionById(extensionId));

  ipcMain.handle("menu:showSettings", (_event, anchor) => showSettingsMenu(anchor));

  ipcMain.handle("app:quit", () => {
    app.quit();
    return { ok: true };
  });
}

function warmupHomeConnection() {
  try {
    if (session.defaultSession && typeof session.defaultSession.preconnect === "function") {
      session.defaultSession.preconnect({
        url: getCurrentHomePage(),
        numSockets: 6
      });
    }
  } catch (error) {
    console.error("Failed to warm up home connection:", error);
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ensureBookmarksLoaded();
  ensureSettingsLoaded();
  ensureExtensionsStoreLoaded();
  warmupHomeConnection();
  installIpc();
  createMainWindow();

  // Load persisted extensions in background so first paint is faster.
  loadPersistedExtensions().catch((error) => {
    console.error("Failed to restore extensions:", error);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
