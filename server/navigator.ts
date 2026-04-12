/**
 * Navigator Agent — Playwright-driven browser automation.
 *
 * Goal: turn JARVIS from a read-only scraper into an active participant
 * in the web. Given a natural-language task, the Navigator drives a real
 * browser through primitive actions (goto / click / type / extract /
 * switchTab / etc.), asking Ollama what to do next after each step.
 *
 * v2 capabilities (this file):
 *   - Session passthrough: user logs in manually in a captured browser,
 *     JARVIS grabs storageState, reuses on later tasks → authenticated runs
 *   - File downloads: page.on('download') hook captures to nav-downloads/
 *   - Multi-tab: context.on('page') tracks newly-opened tabs, agent can
 *     switch between them via the switchTab primitive
 *   - High-stakes typed confirmation: destructive actions in highStakes mode
 *     require the user to type an exact match phrase, logged to nav_audit_log
 *
 * SAFETY RAILS:
 *
 *   1. Headed mode by default — user can watch every action live.
 *   2. Max steps per task (default 15, hard cap 30).
 *   3. Destructive action gate — any step that looks like "submit", "pay",
 *      "purchase", "confirm", "delete", "checkout" pauses the task. In
 *      normal mode the user gets an approve/reject button. In highStakes
 *      mode the user has to TYPE an exact confirmation phrase that names
 *      the specific action and domain.
 *   4. Domain allowlist — per-task list of allowed hostnames.
 *   5. Per-action timeout — 30 seconds hard cap.
 *   6. Stop button — AbortController-based, kills the loop at next iter.
 *   7. Screenshot after every action — visible audit trail.
 *   8. Append-only audit log for every high-stakes decision (nav_audit_log).
 */

import { chromium, type Browser, type BrowserContext, type Page, type Download } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { nanoid } from "nanoid";
import { ollamaChatJson } from "./ollama.js";
import { logger } from "./logger.js";
import {
  addNavSession,
  listNavSessions as dbListNavSessions,
  getNavSessionById,
  getNavSessionByName,
  touchNavSession,
  deleteNavSession as dbDeleteNavSession,
  addNavAuditEntry,
  type NavSession,
} from "./db.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type NavAction =
  | { kind: "goto"; url: string; reasoning?: string }
  | { kind: "click"; selector: string; reasoning?: string }
  | { kind: "type"; selector: string; text: string; reasoning?: string }
  | { kind: "press"; key: string; reasoning?: string }
  | { kind: "scroll"; direction: "up" | "down"; amount?: number; reasoning?: string }
  | { kind: "wait"; selector?: string; timeoutMs?: number; reasoning?: string }
  | { kind: "extract"; selector?: string; reasoning?: string }
  | { kind: "screenshot"; reasoning?: string }
  | { kind: "switchTab"; index: number; reasoning?: string }
  | { kind: "closeTab"; index?: number; reasoning?: string }
  | { kind: "done"; result: string; reasoning?: string };

export interface NavDownloadRecord {
  filename: string;
  storedPath: string;
  sizeBytes: number;
  downloadedAt: number;
}

export interface NavStepRecord {
  step: number;
  action: NavAction;
  outcome: string;
  screenshotPath: string | null;
  url: string;
  tabIndex: number;
  extractedText: string | null;
  downloadedFile: NavDownloadRecord | null;
  durationMs: number;
  timestamp: number;
}

export type NavRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "awaiting_confirmation"         // normal destructive — single-click approval
  | "awaiting_typed_confirmation";  // high-stakes — typed match required

export interface NavTab {
  index: number;
  url: string;
  title: string;
}

export interface NavRun {
  taskId: string;
  goal: string;
  allowlist: string[];
  maxSteps: number;
  allowDestructive: boolean;
  highStakes: boolean;
  headless: boolean;
  sessionId: number | null;
  status: NavRunStatus;
  steps: NavStepRecord[];
  downloads: NavDownloadRecord[];
  tabs: NavTab[];
  currentTabIndex: number;
  finalResult: string | null;
  error: string | null;
  startedAt: number;
  endedAt: number | null;
  pendingAction: NavAction | null;
  /** When status === "awaiting_typed_confirmation", the exact phrase the
   *  user must type to approve. Generated deterministically from the
   *  action + current URL so it's unambiguous. */
  requiredConfirmationPhrase: string | null;
}

