/**
 * Tool Composition Planner
 *
 * Instead of calling a single tool per user request, the planner asks the LLM
 * to generate a multi-step plan that chains tools together. Each step can
 * reference the output of previous steps via `$varname.path` templating.
 *
 * Flow:
 *   planTask(userRequest)    → LLM returns a JSON plan (array of Step objects)
 *   executePlan(plan)        → walks the plan, resolving inputs & conditions
 *   executeStep(step, ctx)   → runs one tool, returns its output
 *   replan(plan, idx, err)   → asks the LLM to repair the plan from a failed step
 *
 * Safety:
 *   - Plans are hard-capped at MAX_PLAN_STEPS (10) steps.
 *   - Every step runs inside try/catch with at most one retry.
 *   - On a second failure we attempt ONE replan, then fail gracefully.
 *   - `placeTrade` is gated by the trading mode — we refuse to auto-execute
 *     real trades unless mode === "auto" (otherwise the underlying placeTrade
 *     safety path turns it into a paper/approval trade anyway).
 *   - Every plan execution is logged to the reflection system so the system
 *     can learn from planning successes and failures.
 *
 * Nothing here mutates existing modules — this file is purely additive and
 * imports the public surface of the tools it orchestrates.
 */

import { getQuote, analyzeStock } from "./stockMarket.js";
import {
  getAccount,
  getPositions,
  getTradeRecommendation,
  placeTrade,
  getTradingConfig,
} from "./trading.js";
import { searchWeb } from "./webSearch.js";
import { multiHopRetrieval } from "./inferenceEngine.js";
import { generateImage } from "./imageGeneration.js";
import { sendNotification } from "./phoneNotify.js";
import { smartChat } from "./ollama.js";
import { logger } from "./logger.js";
import { recordReflection } from "./reflection.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Tool {
  name: string;
  description: string;
  inputSchema: string; // JSON-schema-like description for the LLM
  outputDescription: string;
  execute: (input: any, context: any) => Promise<any>;
}

export interface PlanStep {
  step: number;
  tool: string;
  input: Record<string, any> | any;
  outputName: string;
  dependsOn?: number[];
  condition?: string;
}

export type Plan = PlanStep[];

export interface StepResult {
  step: number;
  tool: string;
  outputName: string;
  status: "ok" | "skipped" | "error";
  output?: any;
  error?: string;
  retried?: boolean;
  replanned?: boolean;
  startedAt: number;
  finishedAt: number;
}

