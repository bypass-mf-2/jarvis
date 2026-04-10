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

async function _rawOllamaEmbed(text: string, model: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Embed error: ${res.status}`);
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
export async function ollamaChatJson(
  messages: OllamaMessage[],
  model: string = DEFAULT_MODEL
): Promise<string> {
  const ollamaUp = await isOllamaAvailable();
  if (!ollamaUp) return "";
  try {
    return await enqueueOllama(1, () => _rawOllamaChat(messages, model, 60_000, "json"));
  } catch (err) {
    console.warn("[Ollama] JSON chat failed:", err);
    return "";
  }
}

// ── Background chat (priority 1 — memory extraction, model routing) ──────────
export async function ollamaChatBackground(
  messages: OllamaMessage[],
  model: string = DEFAULT_MODEL
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

export { DEFAULT_MODEL, EMBED_MODEL };