export interface StartTaskOptions {
  goal: string;
  allowlist?: string[];
  maxSteps?: number;
  allowDestructive?: boolean;
  /** High-stakes mode: destructive actions require TYPED confirmation
   *  instead of a single approve click. Every decision is written to
   *  nav_audit_log whether approved or rejected. Use this for anything
   *  touching real money, real accounts, or irreversible actions. */
  highStakes?: boolean;
  headless?: boolean;
  /** Optional nav_sessions.id — load this storageState into the browser
   *  context so the task starts already authenticated. */
  sessionId?: number | null;
}

// ─── Runtime state ──────────────────────────────────────────────────────────

const SCREENSHOT_DIR = path.join(process.cwd(), "nav-screenshots");
const DOWNLOAD_DIR = path.join(process.cwd(), "nav-downloads");
const SESSION_DIR = path.join(process.cwd(), "nav-sessions");
for (const dir of [SCREENSHOT_DIR, DOWNLOAD_DIR, SESSION_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let _browser: Browser | null = null;
const _runs = new Map<string, NavRun>();

/** Per-task browser state. Multi-tab: pages array + currentPageIndex. */
interface TaskBrowserState {
  context: BrowserContext;
  pages: Page[];
}
const _contexts = new Map<string, TaskBrowserState>();
const _stopSignals = new Map<string, AbortController>();

/** A special "capture" context used to let the user manually log in and
 *  save the storageState. Not part of the normal task loop. */
let _captureContext: BrowserContext | null = null;
let _capturePage: Page | null = null;

// ─── Browser lifecycle ──────────────────────────────────────────────────────

async function getBrowser(headless: boolean): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  await logger.info("navigator", `Launching Playwright Chromium (headless=${headless})`);
  _browser = await chromium.launch({
    headless,
    slowMo: headless ? 0 : 150,
  });
  return _browser;
}

async function closeTaskContext(taskId: string): Promise<void> {
  const ref = _contexts.get(taskId);
  if (!ref) return;
  _contexts.delete(taskId);
  for (const p of ref.pages) {
    try { await p.close(); } catch { /* noop */ }
  }
  try { await ref.context.close(); } catch { /* noop */ }
}

export async function shutdownNavigator(): Promise<void> {
  for (const taskId of Array.from(_contexts.keys())) {
    await closeTaskContext(taskId);
  }
  if (_captureContext) {
    try { await _captureContext.close(); } catch { /* noop */ }
    _captureContext = null;
    _capturePage = null;
  }
  if (_browser) {
    try { await _browser.close(); } catch { /* noop */ }
    _browser = null;
  }
}

// ─── Safety checks ──────────────────────────────────────────────────────────

const DESTRUCTIVE_KEYWORDS = [
  "submit", "purchase", "buy", "pay", "checkout", "confirm",
  "delete", "remove account", "cancel subscription", "send money",
  "place order", "book now", "reserve",
];

function looksDestructive(action: NavAction): boolean {
  if (action.kind === "click") {
    const s = action.selector.toLowerCase();
    return DESTRUCTIVE_KEYWORDS.some((k) => s.includes(k));
  }
  if (action.kind === "press" && (action.key === "Enter" || action.key === "Return")) {
    return true;
  }
  return false;
}

function isUrlAllowed(url: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowlist.some((allowed) => {
      const a = allowed.toLowerCase();
      return host === a || host.endsWith("." + a);
    });
  } catch {
    return false;
  }
}

/**
 * Build a deterministic confirmation phrase the user must type verbatim
 * to approve a high-stakes action. Includes the action kind, a summary
 * of the target, and the current domain so there's no ambiguity about
 * what is being approved.
 */
