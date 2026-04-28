/**
 * v16 Electron main process — the desktop host for the wake sequence.
 *
 * Responsibilities:
 *   - Create the overlay window (frameless, always-on-top, transparent)
 *   - Register the global hotkey (default: Ctrl+Shift+J)
 *   - System tray icon with enable/disable toggles
 *   - IPC handlers: fetch briefing from v15, proxy TTS, expose audio path
 *   - Fire the wake event when any trigger activates
 *
 * Does NOT:
 *   - Capture the microphone (that's the renderer's job — Web Audio API
 *     needs a browser context)
 *   - Play audio (also renderer — <audio> element with direct volume
 *     control for the ducking dance)
 *   - Import v15 modules directly (it talks to the v15 HTTP server)
 */

import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain, screen, desktopCapturer, clipboard, shell } from "electron";
import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { IPC_CHANNELS, type WakeEvent, type DismissEvent, type ClapEvent, type V16Panel } from "./types.js";

// ── State ────────────────────────────────────────────────────────────────────
// Two windows, deliberately:
//   - overlayWindow: the wake popup. Frameless glass, always-on-top, transient.
//   - panelWindow:   the real-window panels. Normal frame, resizable, taskbar.
// Sharing a single window meant panels inherited the always-on-top + frameless
// behavior, which made them annoying to use alongside other apps.
let overlayWindow: BrowserWindow | null = null;
let panelWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let micEnabled = false; // clap listener off by default; user opts in via tray
let wakeWordEnabled = false; // "Hey JARVIS" listener off by default; opt-in via tray
let ambientRecallEnabled = false; // off by default; user opts in via tray (privacy-sensitive)
let ambientRecallTimer: ReturnType<typeof setInterval> | null = null;
const AMBIENT_RECALL_INTERVAL_MS = 10 * 60_000; // 10 minutes
/** Tracks the panel the renderer is currently showing. Used to decide whether
 *  blur should auto-hide the window — wake overlays auto-hide; settings/
 *  workflow panels stay open even if focus moves elsewhere. */
let currentPanel: V16Panel = "idle";
const HOTKEY = "CommandOrControl+Shift+J";
const JARVIS_SERVER_URL = process.env.JARVIS_SERVER_URL ?? "http://localhost:3000";

/** Project root — where the v15 server's package.json lives. */
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
/** Tracks the spawned v15 server, if v16 launched one. Null otherwise. */
let v15Process: ChildProcess | null = null;
/** Whether a spawn is in flight — prevents racing wakes from spawning twice. */
let v15Starting: Promise<{ alreadyUp: boolean; spawned: boolean }> | null = null;

// ── v15 server lifecycle ────────────────────────────────────────────────────
// "Hey JARVIS" only feels magical if it works whether or not the server is up.
// v16 detects v15 and spawns it as a child process if needed. If the user is
// already running `pnpm dev` in another terminal, we detect localhost:3000 is
// reachable and skip the spawn.

async function isServerUp(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(JARVIS_SERVER_URL, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status > 0; // any HTTP response = process is alive and answering
  } catch {
    return false;
  }
}

