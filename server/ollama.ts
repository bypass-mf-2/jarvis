/**
 * Ollama integration helper
 * Handles chat completions, streaming, and embeddings via the local Ollama HTTP API.
 * Falls back to the built-in Forge LLM when Ollama is unavailable.
 */

import { invokeLLM } from "./_core/llm";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "llama3.2";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// ── Health check ──────────────────────────────────────────────────────────────
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listOllamaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

// ── Chat completion (non-streaming) ───────────────────────────────────────────
export async function ollamaChat(
  messages: OllamaMessage[],
  model: string = DEFAULT_MODEL
): Promise<string> {
  const ollamaUp = await isOllamaAvailable();

  if (ollamaUp) {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: false }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
      const data = (await res.json()) as { message?: { content: string } };
      return data.message?.content ?? "";
    } catch (err) {
      console.warn("[Ollama] Chat failed, falling back to Forge LLM:", err);
    }
  }

  // Fallback: built-in Forge LLM
  const response = await invokeLLM({ messages });
  return (response as any)?.choices?.[0]?.message?.content ?? "";
}

// ── Streaming chat (returns async generator) ──────────────────────────────────
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

// ── Embeddings ────────────────────────────────────────────────────────────────
export async function getEmbedding(text: string, model: string = EMBED_MODEL): Promise<number[]> {
  const ollamaUp = await isOllamaAvailable();

  if (ollamaUp) {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: text }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Embed error: ${res.status}`);
      const data = (await res.json()) as { embeddings?: number[][] };
      return data.embeddings?.[0] ?? [];
    } catch (err) {
      console.warn("[Ollama] Embedding failed:", err);
    }
  }

  // Return empty vector if embedding unavailable
  return [];
}

export { DEFAULT_MODEL, EMBED_MODEL };