export interface ExecutionTrace {
  userRequest: string;
  plan: Plan;
  results: StepResult[];
  context: Record<string, any>;
  success: boolean;
  summary: string;
  replanned: boolean;
  error?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_PLAN_STEPS = 10;
const MAX_STEP_RETRIES = 1; // one retry per step, then try replan

// ── Tool Registry ────────────────────────────────────────────────────────────

export const toolRegistry: Record<string, Tool> = {
  getQuote: {
    name: "getQuote",
    description:
      "Fetch a live stock price quote from Alpha Vantage for a given ticker symbol.",
    inputSchema: `{"symbol": "string (e.g. 'AAPL')"}`,
    outputDescription:
      "{symbol, price, change, changePercent, volume, previousClose}",
    execute: async (input: any) => {
      const symbol = String(input?.symbol ?? "").trim();
      if (!symbol) throw new Error("getQuote: symbol is required");
      return await getQuote(symbol);
    },
  },

  analyzeStock: {
    name: "analyzeStock",
    description:
      "Run a multi-factor fundamental+technical analysis on a stock symbol and return a structured report.",
    inputSchema: `{"symbol": "string"}`,
    outputDescription:
      "StockAnalysis object: {symbol, price, indicators, signals, summary, ...}",
    execute: async (input: any) => {
      const symbol = String(input?.symbol ?? "").trim();
      if (!symbol) throw new Error("analyzeStock: symbol is required");
      return await analyzeStock(symbol);
    },
  },

  getAccount: {
    name: "getAccount",
    description:
      "Get the user's brokerage account snapshot — cash, buying power, equity, portfolio value.",
    inputSchema: `{} (no input)`,
    outputDescription:
      "{cash, buyingPower, equity, portfolioValue, ...}",
    execute: async () => await getAccount(),
  },

  getPositions: {
    name: "getPositions",
    description:
      "List all currently held positions in the brokerage account with P/L details.",
    inputSchema: `{} (no input)`,
    outputDescription:
      "Array of {symbol, qty, avgEntryPrice, currentPrice, unrealizedPL, unrealizedPLPercent}",
    execute: async () => await getPositions(),
  },

  getTradeRecommendation: {
    name: "getTradeRecommendation",
    description:
      "Ask the AI trading module whether to buy/sell/hold a given symbol. Returns an action and confidence score.",
    inputSchema: `{"symbol": "string"}`,
    outputDescription:
      "{action: 'buy'|'sell'|'hold', confidence: number 0..1, reasoning: string, ...}",
    execute: async (input: any) => {
      const symbol = String(input?.symbol ?? "").trim();
      if (!symbol) throw new Error("getTradeRecommendation: symbol is required");
      return await getTradeRecommendation(symbol);
    },
  },

  placeTrade: {
    name: "placeTrade",
    description:
      "Submit a buy/sell order. Respects the configured trading mode — in paper/approval modes the order goes through those safety rails rather than executing live.",
    inputSchema: `{"symbol": "string", "side": "buy"|"sell", "qty": number, "type": "market"|"limit" (optional)}`,
    outputDescription:
      "{success: boolean, order?, pendingId?, error?}",
    execute: async (input: any) => {
      const symbol = String(input?.symbol ?? "").trim();
      const side = String(input?.side ?? "").trim().toLowerCase();
      const qty = Number(input?.qty);
      if (!symbol) throw new Error("placeTrade: symbol is required");
      if (side !== "buy" && side !== "sell") {
        throw new Error(`placeTrade: side must be 'buy' or 'sell', got '${side}'`);
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`placeTrade: qty must be a positive number, got ${input?.qty}`);
      }

      // Safety: do not permit the planner to send real trades unless the user
      // has explicitly put the system in AUTO mode. In other modes the
      // underlying placeTrade already routes to paper/approval, but we also
      // surface a clearer refusal here for visibility.
      const cfg = getTradingConfig();
      if (cfg.mode === "off") {
        return {
          success: false,
          error: "Planner refused trade: trading mode is 'off'.",
        };
      }

      return await placeTrade({
        symbol,
        side: side as "buy" | "sell",
        qty,
        type: (input?.type ?? "market") as "market" | "limit",
        limitPrice: input?.limitPrice,
        reason: input?.reason ?? "Planner-generated step",
      });
    },
  },

  searchWeb: {
    name: "searchWeb",
    description:
      "Run a live web search and return a list of result snippets. Good for freshness-sensitive questions.",
    inputSchema: `{"query": "string", "limit": "number (optional)"}`,
    outputDescription:
      "Array of {title, url, snippet}",
    execute: async (input: any) => {
      const query = String(input?.query ?? "").trim();
      if (!query) throw new Error("searchWeb: query is required");
      const limit = Number.isFinite(Number(input?.limit)) ? Number(input?.limit) : undefined;
      return await searchWeb(query, limit);
    },
  },

  multiHopRetrieval: {
    name: "multiHopRetrieval",
    description:
      "Answer a question using JARVIS's internal knowledge base with multi-hop RAG reasoning across the entity graph.",
    inputSchema: `{"query": "string"}  (can also accept a bare string)`,
    outputDescription:
      "InferenceResult: {answer, citations, hops, ...}",
    execute: async (input: any) => {
      const query =
        typeof input === "string"
          ? input
          : String(input?.query ?? "").trim();
      if (!query) throw new Error("multiHopRetrieval: query is required");
      return await multiHopRetrieval(query);
    },
  },