/** Resolve when localhost:3000 answers, polling every 500ms up to timeoutMs. */
async function waitForServerUp(timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerUp(1500)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Make sure the v15 server is running. Returns:
 *   { alreadyUp: true,  spawned: false }   — was already running, did nothing
 *   { alreadyUp: false, spawned: true }    — we just started it, it's now up
 * Throws if spawn or readiness times out.
 *
 * Concurrent calls share the same in-flight spawn promise — a wake-word fire
 * during boot doesn't trigger a duplicate `pnpm dev`.
 */
async function ensureServerRunning(): Promise<{ alreadyUp: boolean; spawned: boolean }> {
  if (v15Starting) return v15Starting;

  v15Starting = (async () => {
    if (await isServerUp()) {
      return { alreadyUp: true, spawned: false };
    }
    console.log("[v16/main] v15 not reachable — spawning `pnpm dev` from", PROJECT_ROOT);
    // shell:true so Windows resolves pnpm.cmd correctly. Detached:false so the
    // child shares our session and gets cleaned up if Electron crashes hard.
    const proc = spawn("pnpm", ["dev"], {
      cwd: PROJECT_ROOT,
      shell: true,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    v15Process = proc;

    proc.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[v15] ${chunk}`));
    proc.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[v15-err] ${chunk}`));
    proc.on("exit", (code, signal) => {
      console.log(`[v16/main] v15 child exited code=${code} signal=${signal}`);
      v15Process = null;
    });

    const ready = await waitForServerUp(60_000);
    if (!ready) {
      // Spawn happened but server never answered. Kill the orphan so we don't
      // leave a hanging pnpm process behind.
      try { proc.kill(); } catch { /* ignore */ }
      v15Process = null;
      throw new Error("v15 didn't come online within 60 seconds");
    }
    console.log("[v16/main] ✓ v15 is up");
    return { alreadyUp: false, spawned: true };
  })();

  try {
    return await v15Starting;
  } finally {
    v15Starting = null;
  }
}

/** Stop a v15 we spawned. Best-effort; if the user has it in another terminal
 *  we never started it and won't kill it here. */
function stopSpawnedV15(): void {
  if (!v15Process) return;
  try {
    v15Process.kill();
  } catch (err) {
    console.warn("[v16/main] kill v15 failed:", (err as Error).message);
  }
  v15Process = null;
}

// ── Windows auto-start ──────────────────────────────────────────────────────
// Register v16 to launch on Windows login. Writes a Run-key entry in HKCU,
// no admin required. We pass --autostart so we know we're booted from login
// (we already start hidden in tray, but the flag is useful for debugging
// "is it running because the user clicked, or because Windows just logged in").

const AUTOSTART_FLAG = "--autostart";

function isAutoStartEnabled(): boolean {
  try {
    return app.getLoginItemSettings({ args: [AUTOSTART_FLAG] }).openAtLogin;
  } catch {
    return false;
  }
}

function setAutoStartEnabled(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: [AUTOSTART_FLAG],
  });
  refreshTrayMenu();
  console.log(`[v16/main] auto-start on Windows login: ${enabled ? "ON" : "OFF"}`);
}

/** Open the v15 web UI in the user's default browser. Spawns v15 first if
 *  it isn't already running, so the click "just works" from a cold tray. */
async function openJarvisInBrowser(): Promise<void> {
  try {
    if (!(await isServerUp())) {
      await ensureServerRunning();
    }
    await shell.openExternal(JARVIS_SERVER_URL);
  } catch (err) {
    console.warn("[v16/main] openJarvisInBrowser failed:", (err as Error).message);
  }
}

// ── Wake window ──────────────────────────────────────────────────────────────
// Real OS window — same affordances as the panel window (frame, resize, drag,
// normal taskbar entry). Used to be a frameless transparent always-on-top
// overlay; switched because it covered other apps the user was working with.
// Loaded once and reused: hide/show instead of destroy/recreate so wake
// latency stays low after the first fire.
function createOverlayWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay();
  const { width: screenW } = primary.workAreaSize;
  const overlayWidth = 720;
  const overlayHeight = 520;

  const win = new BrowserWindow({
    width: overlayWidth,
    height: overlayHeight,
    x: Math.round((screenW - overlayWidth) / 2),
    y: 80,
    minWidth: 480,
    minHeight: 360,
    frame: true,
    transparent: false,
    resizable: true,
    alwaysOnTop: true, // floats over other apps; minimize to send away
    skipTaskbar: false,
    show: false,
    focusable: true,
    title: "JARVIS · Wake",
    backgroundColor: "#0a0e1a",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // preload uses require("./types.js"); sandboxed preloads can't.
      preload: path.join(__dirname, "preload.js"),
      // Wake auto-fires audio without a click first; default Chromium policy
      // would reject .play() with NotAllowedError. v15 chat speaks because
      // there's always a user gesture before — wake doesn't have that luxury.
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  // Surface preload load failures — Electron silently swallows them otherwise.
  win.webContents.on("preload-error", (_event, preloadPath, err) => {
    console.error(`[v16/main] preload error at ${preloadPath}:`, err);
  });

  // Dev: load the Vite dev server. Prod: load the built renderer bundle.
  if (process.env.NODE_ENV === "development") {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "renderer", "index.html"));
  }

  // Hide on close instead of destroy so the next wake is instant.
  win.on("close", (e) => {
    if (!(app as any)._isQuitting) {
      e.preventDefault();
      win.hide();
      currentPanel = "idle";
    }
  });

  return win;
}