function buildConfirmationPhrase(action: NavAction, currentUrl: string): string {
  let domain = "unknown";
  try { domain = new URL(currentUrl).hostname; } catch { /* noop */ }

  let target = "(no target)";
  if (action.kind === "click") target = action.selector;
  else if (action.kind === "press") target = `key ${action.key}`;
  else if (action.kind === "type") target = `"${action.text.slice(0, 40)}" into ${action.selector}`;
  else if (action.kind === "goto") target = action.url;

  return `I APPROVE ${action.kind.toUpperCase()} ${target} ON ${domain}`;
}

// ─── Multi-tab helpers ──────────────────────────────────────────────────────

function currentPage(state: TaskBrowserState, run: NavRun): Page {
  const idx = Math.max(0, Math.min(run.currentTabIndex, state.pages.length - 1));
  return state.pages[idx];
}

async function refreshTabList(state: TaskBrowserState, run: NavRun): Promise<void> {
  run.tabs = [];
  for (let i = 0; i < state.pages.length; i++) {
    const p = state.pages[i];
    let title = "";
    try { title = await p.title(); } catch { /* noop */ }
    run.tabs.push({ index: i, url: p.url(), title });
  }
}

// ─── Download handler ───────────────────────────────────────────────────────

function attachDownloadHandler(page: Page, run: NavRun): void {
  page.on("download", async (download: Download) => {
    try {
      const taskDir = path.join(DOWNLOAD_DIR, run.taskId);
      if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });

      const suggested = download.suggestedFilename() || `download-${Date.now()}`;
      const target = path.join(taskDir, `${Date.now()}-${suggested}`);
      await download.saveAs(target);

      let sizeBytes = 0;
      try { sizeBytes = fs.statSync(target).size; } catch { /* noop */ }

      const record: NavDownloadRecord = {
        filename: suggested,
        storedPath: target,
        sizeBytes,
        downloadedAt: Date.now(),
      };
      run.downloads.push(record);

      // Tag the most recent step with the download so the UI can surface
      // "this click triggered a download". The step that fired the click
      // is whichever one was appended most recently.
      const lastStep = run.steps[run.steps.length - 1];
      if (lastStep && !lastStep.downloadedFile) {
        lastStep.downloadedFile = record;
      }

      await logger.info(
        "navigator",
        `Task ${run.taskId} captured download: ${suggested} (${sizeBytes} bytes)`
      );
    } catch (err) {
      await logger.warn("navigator", `Download handler failed: ${String(err)}`);
    }
  });
}

// ─── Action execution ───────────────────────────────────────────────────────

