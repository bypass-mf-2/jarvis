const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const net = require("net");

let mainWindow = null;
let tray = null;
let serverProcess = null;
let serverPort = 3000;

// ── Find available port ──────────────────────────────────────────────────────
function findAvailablePort(start = 3000) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(start, () => {
      server.close(() => resolve(start));
    });
    server.on("error", () => {
      resolve(findAvailablePort(start + 1));
    });
  });
}

// ── Start the dev server ─────────────────────────────────────────────────────
async function startServer() {
  serverPort = await findAvailablePort(3000);
  const projectRoot = path.join(__dirname, "..");

  // Determine the correct command based on OS
  const isWin = process.platform === "win32";
  const npx = isWin ? "npx.cmd" : "npx";

  serverProcess = spawn(npx, ["cross-env", `NODE_ENV=development`, `PORT=${serverPort}`, "tsx", "watch", "server/_core/index.ts"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(serverPort) },
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (data) => {
    console.log(`[SERVER] ${data.toString().trim()}`);
  });

  serverProcess.stderr.on("data", (data) => {
    console.error(`[SERVER] ${data.toString().trim()}`);
  });

  serverProcess.on("close", (code) => {
    console.log(`[SERVER] Process exited with code ${code}`);
  });

  // Wait for server to be ready
  await waitForServer(serverPort);
}

function waitForServer(port, retries = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const client = net.createConnection({ port }, () => {
        client.end();
        resolve();
      });
      client.on("error", () => {
        attempts++;
        if (attempts >= retries) {
          reject(new Error("Server failed to start"));
        } else {
          setTimeout(check, 1000);
        }
      });
    };
    check();
  });
}

// ── Create main window ───────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "J.A.R.V.I.S",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#0a0e1a",
    titleBarStyle: "hiddenInset",
    frame: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("close", (e) => {
    // Minimize to tray instead of closing
    if (tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── System tray ──────────────────────────────────────────────────────────────
function createTray() {
  try {
    const iconPath = path.join(__dirname, "icon.png");
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show JARVIS",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: "separator" },
      {
        label: "Open in Browser",
        click: () => shell.openExternal(`http://localhost:${serverPort}`),
      },
      { type: "separator" },
      {
        label: "Quit JARVIS",
        click: () => {
          tray = null;
          if (serverProcess) serverProcess.kill();
          app.quit();
        },
      },
    ]);

    tray.setToolTip("J.A.R.V.I.S - AI Assistant");
    tray.setContextMenu(contextMenu);

    tray.on("double-click", () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err) {
    console.warn("Could not create tray icon:", err.message);
  }
}

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  console.log("Starting J.A.R.V.I.S...");

  try {
    await startServer();
    console.log(`Server running on port ${serverPort}`);
  } catch (err) {
    console.error("Failed to start server:", err.message);
    // Still try to open the window in case server is already running
  }

  createTray();
  createWindow();
});

app.on("window-all-closed", () => {
  // Don't quit on macOS when all windows are closed
  if (process.platform !== "darwin") {
    // Keep running in tray
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});
