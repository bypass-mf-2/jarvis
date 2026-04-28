/**
 * Ollama integration helper with priority queue.
 *
 * User chat requests (priority 0) always run first.
 * Background tasks like embeddings (priority 2) yield to user requests.
 * This prevents background scraping from starving the chat.
 */

import { invokeLLM } from "./_core/llm";
import { enqueueOllama } from "./ollamaQueue.js";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

// DEFAULT_MODEL is mutable: env var seeds it at boot, llmSettings.default_model
// (set by loraTrainer.deployModel after a winning training cycle) overrides at
// runtime. Without this, A/B gate "deployments" had no effect — chat kept
// using whatever was in process.env.OLLAMA_MODEL forever.
let _defaultModel = process.env.OLLAMA_MODEL || "llama3.2";
export function getDefaultModel(): string {
  return _defaultModel;
}
export function setDefaultModel(name: string): void {
  if (!name) return;
  if (_defaultModel !== name) {
    console.log(`[ollama] default model swapped: ${_defaultModel} → ${name}`);
  }
  _defaultModel = name;
}
// Bootstrap from llmSettings on first import — non-blocking. If it fails (DB
// not yet open), we keep the env-default.
void (async () => {
  try {
    const { getSetting } = await import("./llmSettings.js");
    const persisted = await getSetting("default_model");
    if (persisted && typeof persisted === "string") setDefaultModel(persisted);
  } catch { /* ignore — fall back to env default */ }
})();

const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
// Background/JSON workload model. Separate from the user-chat model so you
// can run a large reasoning model (gemma4, etc.) for user-facing chat while
// routing autoTrain/memory-extraction/routing JSON calls to a small, fast
// model that reliably honors format=json. Falls back to default model when
// unset, preserving the old single-model behavior.
const JSON_MODEL_ENV = process.env.OLLAMA_JSON_MODEL;
function getJsonModel(): string {
  return JSON_MODEL_ENV || _defaultModel;
}
// Reasoning model for complex queries requiring step-by-step thinking.
// DeepSeek-R1 variants are reasoning-specialized and produce <think>...</think>
// blocks natively. Pulled via: `ollama pull deepseek-r1:7b` (or :14b, :32b, :70b).
// Falls back to DEFAULT_MODEL if the reasoning model isn't installed.
const REASONING_MODEL = process.env.OLLAMA_REASONING_MODEL || "deepseek-r1:7b";

export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// ── Cached state ─────────────────────────────────────────────────────────────
let _ollamaAvailable: boolean | null = null;
let _ollamaCheckedAt = 0;
let _ollamaModels: string[] | null = null;
let _ollamaModelsCheckedAt = 0;
const OLLAMA_CACHE_TTL = 15_000;
const OLLAMA_MODELS_CACHE_TTL = 60_000;

// ── Health check (cached) ────────────────────────────────────────────────────
// Cache TTL split: "up" is cached for OLLAMA_CACHE_TTL (15s) — we trust a
// healthy verdict. "down" is cached for a much shorter window so Ollama can
// recover quickly after a transient saturation blip. Previously a single 15s
// TTL meant one slow /api/tags response during heavy embed work would make
// everything fall through to Forge for 15 full seconds — triggering the
// misleading "OPENAI_API_KEY is not configured" error cascade.
const OLLAMA_DOWN_CACHE_TTL = 2_000;
// Bumped health-check timeout from 3s → 8s because the /api/tags response
// gets queued behind active inference when Ollama is serving a big chat. A
// 3s timeout made the "saturated-looks-like-down" failure too easy to hit.
const OLLAMA_HEALTH_TIMEOUT_MS = 8_000;

export async function isOllamaAvailable(): Promise<boolean> {
  const now = Date.now();
  const ttl = _ollamaAvailable === false ? OLLAMA_DOWN_CACHE_TTL : OLLAMA_CACHE_TTL;
  if (_ollamaAvailable !== null && now - _ollamaCheckedAt < ttl) {
    return _ollamaAvailable;
  }
  const prev = _ollamaAvailable;
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(OLLAMA_HEALTH_TIMEOUT_MS),
    });
    _ollamaAvailable = res.ok;
  } catch {
    _ollamaAvailable = false;
  }
  _ollamaCheckedAt = now;

  // Log state transitions so silent fallbacks are actually visible. Previously
  // Ollama could go down/up without any log line — you'd just see chat errors
  // without knowing why. Matches the transition-logging pattern in vectorStore.ts.
  if (prev !== _ollamaAvailable) {
    if (_ollamaAvailable) {
      console.log("[Ollama] ✓ RECOVERED — local model available again");
    } else {
      console.warn(
        "[Ollama] ✗ UNAVAILABLE — local model not reachable at " +
          OLLAMA_BASE +
          ". Will retry in " +
          OLLAMA_DOWN_CACHE_TTL / 1000 +
          "s."
      );
    }
  }

  return _ollamaAvailable!;
}

