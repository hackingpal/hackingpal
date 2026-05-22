// Preload runs in the renderer process *before* the page loads.
// Right now we don't need to expose anything — all backend traffic goes
// through plain fetch() to http://127.0.0.1:8765. When we add features that
// need privileged Electron APIs (e.g. native notifications, file dialogs),
// we'll expose them via contextBridge here.

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("nt", {
  platform: process.platform,
});
