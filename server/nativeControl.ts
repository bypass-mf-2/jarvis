/**
 * Native desktop UI control — keyboard, mouse, focused-window operations.
 *
 * Backed by @nut-tree-fork/nut-js. Wrapped here because the raw API is verbose
 * and unsafe for an LLM to call directly. Every operation here goes through
 * a safety gate:
 *   - Rate limit (max 30 actions / 60 sec, configurable via NATIVE_RATE_LIMIT)
 *   - Blocklist of "dangerous" key combos and apps (extensible)
 *   - Audit log to logs/native-control.jsonl so you can see what JARVIS did
 *
 * Companion to:
 *   - server/systemControl.ts — open/close apps, run shell commands
 *   - server/navigator.ts — Playwright browser automation
 *
 * What this DOESN'T solve yet:
 *   - Per-app credential storage (deferred to v17 — encrypted vault)
 *   - Visual feedback overlay showing what JARVIS is about to click
 *   - OCR-driven element targeting (e.g. "click the Save button" — would
 *     need to combine our existing OCR with mouse coords)
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger.js";

// nut-js loaded lazily so a server boot doesn't pay the import cost just to
// stand up routes. The native binding is ~1 sec to load on Windows.
type NutJs = typeof import("@nut-tree-fork/nut-js");
let _nut: NutJs | null = null;
async function nut(): Promise<NutJs> {
  if (_nut) return _nut;
  const mod = await import("@nut-tree-fork/nut-js");
  // Default mouse speed is 1000 px/sec — feels slow. Bump to 2500 so multi-
  // click sequences don't take forever, while still being visibly humanish.
  mod.mouse.config.mouseSpeed = 2500;
  // Default keyboard delay is 0 ms between presses — too fast for some apps
  // (Word, Photoshop) which drop chars. 5 ms is plenty for everything.
  mod.keyboard.config.autoDelayMs = 5;
  _nut = mod;
  return mod;
}

// ── Safety gates ───────────────────────────────────────────────────────────

/** Hard ceiling on actions/second so a runaway plan can't spam-click. */
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = Number(process.env.NATIVE_RATE_LIMIT ?? 30);
const _recentActions: number[] = [];

function rateCheck(): { ok: true } | { ok: false; reason: string } {
  const now = Date.now();
  while (_recentActions.length && now - _recentActions[0] > RATE_WINDOW_MS) {
    _recentActions.shift();
  }
  if (_recentActions.length >= RATE_LIMIT) {
    return { ok: false, reason: `Rate limit: ${RATE_LIMIT} actions / 60s exceeded` };
  }
  _recentActions.push(now);
  return { ok: true };
}

/** Key combos that should never be sent — system-destructive or session-killing. */
const BLOCKED_COMBOS = [
  "alt+f4-system", // Alt+F4 is fine on most apps but blocked at the desktop
  "ctrl+alt+delete",
  "win+l", // lock screen
  "win+x",
];

