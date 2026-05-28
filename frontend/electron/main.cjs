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
  // Pin to loopback. The backend refuses to start on a wildcard host (see
  // backend/main.py), but we set NT_BACKEND_HOST explicitly here so the
  // packaged app never depends on the default.
  backendProc = spawn(binPath, [], {
    env: {
      ...process.env,
      NT_BACKEND_HOST: "127.0.0.1",
      NT_BACKEND_PORT: String(BACKEND_PORT),
    },
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
  if (!backendProc || backendProc.killed) return;
  const proc = backendProc;
  backendProc = null;
  console.log("[network-tools] killing backend pid", proc.pid);
  try { proc.kill("SIGTERM"); } catch (e) { /* ignore */ }
  // If SIGTERM doesn't reap the process within 3s (uvicorn lifespan shutdown
  // can stall on a stuck WS handler), escalate to SIGKILL so app quit
  // doesn't hang.
  setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) {
      console.log("[network-tools] backend didn't exit on SIGTERM — SIGKILL");
      try { proc.kill("SIGKILL"); } catch (e) { /* ignore */ }
    }
  }, 3000).unref?.();
}

function waitForHealth(timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const scheduleRetry = () => {
      if (Date.now() - start > timeoutMs) resolve(false);
      else setTimeout(tick, 200);
    };
    const tick = () => {
      // On timeout we both call req.destroy() (which emits 'error') AND the
      // timeout handler fires — without a per-tick guard that would queue
      // multiple retries and pile parallel requests on top of each other.
      let settled = false;
      const finishTick = (success) => {
        if (settled) return;
        settled = true;
        if (success) resolve(true);
        else scheduleRetry();
      };
      const req = http.get({ host: "127.0.0.1", port: BACKEND_PORT,
                              path: "/health", timeout: 1000 }, (res) => {
        const ok = res.statusCode === 200;
        res.resume(); // drain so the socket can be reused / closed cleanly
        finishTick(ok);
      });
      req.on("error", () => finishTick(false));
      req.on("timeout", () => { req.destroy(); finishTick(false); });
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

  // Title-bar treatment per OS:
  //   darwin → hiddenInset (native traffic lights overlay the sidebar header)
  //   win32  → hidden + titleBarOverlay (native min/max/close in top-right,
  //            our app paints the rest of the bar; height matches App.tsx h-7)
  //   linux  → default (keep the native title bar; many WMs need it)
  const titleBar = process.platform === "darwin"
    ? { titleBarStyle: "hiddenInset" }
    : process.platform === "win32"
      ? {
          titleBarStyle: "hidden",
          titleBarOverlay: {
            color: "#0a0d12",       // matches backgroundColor / bg-base
            symbolColor: "#a0a0a0", // matches ink-muted
            height: 28,             // matches the h-7 strip in App.tsx
          },
        }
      : {};

  const win = new BrowserWindow({
    width:  1100,
    height: 760,
    minWidth:  860,
    minHeight: 580,
    backgroundColor: "#0a0d12",
    ...titleBar,
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

// Single-instance lock — second launch would otherwise spawn a second sidecar
// that fails to bind to 8765 and silently leaves the user with a broken
// window. Instead, focus the existing window and exit the new process.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length) {
      const win = wins[0];
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(createWindow);
}

app.on("before-quit", killBackend);
app.on("will-quit",   killBackend);

app.on("window-all-closed", () => {
  killBackend();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