  generateImage: {
    name: "generateImage",
    description:
      "Generate an image from a text prompt using local Stable Diffusion or DALL-E.",
    inputSchema: `{"prompt": "string"}`,
    outputDescription:
      "{filepath: string, provider: string}",
    execute: async (input: any) => {
      const prompt = String(input?.prompt ?? "").trim();
      if (!prompt) throw new Error("generateImage: prompt is required");
      return await generateImage(prompt);
    },
  },

  sendNotification: {
    name: "sendNotification",
    description:
      "Send a push notification to the user's phone via ntfy. Use this to inform the user about results when they asked to be notified.",
    inputSchema: `{"title": "string", "message": "string"}`,
    outputDescription:
      "boolean — true if delivered",
    execute: async (input: any) => {
      const title = String(input?.title ?? "JARVIS").trim() || "JARVIS";
      const message = String(input?.message ?? "").trim();
      if (!message) throw new Error("sendNotification: message is required");
      return await sendNotification(title, message);
    },
  },

  calendar: {
    name: "calendar",
    description:
      "Read or modify the user's Google Calendar. Use action='listToday' to see today's events, action='create' to add a new event, action='delete' to remove one. Requires the user to have connected their calendar (returns null/empty when not connected — fail gracefully).",
    inputSchema:
      `{"action": "listToday" | "create" | "delete",
        "title": "string (create only)",
        "startAt": "ISO timestamp (create only)",
        "endAt": "ISO timestamp (create only)",
        "location": "string (create only, optional)",
        "description": "string (create only, optional)",
        "eventId": "string (delete only)"}`,
    outputDescription:
      "listToday → CalendarEvent[]; create → CalendarEvent | null; delete → boolean",
    execute: async (input: any) => {
      const action = String(input?.action ?? "").trim();
      const calendar = await import("./googleCalendar.js");
      if (!calendar.getConnectionStatus().connected) {
        // Not connected — return empty/null instead of throwing so a plan
        // including a calendar step still completes, just without data.
        if (action === "listToday") return [];
        if (action === "create") return null;
        if (action === "delete") return false;
        return null;
      }
      switch (action) {
        case "listToday":
          return await calendar.getTodayEvents();
        case "create": {
          const title = String(input?.title ?? "").trim();
          const startAt = input?.startAt;
          const endAt = input?.endAt;
          if (!title || !startAt || !endAt) {
            throw new Error("calendar create: title, startAt, endAt are required");
          }
          return await calendar.createEvent({
            title,
            startAt,
            endAt,
            location: input?.location,
            description: input?.description,
          });
        }
        case "delete": {
          const eventId = String(input?.eventId ?? "").trim();
          if (!eventId) throw new Error("calendar delete: eventId is required");
          return await calendar.deleteEvent(eventId);
        }
        default:
          throw new Error(`calendar: unknown action '${action}'`);
      }
    },
  },

