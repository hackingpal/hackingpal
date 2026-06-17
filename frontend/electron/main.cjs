// Electron main process.
//
// Dev:  user runs `npm run dev:all`; the backend is started manually in
//       another terminal (or by concurrently). Electron just loads Vite.
// Prod: this process spawns the PyInstaller-bundled Python sidecar, waits
//       for /health, then opens the window. Kills the sidecar on quit.

const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const { autoUpdater } = require("electron-updater");

const isDev = process.env.NODE_ENV === "development";
const BACKEND_PORT = parseInt(process.env.NT_BACKEND_PORT || "8765", 10);

// In dev mode the OS dock + menu bar would otherwise read the Electron binary
// name ("Electron"). Setting it before app initialisation makes macOS / Linux
// show "MyHackingPal" everywhere it would normally show the launcher name.
// In packaged builds this is already correct via Info.plist's CFBundleName,
// but setting it twice is harmless and keeps both paths consistent.
app.setName("MyHackingPal");

// Same story for the dock icon — `electron .` would otherwise show the
// Electron lozenge. Use the bundled PNG (works cross-platform; .icns isn't
// supported by Dock.setIcon).
if (isDev && process.platform === "darwin" && app.dock) {
  try {
    app.dock.setIcon(path.join(__dirname, "..", "build", "icon.png"));
  } catch (e) {
    console.warn("[network-tools] dock.setIcon failed:", e?.message ?? e);
  }
}

app.setAboutPanelOptions({
  applicationName: "MyHackingPal",
  applicationVersion: app.getVersion(),
  copyright: "© MyHackingPal contributors",
});

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

function configureAutoUpdater() {
  // electron-updater reads publish config from package.json's `build` block
  // (provider: github, owner/repo). Skipped in dev — there's no installed
  // app to update.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => {
    // Likely causes: no network, repo unreachable, or — on macOS — the
    // unsigned bundle can't be replaced. Log and move on; the user will
    // see a "BACKEND UNREACHABLE"-style state only if the actual app is
    // broken, not because we failed to check for an update.
    console.warn("[network-tools] autoUpdater error:", err?.message ?? err);
  });
  autoUpdater.on("update-available", (info) => {
    console.log("[network-tools] update available:", info?.version);
  });
  autoUpdater.on("update-downloaded", (info) => {
    console.log("[network-tools] update downloaded:", info?.version,
                "— will install on next quit");
  });

  // Check shortly after launch so the renderer + sidecar finish booting
  // first. Then re-check every 6h to catch long-running sessions.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn("[network-tools] checkForUpdates rejected:",
                   err?.message ?? err);
    });
  }, 10_000);
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => { /* logged via 'error' */ });
  }, 6 * 60 * 60 * 1000).unref?.();
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
    configureAutoUpdater();
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
    title: "MyHackingPal",
    width:  1100,
    height: 760,
    minWidth:  860,
    minHeight: 580,
    backgroundColor: "#0a0a0f",  // matches --bg-base in the new design system
    ...titleBar,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Linux + Windows: the OS title bar shows the document title, not the app
  // name. Pin it so window switchers / taskbar entries read "MyHackingPal".
  win.on("page-title-updated", (e) => e.preventDefault());
  win.setTitle("MyHackingPal");

  // Hand any window.open(http(s)://...) call off to the OS default browser
  // instead of spawning a chromeless Electron BrowserWindow. The Labs "Open ↗"
  // button relies on this; without it, lab UIs render inside a blank Electron
  // popup with no devtools / address bar.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        shell.openExternal(url);
      }
    } catch (e) { /* malformed URL — drop it */ }
    return { action: "deny" };
  });
  // Same treatment for in-page navigation that would replace the renderer
  // (e.g. accidental <a> click without target=_blank): keep the SPA mounted
  // and bounce external URLs to the browser.
  win.webContents.on("will-navigate", (e, url) => {
    try {
      const parsed = new URL(url);
      const dev = isDev && parsed.host === "localhost:5173";
      if (!dev && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
        e.preventDefault();
        shell.openExternal(url);
      }
    } catch (e2) { /* malformed — let Electron handle */ }
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