export async function listOllamaModels(): Promise<string[]> {
  const now = Date.now();
  if (_ollamaModels !== null && now - _ollamaModelsCheckedAt < OLLAMA_MODELS_CACHE_TTL) {
    return _ollamaModels;
  }
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) { _ollamaModels = []; return []; }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    _ollamaModels = (data.models || []).map((m) => m.name);
  } catch {
    _ollamaModels = [];
  }
  _ollamaModelsCheckedAt = now;
  return _ollamaModels!;
}

// ── Runtime temperature override (driven by the UI "creativity" slider) ─────
// Module-local cache so every call to _rawOllamaChat can inject the current
// value without round-tripping to the DB. setTemperatureOverride() is called
// by the llm.setCreativity router and once on server boot to hydrate from
// llm_settings.
let _temperatureOverride: number | undefined = undefined;
export function setTemperatureOverride(value: number | undefined): void {
  _temperatureOverride = value;
}
export function getTemperatureOverride(): number | undefined {
  return _temperatureOverride;
}

// ── Raw Ollama fetch (no queue, used internally) ─────────────────────────────
async function _rawOllamaChat(
  messages: OllamaMessage[],
  model: string,
  timeoutMs: number,
  format?: "json"
): Promise<string> {
  const body: Record<string, unknown> = { model, messages, stream: false };
  if (format) body.format = format;
  if (_temperatureOverride !== undefined) {
    body.options = { temperature: _temperatureOverride };
  }
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = (await res.json()) as { message?: { content: string } };
  return data.message?.content ?? "";
}

// Track which embed errors we've already logged so we don't flood the log
// with thousands of identical messages when every chunk in a scrape cycle
// fails for the same reason (e.g. model not pulled, input too long).
const _loggedEmbedErrors = new Set<string>();

// Ollama's embed endpoint has an undocumented input length cap. Chunks
// bigger than this routinely 400. nomic-embed-text itself is trained at
// 2048 tokens (~8000 chars); give a bit of headroom.
const EMBED_MAX_CHARS = 7500;

async function _rawOllamaEmbed(text: string, model: string): Promise<number[]> {
  // Ollama rejects empty/whitespace-only input with 400. Short-circuit so
  // the scrape pipeline doesn't spam the queue with doomed requests.
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  // Truncate overlong inputs before sending. A 400 on a 30 KB chunk is
  // easy to trigger from the scraper; truncating is lossy but better
  // than returning empty and losing the chunk entirely.
  const input = trimmed.length > EMBED_MAX_CHARS
    ? trimmed.slice(0, EMBED_MAX_CHARS)
    : trimmed;

  const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    // Capture Ollama's actual error message so we can see WHY it's 400ing
    // instead of seeing an opaque "Embed error: 400" in the log forever.
    let body = "";
    try { body = await res.text(); } catch {}
    const key = `${res.status}:${body.slice(0, 200)}`;
    if (!_loggedEmbedErrors.has(key)) {
      _loggedEmbedErrors.add(key);
      console.error(
        `[Ollama] Embed error ${res.status} from ${OLLAMA_BASE}/api/embed ` +
        `(model=${model}, inputLen=${input.length}): ${body.slice(0, 300)}`
      );
    }
    throw new Error(`Embed error: ${res.status}`);
  }
  const data = (await res.json()) as { embeddings?: number[][] };
  return data.embeddings?.[0] ?? [];
}