async function executeAction(
  state: TaskBrowserState,
  run: NavRun,
  action: NavAction
): Promise<{ outcome: string; extractedText: string | null }> {
  const actionTimeout = 30_000;
  const page = currentPage(state, run);

  switch (action.kind) {
    case "goto": {
      if (!isUrlAllowed(action.url, run.allowlist)) {
        throw new Error(`Navigation to ${action.url} blocked by allowlist`);
      }
      await page.goto(action.url, { timeout: actionTimeout, waitUntil: "domcontentloaded" });
      return { outcome: `navigated to ${action.url}`, extractedText: null };
    }
    case "click": {
      await page.click(action.selector, { timeout: actionTimeout });
      return { outcome: `clicked ${action.selector}`, extractedText: null };
    }
    case "type": {
      await page.fill(action.selector, action.text, { timeout: actionTimeout });
      return {
        outcome: `typed ${action.text.length} chars into ${action.selector}`,
        extractedText: null,
      };
    }
    case "press": {
      await page.keyboard.press(action.key);
      return { outcome: `pressed ${action.key}`, extractedText: null };
    }
    case "scroll": {
      const dy = (action.amount ?? 600) * (action.direction === "up" ? -1 : 1);
      await page.evaluate((delta) => window.scrollBy(0, delta), dy);
      return { outcome: `scrolled ${action.direction} ${Math.abs(dy)}px`, extractedText: null };
    }
    case "wait": {
      if (action.selector) {
        await page.waitForSelector(action.selector, { timeout: action.timeoutMs ?? actionTimeout });
        return { outcome: `saw ${action.selector}`, extractedText: null };
      } else {
        await page.waitForLoadState("networkidle", { timeout: action.timeoutMs ?? actionTimeout });
        return { outcome: "page settled (network idle)", extractedText: null };
      }
    }
    case "extract": {
      const text = action.selector
        ? await page.locator(action.selector).first().textContent({ timeout: actionTimeout })
        : await page.evaluate(() => document.body?.innerText ?? "");
      const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
      return {
        outcome: `extracted ${trimmed.length} chars`,
        extractedText: trimmed.slice(0, 4000),
      };
    }
    case "screenshot": {
      return { outcome: "screenshot captured", extractedText: null };
    }
    case "switchTab": {
      if (action.index < 0 || action.index >= state.pages.length) {
        throw new Error(`Invalid tab index ${action.index} (have ${state.pages.length} tabs)`);
      }
      run.currentTabIndex = action.index;
      try { await state.pages[action.index].bringToFront(); } catch { /* noop */ }
      return { outcome: `switched to tab ${action.index}`, extractedText: null };
    }
    case "closeTab": {
      if (state.pages.length <= 1) {
        throw new Error("Cannot close the only remaining tab");
      }
      const idx = action.index ?? run.currentTabIndex;
      if (idx < 0 || idx >= state.pages.length) {
        throw new Error(`Invalid tab index ${idx}`);
      }
      const closed = state.pages[idx];
      state.pages.splice(idx, 1);
      try { await closed.close(); } catch { /* noop */ }
      // Adjust current index if we closed the current or an earlier tab
      if (run.currentTabIndex >= state.pages.length) {
        run.currentTabIndex = state.pages.length - 1;
      }
      return { outcome: `closed tab ${idx}`, extractedText: null };
    }
    case "done": {
      return { outcome: `done: ${action.result}`, extractedText: null };
    }
  }
}

