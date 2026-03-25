const { contextBridge, ipcRenderer } = require("electron");

function makeListener(channel, handler) {
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

contextBridge.exposeInMainWorld("browserApi", {
  getState: () => ipcRenderer.invoke("state:get"),
  createTab: (target) => ipcRenderer.invoke("tab:create", target),
  selectTab: (tabId) => ipcRenderer.invoke("tab:select", tabId),
  closeTab: (tabId) => ipcRenderer.invoke("tab:close", tabId),
  reorderTabs: (nextOrder) => ipcRenderer.invoke("tab:reorder", nextOrder),
  setTopInset: (topInset) => ipcRenderer.invoke("layout:setTopInset", topInset),
  navigate: (target) => ipcRenderer.invoke("nav:go", target),
  navAction: (action) => ipcRenderer.invoke("nav:action", action),
  addBookmark: () => ipcRenderer.invoke("bookmark:add"),
  removeBookmark: (url) => ipcRenderer.invoke("bookmark:remove", url),
  openBookmark: (url) => ipcRenderer.invoke("bookmark:open", url),
  reorderBookmarks: (nextOrder) => ipcRenderer.invoke("bookmark:reorder", nextOrder),
  listBookmarks: () => ipcRenderer.invoke("bookmark:list"),
  listExtensions: () => ipcRenderer.invoke("extension:list"),
  pickAndLoadExtension: () => ipcRenderer.invoke("extension:pickAndLoad"),
  unloadExtension: (extensionId) => ipcRenderer.invoke("extension:unload", extensionId),
  showSettingsMenu: (anchor) => ipcRenderer.invoke("menu:showSettings", anchor),
  quitApp: () => ipcRenderer.invoke("app:quit"),
  onState: (handler) => makeListener("tabs:state", handler),
  onBookmarks: (handler) => makeListener("bookmarks:updated", handler),
  onMenuCommand: (handler) => makeListener("menu:command", handler),
  onSettings: (handler) => makeListener("settings:updated", handler)
});