// ── Panel window ─────────────────────────────────────────────────────────────
// Real window. Frame, resize, minimize, maximize, taskbar entry — all the
// stuff users expect. Loaded lazily on first `openPanel` call so the wake
// overlay can boot fast without paying for two renderers.
function createPanelWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primary.workAreaSize;
  const w = Math.min(1000, screenW - 80);
  const h = Math.min(720, screenH - 80);

  const win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 480,
    minHeight: 360,
    x: Math.round((screenW - w) / 2),
    y: Math.round((screenH - h) / 2),
    frame: true,
    transparent: false,
    resizable: true,
    alwaysOnTop: true, // floats over other apps; minimize to send away
    skipTaskbar: false,
    show: false,
    title: "JARVIS",
    backgroundColor: "#0a0e1a", // matches the dark theme so flash-of-white is gone
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.webContents.on("preload-error", (_event, preloadPath, err) => {
    console.error(`[v16/main/panel] preload error at ${preloadPath}:`, err);
  });

  if (process.env.NODE_ENV === "development") {
    win.loadURL("http://localhost:5173?mode=panel");
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "renderer", "index.html"), {
      query: { mode: "panel" },
    });
  }

  // When user clicks the X, just hide. Re-opening from the tray re-shows the
  // same window with whatever panel was last selected — no cold-start penalty.
  win.on("close", (e) => {
    if (!(app as any)._isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  return win;
}

function ensurePanelWindow(): BrowserWindow {
  if (!panelWindow || panelWindow.isDestroyed()) {
    panelWindow = createPanelWindow();
  }
  return panelWindow;
}

/**
 * Open a specific panel in the dedicated panel window (separate from the
 * wake overlay). Lazily creates the panel window on first call.
 */
function openPanel(panel: V16Panel): void {
  currentPanel = panel;
  const win = ensurePanelWindow();
  // Wait for the renderer to be ready before pushing the setPanel event,
  // otherwise the first message gets lost on cold-start.
  const send = () => win.webContents.send(IPC_CHANNELS.setPanel, panel);
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", send);
  } else {
    send();
  }
  win.show();
  win.focus();
}

// ── Wake trigger ─────────────────────────────────────────────────────────────
// Every path (hotkey, clap, tray, manual) funnels through here. Centralized
// so the IPC + show/focus logic lives in one place.
async function triggerWake(source: WakeEvent["source"]): Promise<void> {
  if (!overlayWindow) return;

  // If v15 isn't reachable yet, spawn it. Show the window early so the user
  // gets visible feedback ("starting up...") instead of dead air during the
  // server boot. Briefing fetch happens after the server is confirmed up.
  let serverReady = await isServerUp();
  if (!serverReady) {
    currentPanel = "wake";
    overlayWindow.show();
    overlayWindow.focus();
    // Send a temporary "starting" event so the overlay shows something.
    overlayWindow.webContents.send(IPC_CHANNELS.wake, {
      source,
      briefing: {
        text: "Starting JARVIS… give me a moment.",
        tasks: [],
        events: [],
      },
      audioPath: null,
    } satisfies WakeEvent);

    try {
      await ensureServerRunning();
      serverReady = true;
    } catch (err) {
      console.warn("[v16/main] auto-spawn failed:", (err as Error).message);
      // Fall through — fetchBriefingFromServer will return empty briefing
      // and the overlay just shows that.
    }
  }

  const briefing = await fetchBriefingFromServer();
  const audioPath = getAudioPath();

  const event: WakeEvent = { source, briefing, audioPath };

  currentPanel = "wake";
  overlayWindow.show();
  overlayWindow.focus();
  overlayWindow.webContents.send(IPC_CHANNELS.wake, event);
}

// ── v15 server bridge (HTTP) ─────────────────────────────────────────────────
// Electron calls the running JARVIS server for real data. If the server is
// down, we still render an overlay — just with empty tasks/events.
async function fetchBriefingFromServer(): Promise<WakeEvent["briefing"]> {
  try {
    // 15s timeout because JARVIS post-migration startup or heavy embed-worker
    // load can briefly stall simple GETs. 3s was too aggressive — Electron
    // would show the "server appears to be offline" fallback even when the
    // server was fine, just busy.
    const res = await fetch(`${JARVIS_SERVER_URL}/api/v16/briefing`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as WakeEvent["briefing"];
  } catch (err) {
    console.warn("[v16/main] briefing fetch failed, using empty:", (err as Error).message);
    return {
      text: "Good morning, sir. The server appears to be offline — I'll catch you up once it's back.",
      tasks: [],
      events: [],
    };
  }
}

function getAudioPath(): string | null {
  const configured = process.env.WAKE_AUDIO_PATH;
  if (!configured) return null;
  if (!fs.existsSync(configured)) {
    console.warn(`[v16/main] WAKE_AUDIO_PATH points at a missing file: ${configured}`);
    return null;
  }
  return configured;
}

/**
 * Ask the v15 server to synthesize speech. Returns the full URL the renderer
 * can pass to an <audio> element — not a relative path, so the renderer
 * doesn't need to know JARVIS_SERVER_URL. Returns null on failure so the
 * renderer can gracefully skip audio playback.
 */
async function speakViaServer(text: string): Promise<string | null> {
  try {
    const res = await fetch(`${JARVIS_SERVER_URL}/api/v16/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { audioUrl?: string };
    if (!data.audioUrl) return null;
    // The v15 server serves generated audio under /api/generated-audio/:filename
    // which is what `audioUrl` already points at — just prefix with the host.
    return `${JARVIS_SERVER_URL}${data.audioUrl}`;
  } catch (err) {
    console.warn("[v16/main] TTS proxy failed:", (err as Error).message);
    return null;
  }
}

/**
 * Capture the focused screen via Electron's desktopCapturer, encode as
 * Base64 PNG, hand off to the v15 server's /api/v16/ocr endpoint
 * (tesseract.js WASM). Returns the extracted text, or empty string on
 * any failure. Used by per-app-memory + workflows that want to
 * "remember what's on screen now."
 *
 * Privacy note: the screenshot is captured locally, sent to the v15
 * server (also localhost), OCR'd locally via WASM, returned. The image
 * data never crosses the localhost boundary except as Base64 in an HTTP
 * request body to the same machine. No external upload.
 */
async function ocrFocusedScreen(): Promise<string> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1280, height: 720 },
    });
    if (sources.length === 0) return "";
    const png = sources[0].thumbnail.toPNG();
    const base64 = png.toString("base64");
    const res = await fetch(`${JARVIS_SERVER_URL}/api/v16/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ png: base64 }),
      signal: AbortSignal.timeout(60_000), // OCR can take 5-30s on first run (model load)
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { text?: string };
    return data.text ?? "";
  } catch (err) {
    console.warn("[v16/main] ocrFocusedScreen failed:", (err as Error).message);
    return "";
  }
}

/**
 * Capture the screen + ask the LLM a question about it. Renderer's
 * "ask about screen" button calls this. Heavy work — uses the v15
 * /api/v16/ask-about-screen endpoint which routes through smartChat.
 * Returns the LLM's answer or a graceful error message.
 */
async function askAboutScreenViaServer(question: string): Promise<string> {
  if (!question || question.trim().length < 3) {
    return "I need an actual question to answer.";
  }
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1600, height: 900 },
    });
    if (sources.length === 0) return "I couldn't capture the screen — desktop capturer returned no sources.";
    const png = sources[0].thumbnail.toPNG().toString("base64");
    const res = await fetch(`${JARVIS_SERVER_URL}/api/v16/ask-about-screen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ png, question: question.trim() }),
      signal: AbortSignal.timeout(120_000), // OCR + bigger LLM can take a minute
    });
    if (!res.ok) return `Server returned ${res.status} — check JARVIS logs.`;
    const data = (await res.json()) as { answer?: string };
    return data.answer ?? "(no answer returned)";
  } catch (err) {
    return `Failed: ${(err as Error).message}`;
  }
}

/**
 * Read the clipboard, hand to /api/v16/ask-about-code with a question.
 * Returns the LLM's answer or a graceful error message.
 */
async function askAboutCodeViaServer(question: string): Promise<string> {
  if (!question || question.trim().length < 3) return "I need an actual question.";
  try {
    const code = clipboard.readText();
    if (!code || code.trim().length < 4) {
      return "The clipboard is empty. Copy some code first, then ask.";
    }
    const res = await fetch(`${JARVIS_SERVER_URL}/api/v16/ask-about-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, question: question.trim() }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return `Server returned ${res.status}.`;
    const data = (await res.json()) as { answer?: string };
    return data.answer ?? "(no answer returned)";
  } catch (err) {
    return `Failed: ${(err as Error).message}`;
  }
}