/** Apps whose windows JARVIS may not touch — can be extended via env. */
function blockedApps(): string[] {
  const env = process.env.NATIVE_BLOCKED_APPS ?? "";
  return env.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// ── Audit log ──────────────────────────────────────────────────────────────

const AUDIT_LOG_PATH = path.join(process.cwd(), "logs", "native-control.jsonl");
function appendAudit(action: string, args: Record<string, unknown>, ok: boolean, message?: string): void {
  try {
    if (!fs.existsSync(path.dirname(AUDIT_LOG_PATH))) {
      fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    }
    const line = JSON.stringify({ at: Date.now(), action, args, ok, message });
    fs.appendFileSync(AUDIT_LOG_PATH, line + "\n");
  } catch { /* never block on audit failure */ }
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface ControlResult {
  ok: boolean;
  message: string;
}

/** Type a string at the current focus. */
export async function typeText(text: string): Promise<ControlResult> {
  const gate = rateCheck();
  if (!gate.ok) {
    appendAudit("typeText", { textLen: text.length }, false, gate.reason);
    return { ok: false, message: gate.reason };
  }
  if (text.length > 4000) {
    return { ok: false, message: "text too long (>4000 chars)" };
  }
  try {
    const n = await nut();
    await n.keyboard.type(text);
    appendAudit("typeText", { textLen: text.length, preview: text.slice(0, 80) }, true);
    return { ok: true, message: `Typed ${text.length} chars` };
  } catch (err) {
    const msg = String(err);
    appendAudit("typeText", { textLen: text.length }, false, msg);
    return { ok: false, message: msg };
  }
}

/**
 * Press a key combo (e.g. ["LeftControl", "S"] for Ctrl+S).
 * Key names follow nut-js's Key enum — see https://github.com/nut-tree/nut.js
 */
export async function pressKeys(keys: string[]): Promise<ControlResult> {
  const gate = rateCheck();
  if (!gate.ok) {
    appendAudit("pressKeys", { keys }, false, gate.reason);
    return { ok: false, message: gate.reason };
  }
  const combo = keys.map((k) => k.toLowerCase()).join("+");
  if (BLOCKED_COMBOS.includes(combo)) {
    appendAudit("pressKeys", { keys }, false, "blocked combo");
    return { ok: false, message: `Combo blocked: ${combo}` };
  }
  try {
    const n = await nut();
    // Resolve string names to nut-js Key enum values
    const resolved = keys.map((k) => {
      const enumValue = (n.Key as unknown as Record<string, number>)[k];
      if (enumValue === undefined) throw new Error(`Unknown key: "${k}". Try one of: ${Object.keys(n.Key).slice(0, 20).join(", ")}…`);
      return enumValue;
    });
    await n.keyboard.pressKey(...resolved);
    await n.keyboard.releaseKey(...resolved);
    appendAudit("pressKeys", { keys }, true);
    return { ok: true, message: `Pressed ${keys.join("+")}` };
  } catch (err) {
    const msg = String(err);
    appendAudit("pressKeys", { keys }, false, msg);
    return { ok: false, message: msg };
  }
}

export interface ClickOptions {
  x: number;
  y: number;
  button?: "left" | "right" | "middle";
  doubleClick?: boolean;
}

/** Click at absolute screen coordinates. */
export async function clickAt(opts: ClickOptions): Promise<ControlResult> {
  const gate = rateCheck();
  if (!gate.ok) {
    appendAudit("clickAt", opts as unknown as Record<string, unknown>, false, gate.reason);
    return { ok: false, message: gate.reason };
  }
  try {
    const n = await nut();
    await n.mouse.move(n.straightTo(new n.Point(opts.x, opts.y)));
    const button =
      opts.button === "right"
        ? n.Button.RIGHT
        : opts.button === "middle"
          ? n.Button.MIDDLE
          : n.Button.LEFT;
    if (opts.doubleClick) {
      await n.mouse.doubleClick(button);
    } else {
      await n.mouse.click(button);
    }
    appendAudit("clickAt", opts as unknown as Record<string, unknown>, true);
    return { ok: true, message: `${opts.doubleClick ? "Double-clicked" : "Clicked"} (${opts.x}, ${opts.y})` };
  } catch (err) {
    const msg = String(err);
    appendAudit("clickAt", opts as unknown as Record<string, unknown>, false, msg);
    return { ok: false, message: msg };
  }
}

/**
 * Bring a window to the foreground by title substring match. Returns true if
 * a matching window was focused. Title match is case-insensitive substring,
 * so "chrome" matches "Project — Google Chrome".
 */
export async function focusWindow(titleSubstring: string): Promise<ControlResult> {
  const gate = rateCheck();
  if (!gate.ok) return { ok: false, message: gate.reason };
  const lowerNeedle = titleSubstring.toLowerCase();
  if (blockedApps().some((b) => lowerNeedle.includes(b))) {
    appendAudit("focusWindow", { title: titleSubstring }, false, "blocked app");
    return { ok: false, message: `App blocked by NATIVE_BLOCKED_APPS: ${titleSubstring}` };
  }
  try {
    const n = await nut();
    const windows = await n.getWindows();
    for (const win of windows) {
      const title = await win.getTitle();
      if (title.toLowerCase().includes(lowerNeedle)) {
        await win.focus();
        appendAudit("focusWindow", { title: titleSubstring, matched: title }, true);
        return { ok: true, message: `Focused: ${title}` };
      }
    }
    appendAudit("focusWindow", { title: titleSubstring }, false, "no match");
    return { ok: false, message: `No window matched "${titleSubstring}"` };
  } catch (err) {
    const msg = String(err);
    appendAudit("focusWindow", { title: titleSubstring }, false, msg);
    return { ok: false, message: msg };
  }
}

/** Get the title of every visible window. Useful for "what's open?" queries. */
export async function listWindowTitles(): Promise<string[]> {
  try {
    const n = await nut();
    const windows = await n.getWindows();
    const titles = await Promise.all(windows.map((w) => w.getTitle().catch(() => "")));
    return titles.filter((t) => t && t.length > 0);
  } catch (err) {
    await logger.warn("nativeControl", `listWindowTitles failed: ${err}`);
    return [];
  }
}

/** Title of the currently-focused window, or null if none. */
export async function getActiveWindowTitle(): Promise<string | null> {
  try {
    const n = await nut();
    const win = await n.getActiveWindow();
    return await win.getTitle();
  } catch (err) {
    await logger.warn("nativeControl", `getActiveWindowTitle failed: ${err}`);
    return null;
  }
}

/**
 * Find pixel coordinates of an image needle within a screenshot. The nut-js
 * API for this varies by version (used to be `screen.find(path)`, became
 * `screen.find(imageResource(path))` in 4.x). Returning null until we settle
 * on the exact runtime version's signature — caller can fall back to
 * coordinate-based clicks via clickAt for now.
 */
export async function findOnScreen(_imagePath: string): Promise<{ x: number; y: number } | null> {
  await logger.info("nativeControl", "findOnScreen not yet wired — use clickAt with explicit coords");
  return null;
}

// ── Audit reader (for the UI eventually) ───────────────────────────────────

export interface AuditEntry {
  at: number;
  action: string;
  args: Record<string, unknown>;
  ok: boolean;
  message?: string;
}

export function readRecentAudit(limit = 50): AuditEntry[] {
  try {
    if (!fs.existsSync(AUDIT_LOG_PATH)) return [];
    const lines = fs.readFileSync(AUDIT_LOG_PATH, "utf-8").trim().split("\n");
    const tail = lines.slice(-limit);
    return tail
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is AuditEntry => x !== null);
  } catch {
    return [];
  }
}