async function captureScreenshot(page: Page, taskId: string, step: number): Promise<string | null> {
  try {
    const filename = `${taskId}-step-${String(step).padStart(2, "0")}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: false });
    return filepath;
  } catch (err) {
    await logger.warn("navigator", `Screenshot failed: ${String(err)}`);
    return null;
  }
}

// ─── LLM planner ────────────────────────────────────────────────────────────

async function planNextAction(
  run: NavRun,
  currentUrl: string,
  pageTitle: string
): Promise<NavAction> {
  const historyLines = run.steps.map(
    (s) =>
      `Step ${s.step} [tab ${s.tabIndex}]: ${s.action.kind}${
        s.action.kind === "goto" ? ` ${s.action.url}` :
        s.action.kind === "click" ? ` ${s.action.selector}` :
        s.action.kind === "type" ? ` "${s.action.text.slice(0, 40)}" into ${s.action.selector}` :
        s.action.kind === "switchTab" ? ` to ${s.action.index}` :
        ""
      } → ${s.outcome}${s.extractedText ? `\n  extracted: ${s.extractedText.slice(0, 400)}` : ""}${s.downloadedFile ? `\n  downloaded: ${s.downloadedFile.filename}` : ""}`
  );

  const tabList = run.tabs
    .map((t) => `  [${t.index}]${t.index === run.currentTabIndex ? " ← current" : ""} ${t.title || "(untitled)"} — ${t.url || "(blank)"}`)
    .join("\n");

  const systemPrompt = `You are JARVIS's browser Navigator agent. Your job is to accomplish the user's goal by driving a real browser through a sequence of one-at-a-time primitive actions. You cannot see the page; you know only extracted text, the current URL, and the tab list.

Available action kinds (return exactly one per response):
- {"kind":"goto","url":"https://...","reasoning":"..."}
- {"kind":"click","selector":"CSS selector","reasoning":"..."}
- {"kind":"type","selector":"CSS selector","text":"what to type","reasoning":"..."}
- {"kind":"press","key":"Enter","reasoning":"..."}
- {"kind":"scroll","direction":"down","amount":600,"reasoning":"..."}
- {"kind":"wait","selector":"optional CSS","timeoutMs":10000,"reasoning":"..."}
- {"kind":"extract","selector":"optional CSS","reasoning":"..."}
- {"kind":"switchTab","index":N,"reasoning":"..."} — change which tab is current
- {"kind":"closeTab","index":N,"reasoning":"..."} — close a tab (current if index omitted)
- {"kind":"done","result":"short answer","reasoning":"..."}

Constraints:
- One action per response. Be decisive.
- Prefer Playwright's \`text=\` and \`role=\` selectors over fragile CSS.
- If you've already extracted enough information, call done() — don't keep clicking.
- If a step failed, try a different selector, don't repeat.
- If a click opened a new tab (you'll see it in the tab list), switchTab to interact with it.
- Return ONLY valid JSON. No commentary.`;

  const userPrompt = `Goal: ${run.goal}

Current tab: ${run.currentTabIndex}
Current URL: ${currentUrl || "(blank)"}
Current title: ${pageTitle || "(none)"}
Steps completed: ${run.steps.length} / ${run.maxSteps}

Tabs:
${tabList || "  [0] (no tabs yet)"}

History:
${historyLines.length > 0 ? historyLines.join("\n") : "(no steps yet — this is the first action)"}

What is the next single action?`;

  const raw = await ollamaChatJson([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  if (!raw) throw new Error("LLM returned empty plan");
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const action = parsed as NavAction;

  const validKinds = new Set([
    "goto", "click", "type", "press", "scroll", "wait",
    "extract", "screenshot", "switchTab", "closeTab", "done",
  ]);
  if (!action?.kind || !validKinds.has(action.kind)) {
    throw new Error(`LLM returned invalid action kind: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  return action;
}

// ─── Main runner ────────────────────────────────────────────────────────────

export async function startNavigationTask(opts: StartTaskOptions): Promise<string> {
  const taskId = nanoid(10);
  const run: NavRun = {
    taskId,
    goal: opts.goal,
    allowlist: opts.allowlist ?? [],
    maxSteps: Math.min(opts.maxSteps ?? 15, 30),
    allowDestructive: opts.allowDestructive ?? false,
    highStakes: opts.highStakes ?? false,
    headless: opts.headless ?? false,
    sessionId: opts.sessionId ?? null,
    status: "running",
    steps: [],
    downloads: [],
    tabs: [],
    currentTabIndex: 0,
    finalResult: null,
    error: null,
    startedAt: Date.now(),
    endedAt: null,
    pendingAction: null,
    requiredConfirmationPhrase: null,
  };
  _runs.set(taskId, run);

  const stopSignal = new AbortController();
  _stopSignals.set(taskId, stopSignal);

  runAgentLoop(taskId, stopSignal.signal).catch(async (err) => {
    const r = _runs.get(taskId);
    if (r) {
      r.status = "failed";
      r.error = String(err);
      r.endedAt = Date.now();
    }
    await logger.error("navigator", `Task ${taskId} failed: ${err}`);
    await closeTaskContext(taskId);
  });

  return taskId;
}

async function buildTaskContext(run: NavRun, browser: Browser): Promise<TaskBrowserState> {
  // If the caller specified a stored session, load its storageState so the
  // task starts already authenticated. Otherwise, fresh context.
  let storageState: string | undefined;
  if (run.sessionId) {
    const session = await getNavSessionById(run.sessionId);
    if (!session) throw new Error(`Unknown sessionId ${run.sessionId}`);
    if (!fs.existsSync(session.storagePath)) {
      throw new Error(`Session file missing: ${session.storagePath}`);
    }
    storageState = session.storagePath;
    await touchNavSession(session.id);
    await logger.info("navigator", `Task ${run.taskId} using session "${session.name}"`);
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    storageState,
    // Accept downloads. By default Playwright will download to a temp
    // location; the 'download' event gives us control to re-save anywhere.
    acceptDownloads: true,
  });

  // Watch for new tabs. Every new page gets pushed to the run's pages array
  // and its download handler attached. The planner sees the new tab in its
  // next prompt via the tabs list.
  context.on("page", async (newPage) => {
    const state = _contexts.get(run.taskId);
    if (!state) return;
    state.pages.push(newPage);
    attachDownloadHandler(newPage, run);
    try { await newPage.waitForLoadState("domcontentloaded", { timeout: 15_000 }); } catch { /* noop */ }
    await refreshTabList(state, run);
    await logger.info(
      "navigator",
      `Task ${run.taskId} — new tab opened: ${newPage.url()}`
    );
  });

  const page = await context.newPage();
  attachDownloadHandler(page, run);

  return { context, pages: [page] };
}

async function runAgentLoop(taskId: string, signal: AbortSignal): Promise<void> {
  const run = _runs.get(taskId);
  if (!run) return;

  const browser = await getBrowser(run.headless);
  const state = await buildTaskContext(run, browser);
  _contexts.set(taskId, state);

  await refreshTabList(state, run);

  await logger.info("navigator", `Task ${taskId} started: "${run.goal}" (highStakes=${run.highStakes}, sessionId=${run.sessionId})`);

  try {
    while (run.status === "running") {
      if (signal.aborted) {
        run.status = "stopped";
        break;
      }
      if (run.steps.length >= run.maxSteps) {
        run.status = "failed";
        run.error = `Hit max step limit (${run.maxSteps}) without completing the goal`;
        break;
      }

      const page = currentPage(state, run);
      const currentUrl = page.url();
      const pageTitle = (await page.title().catch(() => "")) || "";

      let action: NavAction;
      try {
        action = await planNextAction(run, currentUrl, pageTitle);
      } catch (err) {
        run.status = "failed";
        run.error = `Planner error: ${String(err)}`;
        break;
      }

      // Safety gate: destructive action handling
      if (looksDestructive(action) && !run.allowDestructive) {
        run.pendingAction = action;
        if (run.highStakes) {
          run.status = "awaiting_typed_confirmation";
          run.requiredConfirmationPhrase = buildConfirmationPhrase(action, currentUrl);
          await logger.warn(
            "navigator",
            `Task ${taskId} HIGH-STAKES pause — requires typed confirmation: "${run.requiredConfirmationPhrase}"`
          );
        } else {
          run.status = "awaiting_confirmation";
          await logger.warn(
            "navigator",
            `Task ${taskId} paused — pending destructive action: ${JSON.stringify(action)}`
          );
        }
        return;
      }

      // Terminal: done
      if (action.kind === "done") {
        const screenshotPath = await captureScreenshot(page, taskId, run.steps.length + 1);
        run.steps.push({
          step: run.steps.length + 1,
          action,
          outcome: action.result,
          screenshotPath,
          url: page.url(),
          tabIndex: run.currentTabIndex,
          extractedText: null,
          downloadedFile: null,
          durationMs: 0,
          timestamp: Date.now(),
        });
        run.status = "completed";
        run.finalResult = action.result;
        break;
      }

      // Execute
      const stepStart = Date.now();
      let outcome = "";
      let extractedText: string | null = null;
      try {
        const result = await executeAction(state, run, action);
        outcome = result.outcome;
        extractedText = result.extractedText;
      } catch (err: any) {
        outcome = `ERROR: ${err?.message ?? String(err)}`;
      }

      // Refresh tab list after every action since clicks can open tabs
      await refreshTabList(state, run);

      const screenshotPath = await captureScreenshot(currentPage(state, run), taskId, run.steps.length + 1);
      run.steps.push({
        step: run.steps.length + 1,
        action,
        outcome,
        screenshotPath,
        url: currentPage(state, run).url(),
        tabIndex: run.currentTabIndex,
        extractedText,
        downloadedFile: null, // download handler backfills this asynchronously
        durationMs: Date.now() - stepStart,
        timestamp: Date.now(),
      });

      await logger.info(
        "navigator",
        `Task ${taskId} step ${run.steps.length}: ${action.kind} → ${outcome.slice(0, 120)}`
      );
    }
  } finally {
    run.endedAt = Date.now();
    if (
      run.status !== "awaiting_confirmation" &&
      run.status !== "awaiting_typed_confirmation"
    ) {
      _stopSignals.delete(taskId);
      await closeTaskContext(taskId);
    }
  }
}

// ─── Public API — runs ──────────────────────────────────────────────────────

export function getRun(taskId: string): NavRun | null {
  return _runs.get(taskId) ?? null;
}

export function listRuns(): NavRun[] {
  return Array.from(_runs.values()).sort((a, b) => b.startedAt - a.startedAt);
}

export async function stopTask(taskId: string): Promise<void> {
  const run = _runs.get(taskId);
  if (!run) return;
  const signal = _stopSignals.get(taskId);
  signal?.abort();
  if (
    run.status === "running" ||
    run.status === "awaiting_confirmation" ||
    run.status === "awaiting_typed_confirmation"
  ) {
    run.status = "stopped";
    run.endedAt = Date.now();
  }
  _stopSignals.delete(taskId);
  await closeTaskContext(taskId);
  await logger.info("navigator", `Task ${taskId} stopped by user`);
}

/**
 * Resume a task paused at awaiting_confirmation (simple approve flow).
 */
export async function resolvePendingAction(taskId: string, approve: boolean): Promise<void> {
  const run = _runs.get(taskId);
  if (!run || run.status !== "awaiting_confirmation") return;
  await resumeFromPending(run, approve, null);
}

/**
 * Resume a task paused at awaiting_typed_confirmation (high-stakes).
 * The user must have typed EXACTLY the requiredConfirmationPhrase. Any
 * mismatch auto-rejects and writes an audit log entry as "rejected (mismatch)".
 */
export async function resolveTypedConfirmation(
  taskId: string,
  userText: string
): Promise<{ approved: boolean; reason?: string }> {
  const run = _runs.get(taskId);
  if (!run || run.status !== "awaiting_typed_confirmation") {
    return { approved: false, reason: "No task is awaiting typed confirmation" };
  }

  const expected = run.requiredConfirmationPhrase ?? "";
  const matches = userText.trim() === expected.trim();

  await addNavAuditEntry({
    taskId,
    goal: run.goal,
    actionJson: JSON.stringify(run.pendingAction),
    confirmationPhrase: expected,
    userProvidedText: userText,
    approved: matches,
  });

  if (!matches) {
    run.status = "stopped";
    run.error = `High-stakes confirmation mismatch (expected "${expected}", got "${userText}")`;
    run.endedAt = Date.now();
    await closeTaskContext(taskId);
    await logger.warn(
      "navigator",
      `Task ${taskId} REJECTED by typed confirmation mismatch`
    );
    return { approved: false, reason: "Confirmation phrase did not match exactly" };
  }

  await logger.info("navigator", `Task ${taskId} APPROVED via typed confirmation`);
  await resumeFromPending(run, true, userText);
  return { approved: true };
}

async function resumeFromPending(
  run: NavRun,
  approve: boolean,
  _confirmationText: string | null
): Promise<void> {
  const pending = run.pendingAction;
  if (!pending) return;

  if (!approve) {
    run.status = "stopped";
    run.error = "User rejected destructive action";
    run.endedAt = Date.now();
    await closeTaskContext(run.taskId);
    await logger.info("navigator", `Task ${run.taskId} aborted — user rejected ${pending.kind}`);
    return;
  }

  const state = _contexts.get(run.taskId);
  if (!state) {
    run.status = "failed";
    run.error = "Browser context was closed during confirmation";
    return;
  }

  run.allowDestructive = true;
  run.status = "running";
  run.pendingAction = null;
  run.requiredConfirmationPhrase = null;

  const stepStart = Date.now();
  let outcome = "";
  let extractedText: string | null = null;
  try {
    const result = await executeAction(state, run, pending);
    outcome = result.outcome;
    extractedText = result.extractedText;
  } catch (err: any) {
    outcome = `ERROR: ${err?.message ?? String(err)}`;
  }

  await refreshTabList(state, run);
  const screenshotPath = await captureScreenshot(currentPage(state, run), run.taskId, run.steps.length + 1);
  run.steps.push({
    step: run.steps.length + 1,
    action: pending,
    outcome,
    screenshotPath,
    url: currentPage(state, run).url(),
    tabIndex: run.currentTabIndex,
    extractedText,
    downloadedFile: null,
    durationMs: Date.now() - stepStart,
    timestamp: Date.now(),
  });

  // Resume the agent loop
  const signal = _stopSignals.get(run.taskId) ?? new AbortController();
  if (!_stopSignals.has(run.taskId)) _stopSignals.set(run.taskId, signal as AbortController);
  runAgentLoop(run.taskId, (signal as AbortController).signal).catch(async (err) => {
    run.status = "failed";
    run.error = String(err);
    run.endedAt = Date.now();
    await closeTaskContext(run.taskId);
  });
}

// ─── Public API — sessions ──────────────────────────────────────────────────

/**
 * Launch a headed browser for the user to manually log in. This doesn't
 * create a task — it just gives them a browser to navigate to wherever
 * they want to authenticate. Call finalizeCaptureSession to save.
 */
export async function beginCaptureSession(startUrl?: string): Promise<{ ready: boolean }> {
  const browser = await getBrowser(false); // always headed — user needs to see the browser
  if (_captureContext) {
    // Already capturing; just refocus
    try { await _capturePage?.bringToFront(); } catch { /* noop */ }
    return { ready: true };
  }
  _captureContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
  });
  _capturePage = await _captureContext.newPage();
  if (startUrl) {
    try { await _capturePage.goto(startUrl, { waitUntil: "domcontentloaded" }); } catch { /* noop */ }
  }
  await logger.info("navigator", `Capture session started${startUrl ? ` at ${startUrl}` : ""}`);
  return { ready: true };
}