// ── Shutdown ─────────────────────────────────────────────────────────────────
// v15 has its own shutdown story (terminal command, browser power button,
// POST /api/shutdown). v16 needs equivalents — closing windows just hides
// them, so the user has no obvious way to actually exit.

/** Quit just the v16 Electron shell. Leaves the v15 server running. */
function quitV16(): void {
  console.log("[v16/main] Quitting v16 shell (server stays running).");
  (app as any)._isQuitting = true;
  app.quit();
}

/** Quit the v16 Electron shell AND ask the v15 server to shut down. */
async function quitV16AndServer(): Promise<void> {
  console.log("[v16/main] Quitting v16 shell + asking v15 to shut down.");
  try {
    await fetch(`${JARVIS_SERVER_URL}/api/shutdown`, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    // Server may be down already, or didn't respond before quit. Either way
    // we still quit v16 — don't block the user.
    console.warn("[v16/main] shutdown POST failed (continuing with quit):", (err as Error).message);
  }
  // Belt-and-suspenders: if v16 launched v15 itself, kill the child too. The
  // shutdown POST should have already terminated it gracefully, but if it
  // didn't (POST timed out, hung handler), we don't want a zombie pnpm.
  stopSpawnedV15();
  (app as any)._isQuitting = true;
  app.quit();
}

// ── System tray ──────────────────────────────────────────────────────────────
function createTray(): void {
  try {
    const iconPath = path.join(__dirname, "..", "icon.png");
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    refreshTrayMenu();
    tray.setToolTip("JARVIS Falcon — double-clap or " + HOTKEY);
    tray.on("click", () => triggerWake("tray"));
  } catch (err) {
    console.warn("[v16/main] tray creation failed:", (err as Error).message);
  }
}

function refreshTrayMenu(): void {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: "Wake JARVIS now", click: () => triggerWake("tray") },
    { type: "separator" },
    { label: "Open Workflows", click: () => openPanel("workflows") },
    { label: "Open Memory", click: () => openPanel("memory") },
    { label: "Open Opinions", click: () => openPanel("opinions") },
    { label: "Open Phone Notifications", click: () => openPanel("phone") },
    { label: "Open Distillation", click: () => openPanel("distillation") },
    { label: "Open Cloudflare Tunnel", click: () => openPanel("tunnel") },
    { label: "Open Settings", click: () => openPanel("settings") },
    { type: "separator" },
    {
      label: wakeWordEnabled ? "Disable wake word (Hey JARVIS)" : "Enable wake word (Hey JARVIS)",
      click: () => setWakeWordEnabled(!wakeWordEnabled),
    },
    {
      label: micEnabled ? "Disable double-clap listener" : "Enable double-clap listener",
      click: () => setMicEnabled(!micEnabled),
    },
    {
      label: ambientRecallEnabled ? "Disable ambient recall" : "Enable ambient recall (10-min screen digests)",
      click: () => setAmbientRecallEnabled(!ambientRecallEnabled),
    },
    { type: "separator" },
    { label: "Open JARVIS in browser", click: () => openJarvisInBrowser() },
    {
      label: isAutoStartEnabled() ? "✓ Start with Windows" : "Start with Windows",
      click: () => setAutoStartEnabled(!isAutoStartEnabled()),
    },
    { type: "separator" },
    { label: `Hotkey: ${HOTKEY}`, enabled: false },
    { type: "separator" },
    { label: "Quit JARVIS (v16 only)", click: () => quitV16() },
    { label: "Quit JARVIS + shut down server", click: () => quitV16AndServer() },
  ]);
  tray.setContextMenu(menu);
}

