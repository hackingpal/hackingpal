// Electron main process.
//
// Dev:  user runs `npm run dev:all`; the backend is started manually in
//       another terminal (or by concurrently). Electron just loads Vite.
// Prod: this process spawns the PyInstaller-bundled Python sidecar, waits
//       for /health, then opens the window. Kills the sidecar on quit.

const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const isDev = process.env.NODE_ENV === "development";
const BACKEND_PORT = parseInt(process.env.NT_BACKEND_PORT || "8765", 10);

let backendProc = null;

function backendBinaryPath() {
  // electron-builder unpacks `extraResources` under process.resourcesPath.
  // PyInstaller's onedir layout: a folder containing the launcher binary and
  // a sibling `_internal/` directory of bundled deps. PyInstaller appends .exe
  // on Windows.
  const name = process.platform === "win32"
    ? "network-tools-backend.exe"
    : "network-tools-backend";
  return path.join(process.resourcesPath, "backend", "network-tools-backend", name);
}

function spawnBackend() {
  const binPath = backendBinaryPath();
  console.log("[network-tools] spawning backend:", binPath);
  backendProc = spawn(binPath, [], {
    env: { ...process.env, NT_BACKEND_PORT: String(BACKEND_PORT) },
    stdio: "ignore",
  });
  backendProc.on("exit", (code) => {
    console.log("[network-tools] backend exited with code", code);
    backendProc = null;
  });
  backendProc.on("error", (err) => {
    console.error("[network-tools] backend error:", err);
  });
}

function killBackend() {
  if (backendProc && !backendProc.killed) {
    console.log("[network-tools] killing backend pid", backendProc.pid);
    try { backendProc.kill("SIGTERM"); } catch (e) { /* ignore */ }
    backendProc = null;
  }
}

function waitForHealth(timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port: BACKEND_PORT,
                              path: "/health", timeout: 1000 }, (res) => {
        if (res.statusCode === 200) { resolve(true); return; }
        res.resume();
        retry();
      });
      req.on("error", retry);
      req.on("timeout", () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) resolve(false);
      else setTimeout(tick, 200);
    };
    tick();
  });
}

async function createWindow() {
  if (app.isPackaged) {
    spawnBackend();
    // Don't block window creation on the health check — the PyInstaller
    // backend takes several seconds to boot, and the renderer already has
    // a backend-disconnected indicator that polls until it's ready.
    waitForHealth().then((ok) => {
      if (!ok) console.error("[network-tools] backend never became ready");
    });
  }

  const win = new BrowserWindow({
    width:  1100,
    height: 760,
    minWidth:  860,
    minHeight: 580,
    backgroundColor: "#0a0d12",
    // hiddenInset gives macOS the traffic-light inset; on Win/Linux it has
    // no effect, so the default native title bar shows up.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    if (process.env.NT_DEVTOOLS === "1") {
      win.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("before-quit", killBackend);
app.on("will-quit",   killBackend);

app.on("window-all-closed", () => {
  killBackend();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