  controlApp: {
    name: "controlApp",
    description:
      "Drive a native desktop app via keyboard, mouse, and window-focus operations. " +
      "Composable verbs: focus (bring an app to the foreground by title substring), " +
      "type (send keystrokes to whatever has focus), keys (press a key combo like " +
      "['LeftControl','S']), click (mouse click at absolute screen coords). Every " +
      "call goes through a rate limiter and audit log. Use sparingly — prefer " +
      "Navigator for browser tasks since it's higher-level. Useful for native apps " +
      "(Notepad, Word, Photoshop, Spotify, etc.) where there's no API.",
    inputSchema:
      `{"action": "focus" | "type" | "keys" | "click" | "windows",
        "titleSubstring": "string (focus only — case-insensitive substring match)",
        "text": "string (type only)",
        "keys": "string[] (keys only — e.g. ['LeftControl','S'])",
        "x": "number (click only — absolute screen X)",
        "y": "number (click only — absolute screen Y)",
        "button": "'left' | 'right' | 'middle' (click only, default 'left')",
        "doubleClick": "boolean (click only, default false)"}`,
    outputDescription:
      "{ok: boolean, message: string} — message describes what happened or why it failed. " +
      "For action='windows' returns {titles: string[], active: string|null}.",
    execute: async (input: any) => {
      const action = String(input?.action ?? "").trim();
      const native = await import("./nativeControl.js");
      switch (action) {
        case "windows":
          return {
            titles: await native.listWindowTitles(),
            active: await native.getActiveWindowTitle(),
          };
        case "focus": {
          const t = String(input?.titleSubstring ?? "").trim();
          if (!t) throw new Error("controlApp focus: titleSubstring is required");
          return await native.focusWindow(t);
        }
        case "type": {
          const text = String(input?.text ?? "");
          if (!text) throw new Error("controlApp type: text is required");
          return await native.typeText(text);
        }
        case "keys": {
          const keys = Array.isArray(input?.keys) ? input.keys.map((k: any) => String(k)) : [];
          if (keys.length === 0) throw new Error("controlApp keys: keys array is required");
          return await native.pressKeys(keys);
        }
        case "click": {
          const x = Number(input?.x);
          const y = Number(input?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error("controlApp click: x and y are required numbers");
          }
          return await native.clickAt({
            x: Math.round(x),
            y: Math.round(y),
            button: input?.button,
            doubleClick: !!input?.doubleClick,
          });
        }
        default:
          throw new Error(`controlApp: unknown action '${action}'`);
      }
    },
  },
};

export function listTools(): Array<{
  name: string;
  description: string;
  inputSchema: string;
  outputDescription: string;
}> {
  return Object.values(toolRegistry).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    outputDescription: t.outputDescription,
  }));
}

// ── Variable resolution ──────────────────────────────────────────────────────

/**
 * Look up a path like "recommendation.action" inside a context object.
 * Returns undefined if any segment is missing.
 */
function getByPath(obj: any, path: string): any {
  if (!path) return obj;
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    // support numeric array indices, e.g. results.0.title
    if (/^\d+$/.test(part)) {
      cur = Array.isArray(cur) ? cur[Number(part)] : cur[part];
    } else {
      cur = cur[part];
    }
  }
  return cur;
}

/**
 * Resolve a `$varname.path` reference. Returns `undefined` if varname is not
 * in the context.
 */
function resolveReference(ref: string, context: Record<string, any>): any {
  // ref is assumed to start with '$'
  const body = ref.slice(1);
  const dot = body.indexOf(".");
  if (dot === -1) {
    return context[body];
  }
  const varName = body.slice(0, dot);
  const path = body.slice(dot + 1);
  return getByPath(context[varName], path);
}

/**
 * Recursively walk an input structure. Any string value that starts with '$'
 * is replaced with the looked-up value from `context`. Strings that embed
 * `${...}` style placeholders are interpolated as strings.
 */
export function resolveInput(input: any, context: Record<string, any>): any {
  if (input == null) return input;
  if (typeof input === "string") {
    if (input.startsWith("$")) {
      const resolved = resolveReference(input, context);
      return resolved === undefined ? input : resolved;
    }
    // support ${varname.path} interpolation inside larger strings
    if (input.includes("${")) {
      return input.replace(/\$\{([^}]+)\}/g, (_m, expr) => {
        const val = resolveReference("$" + expr, context);
        return val === undefined ? "" : typeof val === "string" ? val : JSON.stringify(val);
      });
    }
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((v) => resolveInput(v, context));
  }
  if (typeof input === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = resolveInput(v, context);
    }
    return out;
  }
  return input;
}

// ── Condition evaluation ────────────────────────────────────────────────────

/**
 * Parse a literal from a condition: number, boolean, null, or quoted string.
 */
function parseLiteral(raw: string): any {
  const s = raw.trim();
  if (s.length === 0) return undefined;
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (s === "undefined") return undefined;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  return s; // fall back to bare string
}

