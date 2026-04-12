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
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "llama3.2";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
// Background/JSON workload model. Separate from the user-chat model so you
// can run a large reasoning model (gemma4, etc.) for user-facing chat while
// routing autoTrain/memory-extraction/routing JSON calls to a small, fast
// model that reliably honors format=json. Falls back to DEFAULT_MODEL when
// unset, preserving the old single-model behavior.
const JSON_MODEL = process.env.OLLAMA_JSON_MODEL || DEFAULT_MODEL;

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
export async function isOllamaAvailable(): Promise<boolean> {
  const now = Date.now();
  if (_ollamaAvailable !== null && now - _ollamaCheckedAt < OLLAMA_CACHE_TTL) {
    return _ollamaAvailable;
  }
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    _ollamaAvailable = res.ok;
  } catch {
    _ollamaAvailable = false;
  }
  _ollamaCheckedAt = now;
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

// ── Raw Ollama fetch (no queue, used internally) ─────────────────────────────
async function _rawOllamaChat(
  messages: OllamaMessage[],
  model: string,
  timeoutMs: number,
  format?: "json"
): Promise<string> {
  const body: Record<string, unknown> = { model, messages, stream: false };
  if (format) body.format = format;
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

// ── Chat completion (priority 0 — user facing) ──────────────────────────────
export async function ollamaChat(
  messages: OllamaMessage[],
  model: string = DEFAULT_MODEL
): Promise<string> {
  const ollamaUp = await isOllamaAvailable();

  if (ollamaUp) {
    try {
      // Priority 0 = user chat, gets processed first
      return await enqueueOllama(0, () => _rawOllamaChat(messages, model, 120_000));
    } catch (err) {
      console.warn("[Ollama] Chat failed, falling back to Forge LLM:", err);
    }
  }

  // Fallback: built-in Forge LLM
  const response = await invokeLLM({ messages });
  return (response as any)?.choices?.[0]?.message?.content ?? "";
}

// ── Structured chat (forces valid JSON via Ollama's format=json grammar) ────
// Use this when the caller needs to JSON.parse() the response. Without
// format=json, small models commonly wrap output in prose or code fences.
// Runs at priority 1 (background) so it can't starve user-facing chat.
// Defaults to JSON_MODEL (OLLAMA_JSON_MODEL env) so you can point this at a
// small JSON-reliable model while the main chat uses a larger reasoning one.
export async function ollamaChatJson(
  messages: OllamaMessage[],
  model: string = JSON_MODEL
): Promise<string> {
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
  model: string = JSON_MODEL
): Promise<string> {
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
  model: string = DEFAULT_MODEL
): AsyncGenerator<string> {
  const ollamaUp = await isOllamaAvailable();

  if (ollamaUp) {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: true }),
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

export { DEFAULT_MODEL, EMBED_MODEL, JSON_MODEL };
