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
  };
  for (const key of ["NODE_OPTIONS", "VITE_DEV", "ELECTRON_RUN_AS_NODE", "OPENCLAW_CONFIG", "INBOX_WEBHOOK_SECRET"]) {
    delete env[key];
  }
  try {
    child = spawn(
      path.join(runtime, "node.exe"),
      ["--import", pathToFileURL(path.join(runtime, "node_modules", "tsx", "dist", "loader.mjs")).href,
        path.join(runtime, "desktop-backend.mjs")],
      { cwd: data, env, windowsHide: true, stdio: ["ignore", fd, fd, "ipc"] },
    );
  } finally {
    fs.closeSync(fd);
  }
  child.once("error", (error) => {
    stopped = true;
    if (!quitting) fail(error);
  });
  child.once("exit", (code) => {
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
        if (Array.isArray(body.agents)) return body.agents;
      }
    } catch {
      // Wait for the local server to start.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Local server did not start. See desktop-backend.log.");
}

function setupMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Mesa",
      submenu: [
        {
          label: "Iniciar com o Windows",
          type: "checkbox",
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
        },
        { type: "separator" },
        { label: "Fechar Mesa", accelerator: "Alt+F4", click: () => app.quit() },
      ],
    },
    { label: "Visualizar", submenu: [{ role: "reload" }, { role: "togglefullscreen" }] },
  ]));
}

async function openWindow() {
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
  await window.loadURL(origin);
  if (!smoke) window.show();
}

function fail(error) {
  if (quitting) return;
  if (!smoke) dialog.showErrorBox("Mesa de Operações V2", String(error.message || error) +
    "\nLogs: " + (data ? path.join(data, "logs") : app.getPath("userData")));
  else console.error(error);
  shutdown(1);
}

function shutdown(code = 0) {
  if (quitting) return;
  quitting = true;
  if (!child || stopped) return app.exit(code);
  const timer = setTimeout(() => {
    try { child.kill(); } catch { /* already stopped */ }
    app.exit(code || 1);
  }, 8000);
  child.once("exit", () => {
    clearTimeout(timer);
    app.exit(code);
  });
  if (child.connected) child.send({ type: "mesa-shutdown" }, (error) => {
    if (error) child.kill();
  });
  else child.kill();
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
    if (smoke) {
      if (agents.length !== 8) throw new Error("Expected eight initial agents.");
      const rendered = await window.webContents.executeJavaScript(
        "document.querySelector('#root') !== null && document.title.length > 0",
      );
      if (!rendered) throw new Error("UI document did not load.");
      shutdown();
    }
  }).catch(fail);
}