/**
 * Resolve one side of a comparison. `$varname.path` is looked up in context;
 * everything else is parsed as a literal.
 */
function resolveConditionOperand(raw: string, context: Record<string, any>): any {
  const s = raw.trim();
  if (s.startsWith("$")) {
    return resolveReference(s, context);
  }
  return parseLiteral(s);
}

const CONDITION_OPS = [
  "===",
  "!==",
  "==",
  "!=",
  ">=",
  "<=",
  ">",
  "<",
];

/**
 * Safely evaluate simple boolean conditions without using eval().
 * Supported shapes:
 *   - "$var.path > 0.5"
 *   - "$var.path === \"buy\""
 *   - "$var"                (truthy check)
 *   - "!$var"               (falsy check)
 */
export function evaluateCondition(
  conditionStr: string | undefined,
  context: Record<string, any>
): boolean {
  if (!conditionStr || typeof conditionStr !== "string") return true;
  const s = conditionStr.trim();
  if (s.length === 0) return true;

  // bare truthiness
  if (s.startsWith("!")) {
    return !evaluateCondition(s.slice(1).trim(), context);
  }

  for (const op of CONDITION_OPS) {
    const idx = s.indexOf(op);
    if (idx === -1) continue;
    const left = s.slice(0, idx);
    const right = s.slice(idx + op.length);
    const lv = resolveConditionOperand(left, context);
    const rv = resolveConditionOperand(right, context);
    switch (op) {
      case "===": return lv === rv;
      case "!==": return lv !== rv;
      case "==":  return lv == rv; // eslint-disable-line eqeqeq
      case "!=":  return lv != rv; // eslint-disable-line eqeqeq
      case ">=":  return Number(lv) >= Number(rv);
      case "<=":  return Number(lv) <= Number(rv);
      case ">":   return Number(lv) > Number(rv);
      case "<":   return Number(lv) < Number(rv);
    }
  }

  // no operator — treat as truthy check
  const val = resolveConditionOperand(s, context);
  return Boolean(val);
}

// ── Plan generation ─────────────────────────────────────────────────────────

function buildToolCatalog(): string {
  return Object.values(toolRegistry)
    .map((t) => `- ${t.name}\n    description: ${t.description}\n    input: ${t.inputSchema}\n    output: ${t.outputDescription}`)
    .join("\n");
}

function buildPlannerSystemPrompt(): string {
  return [
    "You are JARVIS's planning module. Given a user request, produce a short, executable plan that chains together tools from the catalog below.",
    "",
    "Rules:",
    "1. Output ONLY valid JSON — a single array of step objects. No prose, no markdown fences.",
    `2. Maximum ${MAX_PLAN_STEPS} steps. Prefer fewer.`,
    "3. Each step has: step (1-indexed), tool (must be a name from the catalog), input (object matching that tool's schema), outputName (short snake_case identifier).",
    "4. Optional: dependsOn (array of prior step numbers), condition (a simple boolean expression like \"$var.path > 0.7\" or \"$var.action === 'buy'\").",
    "5. To reference a previous step's output, use the string \"$<outputName>.<path>\" in the input. Example: \"$recommendation.action\".",
    "6. Only use tools from the catalog. Do not invent tools.",
    "7. If the user asks you to notify them of a result, finish with a sendNotification step whose message summarizes the outcome.",
    "8. Never plan to place real trades without a preceding recommendation/analysis step that can be checked via a condition.",
    "",
    "Available tools:",
    buildToolCatalog(),
    "",
    "Return the JSON plan now.",
  ].join("\n");
}

/**
 * Strip common LLM wrappers (markdown fences, stray prose before the array)
 * before JSON-parsing.
 */
function extractJsonArray(raw: string): string {
  if (!raw) return "[]";
  let s = raw.trim();
  // strip ```json ... ``` fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  // find the first '[' and last ']'
  const first = s.indexOf("[");
  const last = s.lastIndexOf("]");
  if (first !== -1 && last !== -1 && last > first) {
    return s.slice(first, last + 1);
  }
  return s;
}