// ── Reasoning chat (priority 0 — for complex, deliberative queries) ─────────
// Uses a reasoning-specialized model (DeepSeek-R1 etc.) that produces
// <think>...</think> internal monologue. Returns both the raw response
// (with thinking) and the parsed final answer. Caller decides whether to
// show the thinking or hide it.
//
// Takes longer than ollamaChat() — reasoning models "think" for 10-60s
// before producing the final answer. Use only when the query benefits from
// deliberation: math, logic, planning, multi-step problems, analysis.
export async function reasoningChat(
  messages: OllamaMessage[],
  model: string = REASONING_MODEL
): Promise<{ full: string; thinking: string; answer: string }> {
  // Prefer cloud for reasoning when configured — a 70B+ model thinks much
  // better than DeepSeek-R1:1.5B. Adds a CoT instruction so the cloud
  // model still produces visible <think> tags (they're prompted, not
  // architectural) for the UI's reasoning panel.
  if (shouldRouteToCloud("reasoning")) {
    try {
      const cotMessages = addCoTInstruction(messages);
      const full = await cloudChat(cotMessages, { timeoutMs: 300_000 });
      if (full) return extractThinking(full);
    } catch (err) {
      console.warn(
        `[Cloud] Reasoning chat failed, falling back to local reasoning model:`,
        (err as Error).message ?? err
      );
      // Fall through to local reasoning path.
    }
  }

  const ollamaUp = await isOllamaAvailable();

  let full = "";
  if (ollamaUp) {
    try {
      // Priority 0 — reasoning is user-facing, never starve it
      // Longer timeout because reasoning models think for longer
      full = await enqueueOllama(0, () => _rawOllamaChat(messages, model, 300_000));
    } catch (err) {
      console.warn(`[Ollama] Reasoning chat failed with model ${model}, falling back to default:`, err);
      // Fallback: retry with default model + CoT prompt
      const fallbackMessages = addCoTInstruction(messages);
      try {
        full = await enqueueOllama(0, () => _rawOllamaChat(fallbackMessages, _defaultModel, 120_000));
      } catch {
        full = "";
      }
    }
  }

  if (!full) {
    // Last resort: Forge LLM with CoT prompt
    const fallbackMessages = addCoTInstruction(messages);
    try {
      const response = await invokeLLM({ messages: fallbackMessages });
      full = (response as any)?.choices?.[0]?.message?.content ?? "";
    } catch {
      full = "";
    }
  }

  return extractThinking(full);
}

// ── Thinking extractor ──────────────────────────────────────────────────────
// DeepSeek-R1 format: "<think>internal monologue...</think>final answer"
// Also handles <thinking> and other common CoT wrappers.
export function extractThinking(raw: string): { full: string; thinking: string; answer: string } {
  if (!raw) return { full: "", thinking: "", answer: "" };

  // Try various thinking tag formats
  const patterns = [
    /<think>([\s\S]*?)<\/think>\s*([\s\S]*)/i,
    /<thinking>([\s\S]*?)<\/thinking>\s*([\s\S]*)/i,
    /<reasoning>([\s\S]*?)<\/reasoning>\s*([\s\S]*)/i,
    /\[thinking\]([\s\S]*?)\[\/thinking\]\s*([\s\S]*)/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      return {
        full: raw,
        thinking: match[1].trim(),
        answer: match[2].trim() || raw.replace(match[0], "").trim(),
      };
    }
  }

  // No thinking tags found — answer is the full response
  return { full: raw, thinking: "", answer: raw };
}

// ── CoT instruction injector ────────────────────────────────────────────────
// Adds a system-level instruction to think step-by-step inside <thinking> tags.
// Used as a fallback when the reasoning model isn't available.
export function addCoTInstruction(messages: OllamaMessage[]): OllamaMessage[] {
  const cotInstruction = `Before answering, think through the problem step by step inside a <thinking></thinking> block. Break down the problem, consider multiple approaches, identify what you know and don't know, then produce your final answer after the thinking block. Always show your reasoning.`;

  // If there's already a system message, append to it
  if (messages[0]?.role === "system") {
    return [
      { role: "system", content: `${messages[0].content}\n\n${cotInstruction}` },
      ...messages.slice(1),
    ];
  }

  // Otherwise prepend a new system message
  return [{ role: "system", content: cotInstruction }, ...messages];
}

