const { app, BrowserWindow, Menu, dialog } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { pathToFileURL } = require("node:url");

const smoke = process.argv.includes("--mesa-smoke-test");
let child;
let window;
let quitting = false;
let stopped = false;
let data;
let token;
let origin;
let updater;
let updateReady = false;
let cleanForUpdate = false;
let checkingUpdate = false;
const smokeDir = smoke && process.env.MESA_SMOKE_DIR;
if (smokeDir) app.setPath("userData", smokeDir);
const diagnosticDir = path.join(app.getPath("userData"), smoke ? "smoke-runtime" : "runtime", "logs");
fs.mkdirSync(diagnosticDir, { recursive: true });
function report(message) {
  try {
    fs.appendFileSync(path.join(diagnosticDir, "desktop-main.log"), new Date().toISOString() + " " + message + "\n");
  } catch {
    // Diagnostics must never prevent startup.
  }
}
report("Desktop main started: " + app.getVersion());
process.on("uncaughtException", (error) => fail(error));
process.on("unhandledRejection", (error) => fail(error instanceof Error ? error : new Error(String(error))));


function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function secret() {
  const file = path.join(data, "encryption-key.txt");
  if (!fs.existsSync(file)) fs.writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  const value = fs.readFileSync(file, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid local encryption key. Restore your backup.");
  return value;
}

function schedulerEnabled() {
  const file = path.join(data, "desktop-settings.json");
  if (!fs.existsSync(file)) fs.writeFileSync(file, '{"schedulerEnabled":false}\n', { flag: "wx" });
  return JSON.parse(fs.readFileSync(file, "utf8")).schedulerEnabled === true && !smoke;
}

async function startBackend() {
  const runtime = path.join(process.resourcesPath, "mesa-runtime");
  data = path.join(app.getPath("userData"), smoke ? "smoke-runtime" : "runtime");
  fs.mkdirSync(path.join(data, "logs"), { recursive: true });
  token = randomBytes(32).toString("hex");
  const port = await reservePort();
  origin = "http://127.0.0.1:" + port;
  const log = path.join(data, "logs", "desktop-backend.log");
  if (fs.existsSync(log) && fs.statSync(log).size > 10 * 1024 * 1024) {
    fs.rmSync(log + ".previous", { force: true });
    fs.renameSync(log, log + ".previous");
  }
  const loader = path.join(runtime, "node_modules", "tsx", "dist", "loader.mjs");
  if (!fs.existsSync(loader)) throw new Error("Backend dependency missing: " + loader);
  report("Starting bundled backend: " + runtime);
  const fd = fs.openSync(log, "a");
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    APP_DATA_DIR: data,
    DB_PATH: path.join(data, "mesa.sqlite"),
    LOGS_DIR: path.join(data, "logs"),
    OAUTH_ENCRYPTION_SECRET: secret(),
    API_AUTH_TOKEN: token,
    ALLOWED_ORIGINS: origin,
    ALLOWED_ORIGIN_SUFFIXES: "",
    MESA_LOCAL_MODE: "true",
    MESA_SCHEDULER_ENABLED: String(schedulerEnabled()),
    AUTO_UPDATE_ENABLED: "0",
    UPDATE_CHECK_ENABLED: "0",
    CLAW_MIGRATION_V1_0_5_DONE: "1",
    NODE_ENV: "production",
    TSX_TSCONFIG_PATH: path.join(runtime, "tsconfig.json"),
  };
  for (const key of ["NODE_OPTIONS", "VITE_DEV", "ELECTRON_RUN_AS_NODE", "OPENCLAW_CONFIG", "INBOX_WEBHOOK_SECRET"]) {
    delete env[key];
  }
  try {
    child = spawn(
      path.join(runtime, "node.exe"),
      ["--import", pathToFileURL(loader).href,
        path.join(runtime, "desktop-backend.mjs")],
      { cwd: data, env, windowsHide: true, stdio: ["ignore", fd, fd, "ipc"] },
    );
  } finally {
    fs.closeSync(fd);
  }
  child.on("message", (message) => {
    if (message?.type === "mesa-shutdown-status") cleanForUpdate = message.idle === true;
  });
  child.once("error", (error) => {
    report("Backend spawn error: " + error.stack);
    stopped = true;
    if (!quitting) fail(error);
  });
  child.once("exit", (code) => {
    report("Backend exit: " + code);
    stopped = true;
    if (!quitting) fail(new Error("Local backend stopped: " + code));
  });
  for (let i = 0; i < 120 && !stopped; i++) {
    try {
      const response = await fetch(origin + "/api/agents", {
        headers: { authorization: "Bearer " + token },
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        const body = await response.json();
        if (Array.isArray(body.agents)) {
          report("Backend ready: " + body.agents.length + " agents");
          return body.agents;
        }
      }
    } catch {
      // Wait for the local server to start.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Local server did not start. See desktop-backend.log.");
}

function setupMenu() {
  if (smoke) return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Mesa",
        submenu: [
          {
            label: "Iniciar com o Windows",
            type: "checkbox",
            checked: app.getLoginItemSettings().openAtLogin,
            click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
          },
          {
            label: updateReady ? "Atualização pronta — instalar ao fechar sem tarefas ativas" : "Verificar atualizações",
            click: () => {
              if (!updateReady) void checkUpdates(true);
            },
          },
          { type: "separator" },
          { label: "Fechar Mesa", accelerator: "Alt+F4", click: () => app.quit() },
        ],
      },
      { label: "Visualizar", submenu: [{ role: "reload" }, { role: "togglefullscreen" }] },
    ]),
  );
}