function sanitizePlan(raw: any): Plan {
  if (!Array.isArray(raw)) {
    throw new Error("Plan must be a JSON array");
  }
  const plan: Plan = [];
  for (let i = 0; i < raw.length && plan.length < MAX_PLAN_STEPS; i++) {
    const s = raw[i];
    if (!s || typeof s !== "object") continue;
    const tool = String(s.tool ?? "").trim();
    if (!tool || !toolRegistry[tool]) {
      // skip unknown tools rather than failing the whole plan
      continue;
    }
    const outputName =
      typeof s.outputName === "string" && s.outputName.trim().length > 0
        ? s.outputName.trim()
        : `step${i + 1}`;
    plan.push({
      step: Number(s.step ?? i + 1),
      tool,
      input: s.input ?? {},
      outputName,
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(Number).filter(Number.isFinite) : undefined,
      condition: typeof s.condition === "string" ? s.condition : undefined,
    });
  }
  return plan;
}

/**
 * Ask the LLM to produce a plan. On parse failure, returns an empty plan so
 * the caller can fall back gracefully.
 */
export async function planTask(userRequest: string): Promise<Plan> {
  const system = buildPlannerSystemPrompt();
  const user = `User request: ${userRequest}\n\nReturn the JSON plan array.`;

  let raw = "";
  try {
    // Plan decomposition benefits hugely from a bigger model — 3B tends to
    // produce shallow or malformed plans. Route to cloud when configured.
    raw = await smartChat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      "planner",
      { format: "json" }
    );
  } catch (err) {
    await logger.warn("planner", `planTask: LLM call failed: ${err}`);
    return [];
  }

  if (!raw || !raw.trim()) return [];

  try {
    const json = extractJsonArray(raw);
    const parsed = JSON.parse(json);
    return sanitizePlan(parsed);
  } catch (err) {
    await logger.warn("planner", `planTask: plan JSON parse failed: ${err}. Raw: ${raw.slice(0, 400)}`);
    return [];
  }
}

/**
 * Ask the LLM to repair a plan that failed at a specific step. Returns the
 * new plan starting from that step forward (we keep already-succeeded steps).
 */
export async function replan(
  originalPlan: Plan,
  failureStepIndex: number,
  error: string,
  context: Record<string, any>
): Promise<Plan> {
  const failedStep = originalPlan[failureStepIndex];
  const contextKeys = Object.keys(context);
  const priorPlan = originalPlan
    .slice(0, failureStepIndex)
    .map((s) => `  step ${s.step}: ${s.tool} (outputName=${s.outputName})`)
    .join("\n") || "  (none)";

  const system = buildPlannerSystemPrompt();
  const user = [
    `The prior plan for this request failed. User request: ${context.__userRequest ?? "(unknown)"}`,
    `Steps that succeeded (their outputs are available as variables):`,
    priorPlan,
    `Available context variables: ${contextKeys.filter((k) => !k.startsWith("__")).join(", ") || "(none)"}`,
    `Failed step: ${failedStep ? `${failedStep.tool} with input ${JSON.stringify(failedStep.input)}` : "(unknown)"}`,
    `Error: ${error}`,
    "",
    "Produce a new JSON plan (array) that completes the user's original request, starting from where the failure occurred. You may reuse succeeded-step outputs via $<outputName>. Return ONLY JSON.",
  ].join("\n");

  let raw = "";
  try {
    // Replan also benefits from cloud — it's reasoning about a failure and
    // proposing a recovery plan, exactly the kind of thing a small model
    // struggles with.
    raw = await smartChat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      "planner",
      { format: "json" }
    );
  } catch (err) {
    await logger.warn("planner", `replan: LLM call failed: ${err}`);
    return [];
  }

  if (!raw || !raw.trim()) return [];

  try {
    const json = extractJsonArray(raw);
    const parsed = JSON.parse(json);
    return sanitizePlan(parsed);
  } catch (err) {
    await logger.warn("planner", `replan: parse failed: ${err}. Raw: ${raw.slice(0, 400)}`);
    return [];
  }
}