// ── Reasoning query detector ────────────────────────────────────────────────
// Decides whether a user query benefits from deliberative reasoning.
// Returns true for math/logic/planning/multi-step/analytical queries.
export function shouldUseReasoning(userQuery: string): boolean {
  const q = userQuery.toLowerCase();
  if (q.length < 15) return false; // too short to warrant reasoning overhead

  // Explicit request for reasoning
  if (/\b(think|reason|deliberate|work through|step[\s-]?by[\s-]?step|show your work|explain your reasoning|walk me through)\b/.test(q)) {
    return true;
  }

  // Math / numerical reasoning
  if (/\b(calculate|compute|solve|how many|how much|what is.*\+|\-|\*|\/|\d+%|percentage|derivative|integral|equation|algebra|geometry|trigonometry|probability)\b/.test(q)) {
    return true;
  }

  // Logic / analysis
  if (/\b(analyze|evaluate|compare|contrast|weigh|pros and cons|trade[\s-]?offs?|implications|consequences|should i|what if|hypothetically)\b/.test(q)) {
    return true;
  }

  // Planning / multi-step
  if (/\b(plan|strategy|roadmap|approach|how (should|would|do) i|best way to|steps to|process for)\b/.test(q)) {
    return true;
  }

  // Complex coding
  if (/\b(debug|refactor|optimize|architect|design pattern|algorithm|complexity|big[\s-]?o)\b/.test(q)) {
    return true;
  }

  // Multi-sentence queries tend to need more thought
  const sentenceCount = q.split(/[.!?]+/).filter((s) => s.trim().length > 5).length;
  if (sentenceCount >= 3) return true;

  return false;
}

// ── Chat completion (priority 0 — user facing) ──────────────────────────────
export async function ollamaChat(
  messages: OllamaMessage[],
  model?: string
): Promise<string> {
  model = model ?? _defaultModel;
  const ollamaUp = await isOllamaAvailable();

  if (ollamaUp) {
    // One inline retry before falling through — most "Ollama failed" errors
    // are transient (model eviction, queue saturation, brief /api/chat 503).
    // Retrying in 500ms turns a lot of former cascade-failures into quiet
    // recoveries that the user never sees.
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await enqueueOllama(0, () => _rawOllamaChat(messages, model, 120_000));
      } catch (err) {
        lastErr = err;
        if (attempt === 0) {
          console.warn("[Ollama] Chat failed (attempt 1/2), retrying in 500ms:", err);
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        console.warn("[Ollama] Chat failed (both attempts), trying Forge fallback:", err);
      }
    }
    // Fall through to Forge only if both attempts failed.
    void lastErr;
  }

  // Fallback: built-in Forge LLM. Only reachable when Ollama is genuinely
  // down OR both retries failed. Wrap the invokeLLM error with a clear
  // message — the raw one says "OPENAI_API_KEY is not configured" which is
  // a misleading artifact of the Forge/Manus client path.
  try {
    const response = await invokeLLM({ messages });
    return (response as any)?.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    const msg = String(err);
    if (msg.includes("OPENAI_API_KEY") || msg.includes("forgeApiKey")) {
      throw new Error(
        "Ollama is unavailable and no cloud LLM fallback is configured. " +
          "Check that Ollama is running at " +
          OLLAMA_BASE +
          " — or set FORGE_API_KEY in .env to enable the cloud fallback."
      );
    }
    throw err;
  }
}

// ── Structured chat (forces valid JSON via Ollama's format=json grammar) ────
// Use this when the caller needs to JSON.parse() the response. Without
// format=json, small models commonly wrap output in prose or code fences.
// Runs at priority 1 (background) so it can't starve user-facing chat.
// Defaults to JSON_MODEL (OLLAMA_JSON_MODEL env) so you can point this at a
// small JSON-reliable model while the main chat uses a larger reasoning one.
export async function ollamaChatJson(
  messages: OllamaMessage[],
  model?: string
): Promise<string> {
  model = model ?? getJsonModel();
  const ollamaUp = await isOllamaAvailable();
  if (!ollamaUp) return "";
  try {
    return await enqueueOllama(1, () => _rawOllamaChat(messages, model, 180_000, "json"));
  } catch (err) {
    console.warn("[Ollama] JSON chat failed:", err);
    return "";
  }
}

// ── Background chat (priority 1 — memory extraction, model routing) ──────────
// Also defaults to JSON_MODEL because the callers are all background tasks
// that don't need user-chat-grade quality and benefit from a faster model.
export async function ollamaChatBackground(
  messages: OllamaMessage[],
  model?: string
): Promise<string> {
  model = model ?? getJsonModel();
  const ollamaUp = await isOllamaAvailable();
  if (!ollamaUp) return "";

  try {
    return await enqueueOllama(1, () => _rawOllamaChat(messages, model, 60_000));
  } catch {
    return "";
  }
}