function setMicEnabled(enabled: boolean): void {
  micEnabled = enabled;
  refreshTrayMenu();
  // Tell the (possibly-hidden) renderer to start/stop mic capture. The
  // renderer owns Web Audio API; the main process just toggles.
  if (overlayWindow) {
    overlayWindow.webContents.send(IPC_CHANNELS.micToggle, { enabled });
  }
}

/**
 * Toggle the wake-word listener. The browser SpeechRecognition runs in the
 * overlay window's renderer (which stays loaded but hidden between wakes).
 * When the renderer matches "Hey JARVIS" / "JARVIS …" it sends requestWake,
 * which we route through triggerWake("wake-word") below.
 */
function setWakeWordEnabled(enabled: boolean): void {
  wakeWordEnabled = enabled;
  refreshTrayMenu();
  if (overlayWindow) {
    overlayWindow.webContents.send(IPC_CHANNELS.setWakeWordEnabled, enabled);
  }
}

/**
 * Toggle ambient recall — opt-in periodic screen-capture + LLM digest
 * stored in per-app memory. PRIVACY-SENSITIVE: off by default, user
 * explicitly enables from tray, disabling stops the loop immediately.
 */
function setAmbientRecallEnabled(enabled: boolean): void {
  ambientRecallEnabled = enabled;
  refreshTrayMenu();
  if (ambientRecallTimer) {
    clearInterval(ambientRecallTimer);
    ambientRecallTimer = null;
  }
  if (enabled) {
    // First capture after 30s so the toggle isn't silent
    setTimeout(captureAmbientRecall, 30_000);
    ambientRecallTimer = setInterval(captureAmbientRecall, AMBIENT_RECALL_INTERVAL_MS);
    console.log(`[v16/main] Ambient recall ON — capturing every ${AMBIENT_RECALL_INTERVAL_MS / 60_000} min`);
  } else {
    console.log("[v16/main] Ambient recall OFF");
  }
}