// ── Execution ───────────────────────────────────────────────────────────────

/**
 * Run a single step. Throws on failure; caller decides retry/replan.
 */
export async function executeStep(
  step: PlanStep,
  context: Record<string, any>
): Promise<any> {
  const tool = toolRegistry[step.tool];
  if (!tool) throw new Error(`Unknown tool: ${step.tool}`);
  const resolvedInput = resolveInput(step.input, context);
  return await tool.execute(resolvedInput, context);
}

/**
 * Execute a plan. Uses step-level retry + a single replan attempt on hard
 * failure. Always returns a full trace — never throws.
 */
export async function executePlan(
  plan: Plan,
  userRequest: string = ""
): Promise<ExecutionTrace> {
  const results: StepResult[] = [];
  const context: Record<string, any> = { __userRequest: userRequest };
  let activePlan: Plan = plan.slice(0, MAX_PLAN_STEPS);
  let replannedOnce = false;
  let i = 0;
  let overallSuccess = true;
  let traceError: string | undefined;

  while (i < activePlan.length && i < MAX_PLAN_STEPS) {
    const step = activePlan[i];
    const startedAt = Date.now();

    // evaluate condition
    if (step.condition) {
      let shouldRun = true;
      try {
        shouldRun = evaluateCondition(step.condition, context);
      } catch (err) {
        await logger.warn("planner", `Condition eval failed for step ${step.step}: ${err}`);
        shouldRun = true;
      }
      if (!shouldRun) {
        results.push({
          step: step.step,
          tool: step.tool,
          outputName: step.outputName,
          status: "skipped",
          startedAt,
          finishedAt: Date.now(),
        });
        i++;
        continue;
      }
    }

    let attempt = 0;
    let succeeded = false;
    let lastError = "";

    while (attempt <= MAX_STEP_RETRIES && !succeeded) {
      try {
        const output = await executeStep(step, context);
        context[step.outputName] = output;
        results.push({
          step: step.step,
          tool: step.tool,
          outputName: step.outputName,
          status: "ok",
          output,
          retried: attempt > 0,
          startedAt,
          finishedAt: Date.now(),
        });
        succeeded = true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        attempt++;
        if (attempt <= MAX_STEP_RETRIES) {
          await logger.warn("planner", `Step ${step.step} (${step.tool}) failed, retrying: ${lastError}`);
        }
      }
    }

    if (!succeeded) {
      // step-level hard failure — try one replan
      if (!replannedOnce) {
        replannedOnce = true;
        await logger.warn("planner", `Step ${step.step} (${step.tool}) failed after retries — attempting replan.`);
        const newTail = await replan(activePlan, i, lastError, context);
        if (newTail.length > 0) {
          // replace from current index forward with new tail
          const newPlan = activePlan.slice(0, i).concat(newTail);
          activePlan = newPlan.slice(0, MAX_PLAN_STEPS);
          results.push({
            step: step.step,
            tool: step.tool,
            outputName: step.outputName,
            status: "error",
            error: lastError,
            replanned: true,
            retried: true,
            startedAt,
            finishedAt: Date.now(),
          });
          // don't advance i — re-run the (now replaced) step at this index
          continue;
        }
      }

      // replan failed or already used — record and abort
      results.push({
        step: step.step,
        tool: step.tool,
        outputName: step.outputName,
        status: "error",
        error: lastError,
        retried: true,
        startedAt,
        finishedAt: Date.now(),
      });
      overallSuccess = false;
      traceError = lastError;
      break;
    }

    i++;
  }

  const summary = summarizeTrace(userRequest, activePlan, results, overallSuccess);

  // Log reflection (never throws)
  try {
    const outcome: "success" | "partial" | "failure" = overallSuccess
      ? "success"
      : results.some((r) => r.status === "ok")
      ? "partial"
      : "failure";
    const confidence = overallSuccess ? 0.85 : 0.3;
    const lesson = overallSuccess
      ? `Plan with ${activePlan.length} steps executed cleanly for: ${userRequest.slice(0, 160)}`
      : `Plan failed at step ${results[results.length - 1]?.step}: ${traceError ?? "unknown"}`;
    recordReflection(
      "planner.executePlan",
      { userRequest, plan: activePlan, resultStatuses: results.map((r) => ({ step: r.step, tool: r.tool, status: r.status })) },
      outcome,
      confidence,
      lesson,
      ["planner", replannedOnce ? "replanned" : "single-plan"]
    );
  } catch {
    // reflection is best-effort
  }

  return {
    userRequest,
    plan: activePlan,
    results,
    context,
    success: overallSuccess,
    summary,
    replanned: replannedOnce,
    error: traceError,
  };
}