async function checkUpdates(manual = false) {
  if (!updater || checkingUpdate || updateReady || quitting) return;
  checkingUpdate = true;
  try {
    const result = await updater.checkForUpdates();
    if (manual && !result?.isUpdateAvailable && !updateReady) {
      await dialog.showMessageBox({ message: "Nenhuma atualização disponível." });
    }
  } catch (error) {
    report("Update check: " + String(error));
    if (manual) await dialog.showMessageBox({ message: "Não foi possível verificar atualizações agora." });
  } finally {
    checkingUpdate = false;
  }
}

function configureUpdates() {
  if (!app.isPackaged || smoke) return;
  try {
    updater = require("electron-updater").autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on("error", (error) => report("Updater: " + String(error)));
    updater.on("update-downloaded", () => {
      updateReady = true;
      report("Update ready; waiting for clean idle shutdown.");
      setupMenu();
    });
    void checkUpdates();
    setInterval(() => void checkUpdates(), 60 * 60 * 1000).unref();
  } catch (error) {
    report("Updater initialization: " + String(error));
  }
}

async function openWindow() {
  report("Creating desktop window");
  window = new BrowserWindow({
    title: "Mesa de Operações V2",
    width: 1440,
    height: 900,
    minWidth: 850,
    minHeight: 600,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      partition: "mesa-desktop",
    },
  });
  const session = window.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  await session.cookies.set({ url: origin, name: "claw_session", value: token, httpOnly: true, sameSite: "strict" });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin !== origin) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, target) => {
    if (new URL(target).origin !== origin) event.preventDefault();
  });
  window.webContents.on("render-process-gone", (_event, details) => report("Renderer gone: " + JSON.stringify(details)));
  await window.loadURL(origin);
  report("Desktop page loaded");
  if (!smoke) window.show();
}

function fail(error) {
  if (quitting) return;
  report("Startup failure: " + String(error?.stack || error));
  if (!smoke) {
    dialog.showErrorBox("Mesa de Operações V2", String(error?.message || error) + "\nLogs: " + diagnosticDir);
  } else {
    console.error(error);
  }
  shutdown(1);
}

function shutdown(code = 0) {
  if (quitting) return;
  quitting = true;
  if (!child || stopped) return app.exit(code);
  const timer = setTimeout(() => {
    try {
      child.kill();
    } catch {
      // Already stopped.
    }
    app.exit(code || 1);
  }, 8000);
  child.once("exit", (backendCode) => {
    clearTimeout(timer);
    if (code === 0 && backendCode === 0 && updateReady && cleanForUpdate && updater && !smoke) {
      report("Applying downloaded update after clean idle shutdown.");
      try {
        updater.quitAndInstall(true, false);
        return;
      } catch (error) {
        report("Update install failed: " + String(error));
      }
    }
    if (updateReady && !cleanForUpdate) report("Update deferred: backend was not confirmed idle.");
    app.exit(code || (smoke && backendCode !== 0 ? 1 : 0));
  });
  if (child.connected) {
    child.send({ type: "mesa-shutdown" }, (error) => {
      if (error) child.kill();
    });
  } else {
    child.kill();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (!quitting) {
      event.preventDefault();
      shutdown();
    }
  });
  app.whenReady().then(async () => {
    const agents = await startBackend();
    setupMenu();
    await openWindow();
    configureUpdates();
    if (smoke) {
      if (agents.length !== 8) throw new Error("Expected eight initial agents.");
      let rendered = false;
      for (let i = 0; i < 40 && !rendered; i++) {
        rendered = await window.webContents.executeJavaScript("Boolean(document.querySelector('#root')?.childElementCount)");
        if (!rendered) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!rendered) throw new Error("UI did not render.");
      report("Smoke test passed.");
      shutdown();
    }
  }).catch(fail);
}