async function captureAmbientRecall(): Promise<void> {
  if (!ambientRecallEnabled) return;
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1280, height: 720 },
    });
    if (sources.length === 0) return;
    const png = sources[0].thumbnail.toPNG().toString("base64");
    const res = await fetch(`${JARVIS_SERVER_URL}/api/v16/ambient-recall`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ png, appId: "ambient" }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { stored?: boolean; summary?: string };
      if (data.stored) {
        console.log(`[v16/main] Ambient recall: "${data.summary}"`);
      }
    }
  } catch (err) {
    // Best-effort; don't surface ambient errors
    console.warn("[v16/main] ambient recall capture failed:", (err as Error).message);
  }
}

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  overlayWindow = createOverlayWindow();
  createTray();

  // Global hotkey — fires from anywhere, even when the overlay isn't focused.
  const ok = globalShortcut.register(HOTKEY, () => triggerWake("hotkey"));
  if (!ok) {
    console.warn(`[v16/main] failed to register hotkey ${HOTKEY} (already in use?)`);
  }

  // IPC handlers — renderer → main
  ipcMain.on(IPC_CHANNELS.dismiss, (_e, event: DismissEvent) => {
    if (overlayWindow) overlayWindow.hide();
    currentPanel = "idle";
    void event; // telemetry-only for now
  });

  ipcMain.on(IPC_CHANNELS.clap, (_e, _event: ClapEvent) => {
    if (!micEnabled) return;
    triggerWake("clap");
  });

  ipcMain.on(IPC_CHANNELS.requestWake, () => {
    if (!wakeWordEnabled) return; // ignore stale fires from a disabled listener
    triggerWake("wake-word");
  });

  ipcMain.handle(IPC_CHANNELS.fetchBriefing, async () => fetchBriefingFromServer());
  ipcMain.handle(IPC_CHANNELS.getAudioPath, async () => getAudioPath());
  ipcMain.handle(IPC_CHANNELS.speak, async (_e, text: string) => speakViaServer(text));
  ipcMain.handle(IPC_CHANNELS.ocrFocused, async () => ocrFocusedScreen());
  ipcMain.handle(IPC_CHANNELS.askAboutScreen, async (_e, question: string) => askAboutScreenViaServer(question));
  ipcMain.handle(IPC_CHANNELS.readClipboard, async () => {
    try {
      return clipboard.readText();
    } catch {
      return "";
    }
  });
  ipcMain.handle(IPC_CHANNELS.askAboutCode, async (_e, question: string) => askAboutCodeViaServer(question));

  // Auto-wake is opt-in only. Set WAKE_AUTO_DEV=1 to fire the overlay 2s
  // after launch (useful for previewing the wake flow during development).
  // Default off — the overlay is always-on-top, so an unexpected fire is
  // disruptive while you're working in other windows.
  if (process.env.NODE_ENV === "development" && process.env.WAKE_AUTO_DEV === "1") {
    setTimeout(() => {
      console.log("[v16/main] WAKE_AUTO_DEV=1 — auto-firing wake event for dev preview");
      void triggerWake("manual");
    }, 2000);
  }
});

// Set the flag BEFORE windows get the close event, so close handlers
// (which preventDefault+hide during normal use) actually let windows close
// during a real quit. Without this, tray->Quit and Ctrl+C never terminate
// because every window cancels its own close.
app.on("before-quit", () => {
  (app as any)._isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (ambientRecallTimer) {
    clearInterval(ambientRecallTimer);
    ambientRecallTimer = null;
  }
});

app.on("window-all-closed", () => {
  // Keep running in tray — don't quit when the overlay closes.
});