function shorten(value: any, max = 200): string {
  if (value == null) return "";
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s.length > max) s = s.slice(0, max) + "…";
  return s;
}

function summarizeTrace(
  userRequest: string,
  plan: Plan,
  results: StepResult[],
  success: boolean
): string {
  const lines: string[] = [];
  lines.push(`**Plan for:** ${userRequest}`);
  lines.push("");
  lines.push(success ? "Result: completed." : "Result: did not complete cleanly.");
  lines.push("");
  lines.push("### Steps");
  for (const r of results) {
    const icon = r.status === "ok" ? "[ok]" : r.status === "skipped" ? "[skip]" : "[error]";
    if (r.status === "ok") {
      lines.push(`${icon} ${r.step}. \`${r.tool}\` → \`${r.outputName}\`: ${shorten(r.output)}`);
    } else if (r.status === "skipped") {
      lines.push(`${icon} ${r.step}. \`${r.tool}\` skipped (condition false)`);
    } else {
      lines.push(`${icon} ${r.step}. \`${r.tool}\` failed: ${r.error}${r.replanned ? " — replanned" : ""}`);
    }
  }
  return lines.join("\n");
}

/**
 * Convenience wrapper: plan + execute in one call.
 */
export async function planAndExecute(userRequest: string): Promise<ExecutionTrace> {
  const plan = await planTask(userRequest);
  if (plan.length === 0) {
    return {
      userRequest,
      plan: [],
      results: [],
      context: {},
      success: false,
      summary: `Could not generate a plan for: ${userRequest}`,
      replanned: false,
      error: "empty plan",
    };
  }
  return await executePlan(plan, userRequest);
}

// ── Intent detection ────────────────────────────────────────────────────────

/**
 * Detect whether a chat message looks like a multi-step / workflow request
 * that the planner should handle instead of the default RAG path.
 */
export function looksLikeMultiStepRequest(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();

  // Explicit keywords
  if (/\b(workflow|pipeline|step[- ]by[- ]step|autonomous|autopilot)\b/.test(lower)) {
    return true;
  }

  // "do X and then Y", "after you X, Y", "X then Y"
  if (/\b(and\s+then|after\s+(?:you|that)|,\s*then\b|\bthen\s+(?:also\s+)?(?:notify|send|analyze|check|place|buy|sell|search|generate|summarize))/i.test(text)) {
    return true;
  }

  // Multiple action verbs in one request
  const actionVerbs = [
    "analyze", "analyse", "research", "summarize", "summarise",
    "notify", "alert", "message",
    "buy", "sell", "trade", "rebalance", "place",
    "search", "lookup", "look up", "find",
    "generate", "create", "draw",
    "check", "review", "evaluate",
    "recommend", "suggest",
  ];
  let verbHits = 0;
  for (const v of actionVerbs) {
    const re = new RegExp(`\\b${v.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(lower)) verbHits++;
    if (verbHits >= 2) return true;
  }

  return false;
}
