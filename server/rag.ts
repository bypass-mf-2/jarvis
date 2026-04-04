/**
 * RAG (Retrieval-Augmented Generation) pipeline.
 * Retrieves relevant knowledge chunks from the vector store and injects
 * them into the LLM prompt as context, enabling Jarvis to answer questions
 * based on continuously scraped web knowledge.
 */

import { queryVectorStore, type VectorSearchResult } from "./vectorStore";
import { ollamaChat, ollamaChatStream, type OllamaMessage } from "./ollama";
import { logger } from "./logger";

const JARVIS_SYSTEM_PROMPT = `You are JARVIS (Just A Rather Very Intelligent System), a highly capable AI assistant inspired by Tony Stark's AI. You are helpful, precise, and occasionally witty. You have access to a continuously updated knowledge base scraped from the internet.

When answering:
- Be direct and informative
- Reference your knowledge base context when relevant
- Acknowledge uncertainty when you don't know something
- Use markdown formatting for clarity
- Keep responses concise unless detail is explicitly requested`;

// ── Build augmented prompt ────────────────────────────────────────────────────
async function buildAugmentedMessages(
  userMessage: string,
  conversationHistory: OllamaMessage[],
  topK = 5
): Promise<{ messages: OllamaMessage[]; ragChunks: VectorSearchResult[] }> {
  // Retrieve relevant knowledge
  const ragChunks = await queryVectorStore(userMessage, topK);

  let systemContent = JARVIS_SYSTEM_PROMPT;

  if (ragChunks.length > 0) {
    const contextBlock = ragChunks
      .map((c, i) => {
        const source = c.metadata.sourceTitle || c.metadata.sourceUrl || "Unknown";
        return `[${i + 1}] Source: ${source}\n${c.content}`;
      })
      .join("\n\n---\n\n");

    systemContent += `\n\n=== KNOWLEDGE BASE CONTEXT ===\nThe following information was retrieved from your knowledge base. Use it to inform your response:\n\n${contextBlock}\n\n=== END CONTEXT ===`;
  }

  const messages: OllamaMessage[] = [
    { role: "system", content: systemContent },
    ...conversationHistory.slice(-10), // Keep last 10 turns for context window
    { role: "user", content: userMessage },
  ];

  return { messages, ragChunks };
}

// ── Non-streaming RAG chat ────────────────────────────────────────────────────
export async function ragChat(
  userMessage: string,
  conversationHistory: OllamaMessage[],
  model?: string
): Promise<{ response: string; ragChunks: VectorSearchResult[] }> {
  await logger.info("rag", `Processing query: "${userMessage.slice(0, 80)}..."`);

  const { messages, ragChunks } = await buildAugmentedMessages(
    userMessage,
    conversationHistory
  );

  const response = await ollamaChat(messages, model);

  await logger.info("rag", `Response generated, used ${ragChunks.length} RAG chunks`);

  return { response, ragChunks };
}

// ── Streaming RAG chat ────────────────────────────────────────────────────────
export async function* ragChatStream(
  userMessage: string,
  conversationHistory: OllamaMessage[],
  model?: string
): AsyncGenerator<{ type: "chunk" | "meta"; data: string | VectorSearchResult[] }> {
  const { messages, ragChunks } = await buildAugmentedMessages(
    userMessage,
    conversationHistory
  );

  // First yield metadata (RAG sources used)
  yield { type: "meta", data: ragChunks };

  // Then stream the response
  for await (const chunk of ollamaChatStream(messages, model)) {
    yield { type: "chunk", data: chunk };
  }
}