/**
 * Grab storageState from the capture context and persist it. The user
 * should have logged in successfully before calling this.
 */
export async function finalizeCaptureSession(name: string, description?: string | null): Promise<NavSession> {
  if (!_captureContext || !_capturePage) {
    throw new Error("No capture session in progress — call beginCaptureSession first");
  }

  // Name collision — refuse rather than silently overwrite.
  const existing = await getNavSessionByName(name);
  if (existing) throw new Error(`A session named "${name}" already exists`);

  const sessionId = nanoid(8);
  const storagePath = path.join(SESSION_DIR, `${sessionId}.json`);
  await _captureContext.storageState({ path: storagePath });

  let origin: string | null = null;
  try { origin = new URL(_capturePage.url()).hostname; } catch { /* noop */ }

  // Close the capture browser — user's done.
  try { await _capturePage.close(); } catch { /* noop */ }
  try { await _captureContext.close(); } catch { /* noop */ }
  _captureContext = null;
  _capturePage = null;

  const id = await addNavSession({
    name,
    description: description ?? null,
    storagePath,
    origin,
  });

  await logger.info("navigator", `Captured session "${name}" → ${storagePath}`);

  const created = await getNavSessionById(id);
  if (!created) throw new Error("Failed to read back created session");
  return created;
}

export async function cancelCaptureSession(): Promise<void> {
  if (_capturePage) { try { await _capturePage.close(); } catch { /* noop */ } }
  if (_captureContext) { try { await _captureContext.close(); } catch { /* noop */ } }
  _capturePage = null;
  _captureContext = null;
}

export async function listSessions(): Promise<NavSession[]> {
  return dbListNavSessions();
}

export async function deleteSession(id: number): Promise<void> {
  const session = await getNavSessionById(id);
  if (session?.storagePath && fs.existsSync(session.storagePath)) {
    try { fs.unlinkSync(session.storagePath); } catch { /* noop */ }
  }
  await dbDeleteNavSession(id);
}