// ── Streaming chat (not queued — runs directly for real-time UX) ─────────────
export async function* ollamaChatStream(
  messages: OllamaMessage[],
  model?: string
): AsyncGenerator<string> {
  model = model ?? _defaultModel;
  const ollamaUp = await isOllamaAvailable();

  if (ollamaUp) {
    try {
      const streamBody: Record<string, unknown> = { model, messages, stream: true };
      if (_temperatureOverride !== undefined) {
        streamBody.options = { temperature: _temperatureOverride };
      }
      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(streamBody),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok || !res.body) throw new Error(`Ollama stream error: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as {
              message?: { content: string };
              done?: boolean;
            };
            if (chunk.message?.content) yield chunk.message.content;
            if (chunk.done) return;
          } catch {
            // skip malformed lines
          }
        }
      }
      return;
    } catch (err) {
      console.warn("[Ollama] Stream failed, falling back to Forge LLM:", err);
    }
  }

  // Fallback: non-streaming via Forge
  const text = await ollamaChat(messages, model);
  yield text;
}

// ── Embeddings (priority 2 — lowest, yields to chat) ─────────────────────────
export async function getEmbedding(text: string, model: string = EMBED_MODEL): Promise<number[]> {
  const ollamaUp = await isOllamaAvailable();
  if (!ollamaUp) return [];

  try {
    return await enqueueOllama(2, () => _rawOllamaEmbed(text, model));
  } catch (err) {
    console.warn("[Ollama] Embedding failed:", err);
    return [];
  }
}

/**
 * Batch embedding — embed multiple texts in a single Ollama request.
 * Ollama's /api/embed endpoint accepts an array of inputs and returns a
 * corresponding array of embedding vectors. Batching slashes overhead:
 *
 *   Single: 16 chunks × 1 HTTP round-trip × model-load-per-call = ~16 requests
 *   Batched: 1 HTTP request with 16 inputs = ~1 request, 10× faster
 *
 * Returns a Map<index, number[]>. Indices that failed get an empty array.
 * The batch is enqueued at priority 2 (background) so user chat isn't starved.
 */
export async function getEmbeddingBatch(
  texts: string[],
  model: string = EMBED_MODEL
): Promise<number[][]> {
  const ollamaUp = await isOllamaAvailable();
  if (!ollamaUp) return texts.map(() => []);

  // Pre-filter: skip empty/whitespace-only inputs, truncate overlong ones.
  const prepared = texts.map((t) => {
    const trimmed = t.trim();
    if (trimmed.length === 0) return "";
    return trimmed.length > EMBED_MAX_CHARS ? trimmed.slice(0, EMBED_MAX_CHARS) : trimmed;
  });

  // Find which indices actually have content
  const validIndices: number[] = [];
  const validInputs: string[] = [];
  for (let i = 0; i < prepared.length; i++) {
    if (prepared[i]) {
      validIndices.push(i);
      validInputs.push(prepared[i]);
    }
  }

  if (validInputs.length === 0) return texts.map(() => []);

  try {
    const embeddings = await enqueueOllama(2, async () => {
      const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: validInputs }),
        signal: AbortSignal.timeout(60_000), // longer timeout for batches
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Batch embed error ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { embeddings?: number[][] };
      return data.embeddings ?? [];
    });

    // Map results back to original indices
    const result: number[][] = texts.map(() => []);
    for (let i = 0; i < validIndices.length; i++) {
      result[validIndices[i]] = embeddings[i] ?? [];
    }
    return result;
  } catch (err) {
    console.warn("[Ollama] Batch embedding failed:", err);
    return texts.map(() => []);
  }
}

export { EMBED_MODEL, REASONING_MODEL, getJsonModel };

// ──────────────────────────────────────────────────────────────────────────
// Cloud chat (OpenAI-compatible) — for intentional off-boarding of heavy
// work to a more capable model running on remote hardware. This is distinct
// from the Forge/invokeLLM fallback in `_core/llm.ts`:
//   - invokeLLM is Manus-Forge-specific: hardcoded gemini-2.5-flash, adds
//     `thinking` params, used only as a last-resort fallback when Ollama
//     fails.
//   - cloudChat is provider-agnostic. Point it at any OpenAI-compatible
//     endpoint (Groq, OpenRouter, Anthropic-compat, local vLLM, etc.) and
//     it issues a clean chat completions request. Used for intentional
//     routing of expensive generation (book writing, planner, reasoning)
//     to a bigger model than the local Ollama can run.
//
// Env vars:
//   FORGE_API_KEY — the bearer token for your provider
//   FORGE_API_URL — the base URL up to /v1/chat/completions
//                   (e.g. "https://api.groq.com/openai", "https://openrouter.ai/api")
//   FORGE_MODEL   — the model to request. Defaults to a sensible Groq model.
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_CLOUD_MODEL = "llama-3.1-70b-versatile"; // Groq's free-tier 70B

export function isCloudConfigured(): boolean {
  return !!(process.env.FORGE_API_KEY && process.env.FORGE_API_URL);
}

export async function cloudChat(
  messages: OllamaMessage[],
  options: { format?: "json"; model?: string; timeoutMs?: number } = {}
): Promise<string> {
  const apiKey = process.env.FORGE_API_KEY;
  const apiUrl = process.env.FORGE_API_URL;
  if (!apiKey || !apiUrl) {
    throw new Error(
      "Cloud LLM not configured. Set FORGE_API_KEY and FORGE_API_URL in .env. " +
        "See CLAUDE.md for OpenRouter/Groq/Anthropic URLs."
    );
  }

  const model = options.model ?? process.env.FORGE_MODEL ?? DEFAULT_CLOUD_MODEL;
  const body: Record<string, unknown> = { model, messages, stream: false };
  if (options.format === "json") {
    // OpenAI-compatible JSON mode. Most providers honor this; the ones that
    // don't (some OSS servers) will return plain prose that the caller may
    // still be able to JSON.parse from.
    body.response_format = { type: "json_object" };
  }

  const url = `${apiUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Cloud LLM error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

// Intent tags — each caller describes *why* it's making the call, and the
// router decides per-intent whether that warrants cloud off-boarding.
// Heavy intents prefer cloud when configured; light intents stay local.
export type ChatIntent =
  | "book_writing"    // paragraph generation — quality matters, route to cloud
  | "planner"         // multi-step decomposition — reasoning matters
  | "reasoning"       // explicit "think about this" queries
  | "self_evaluate"   // code review — judgment matters
  | "chat"            // everyday Q&A — stay local unless complex
  | "background";     // autoTrain synth, memory consolidation, etc. — local only

const HEAVY_INTENTS: ChatIntent[] = [
  "book_writing",
  "planner",
  "reasoning",
  "self_evaluate",
];

export function shouldRouteToCloud(intent: ChatIntent): boolean {
  if (!isCloudConfigured()) return false;
  return HEAVY_INTENTS.includes(intent);
}

// Unified smart-routing entry point. Callers describe intent; we pick the
// right backend based on what's configured. On cloud failure we fall back
// to Ollama automatically so a transient network blip doesn't kill a book.
export async function smartChat(
  messages: OllamaMessage[],
  intent: ChatIntent,
  options: { format?: "json"; model?: string } = {}
): Promise<string> {
  if (shouldRouteToCloud(intent)) {
    try {
      const response = await cloudChat(messages, {
        format: options.format,
        model: options.model,
      });
      // Distillation capture: every successful cloud-LLM response is a
      // potential training example for the local fine-tune pipeline. Fire-
      // and-forget — the recorder is sync (better-sqlite3) but we still
      // wrap in setImmediate so it doesn't block the cloud-response return.
      // Skip JSON-mode responses — those are tool-call payloads, not
      // natural-language examples worth distilling.
      if (options.format !== "json") {
        setImmediate(() => {
          try {
            // Lazy import to avoid circular load + keep the hot path clean.
            import("./distillation.js").then((m: any) =>
              m.recordCloudExample({
                intent,
                messages: messages.map((msg) => ({ role: msg.role, content: String(msg.content ?? "") })),
                response,
                provider: detectProvider(),
                model: options.model ?? process.env.FORGE_MODEL ?? null,
              })
            ).catch(() => { /* non-critical */ });
          } catch { /* non-critical */ }
        });
      }
      return response;
    } catch (err) {
      console.warn(
        `[Cloud] ${intent} failed, falling back to Ollama:`,
        (err as Error).message ?? err
      );
      // Fall through to Ollama below.
    }
  }

  // Local path. For JSON-mode callers, route through ollamaChatJson which
  // uses format=json. Otherwise, use the main chat path which has retry +
  // fallback already wired in.
  if (options.format === "json") {
    return ollamaChatJson(messages, options.model);
  }
  return ollamaChat(messages, options.model);
}

/** Best-effort provider detection based on FORGE_API_URL — used to label
 *  distillation examples for analysis. */
function detectProvider(): string | null {
  const url = process.env.FORGE_API_URL ?? "";
  if (url.includes("groq")) return "groq";
  if (url.includes("openrouter")) return "openrouter";
  if (url.includes("anthropic")) return "anthropic";
  if (url.includes("openai")) return "openai";
  return null;
}
