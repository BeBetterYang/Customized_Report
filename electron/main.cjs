const path = require("path");
const { constants } = require("fs");
const fs = require("fs/promises");
const { app, BrowserWindow, dialog } = require("electron");
const { startServer } = require("../server/index.js");

let mainWindow = null;
let localServer = null;

function getWebDistPath() {
  return path.join(__dirname, "..", "dist");
}

function getStateDir() {
  return path.join(app.getPath("userData"), "state");
}

function getDefaultStateDir() {
  return path.join(__dirname, "..", "default-state");
}

async function seedDefaultState() {
  const sourceDir = getDefaultStateDir();
  const targetDir = getStateDir();

  let entries = [];
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }

  await fs.mkdir(targetDir, { recursive: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const sourceFile = path.join(sourceDir, entry.name);
        const targetFile = path.join(targetDir, entry.name);
        try {
          await fs.copyFile(sourceFile, targetFile, constants.COPYFILE_EXCL);
        } catch (error) {
          if (!error || error.code !== "EEXIST") {
            throw error;
          }
        }
      }),
  );
}

async function ensureLocalServer() {
  if (localServer) return localServer;

  await seedDefaultState();

  localServer = await startServer({
    host: "127.0.0.1",
    port: 0,
    webDistPath: getWebDistPath(),
    stateDir: getStateDir(),
  });

  return localServer;
}

function getServerUrl(server) {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("无法获取本地服务地址。");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function createMainWindow() {
  const server = await ensureLocalServer();
  const appUrl = getServerUrl(server);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: "#f5f7fb",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(appUrl);
}

function closeLocalServer() {
  return new Promise((resolve) => {
    if (!localServer) {
      resolve();
      return;
    }

    localServer.close(() => {
      localServer = null;
      resolve();
    });
  });
}

async function showStartupError(error) {
  const detail = error?.stack || String(error);
  console.error(detail);
  dialog.showErrorBox("启动失败", detail);
  await closeLocalServer();
  app.exit(1);
}

app.whenReady().then(createMainWindow).catch(showStartupError);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow().catch(showStartupError);
  }
});

app.on("window-all-closed", async () => {
  await closeLocalServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  await closeLocalServer();
});
