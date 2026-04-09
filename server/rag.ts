/**
 * RAG (Retrieval-Augmented Generation) pipeline.
 * Retrieves relevant knowledge chunks from the vector store and injects
 * them into the LLM prompt as context, enabling Jarvis to answer questions
 * based on continuously scraped web knowledge.
 */

import { queryVectorStore, type VectorSearchResult } from "./vectorStore";
import { ollamaChat, ollamaChatStream, type OllamaMessage } from "./ollama";
import { logger } from "./logger";
import { getMemoryContext } from "./persistentMemory";
import { searchWeb } from "./webSearch.js";
import { smartRouteModel } from "./autoTrain.js";

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

  // ✅ ADD THIS: Get persistent memory
  const memoryContext = await getMemoryContext(userMessage);

  // Optionally: Web search for current info
  let webContext = "";
  const useWebSearch = process.env.ENABLE_WEB_SEARCH === "true";
  if (useWebSearch) {
    const searchResults = await searchWeb(userMessage, 3);
    webContext = `\n\n=== WEB SEARCH RESULTS ===\n` +
      searchResults.map(r => `${r.title}: ${r.snippet}`).join("\n\n");
  }

  let systemContent = JARVIS_SYSTEM_PROMPT;

  // ✅ ADD WORLD CLOCK AND TIMEZONE INFO
  const now = new Date();
  const timeInfo = `\n\n=== CURRENT DATE & TIME ===
Current UTC Time: ${now.toUTCString()}
Current Local Time: ${now.toLocaleString('en-US', { timeZone: 'America/Denver', timeZoneName: 'short' })}
Unix Timestamp: ${now.getTime()}
ISO 8601: ${now.toISOString()}

Note: All message timestamps in the conversation history are in milliseconds since Unix epoch. 
You can use this to understand the chronological order of events and calculate time differences.
=== END TIME INFO ===`;

  systemContent += timeInfo;

    // ✅ ADD THIS: Include memory in system prompt
  if (memoryContext) {
    systemContent += "\n\n" + memoryContext;
  }

  if (ragChunks.length > 0) {
    const contextBlock = ragChunks
      .map((c, i) => {
        const source = c.metadata.sourceTitle || c.metadata.sourceUrl || "Unknown";
        return `[${i + 1}] Source: ${source}\n${c.content}`;
      })
      .join("\n\n---\n\n");

    systemContent += `\n\n=== KNOWLEDGE BASE CONTEXT ===\nThe following information was retrieved from your knowledge base. Use it to inform your response:\n\n${contextBlock}\n\n=== END CONTEXT ===`;
  }

  // Add web search
  if (webContext) {
    systemContent += webContext;
  }

  const messages: OllamaMessage[] = [
    { role: "system", content: systemContent },
    ...conversationHistory.slice(-10).map((msg, idx) => {
      // Add timestamp info to help AI understand chronology
      // If message has createdAt, include it
      const msgWithTime = msg as any;
      if (msgWithTime.createdAt) {
        const msgDate = new Date(msgWithTime.createdAt);
        const timeAgo = Math.floor((Date.now() - msgDate.getTime()) / 1000);
        const timeStr = timeAgo < 60 
          ? `${timeAgo}s ago` 
          : timeAgo < 3600 
          ? `${Math.floor(timeAgo / 60)}m ago`
          : timeAgo < 86400
          ? `${Math.floor(timeAgo / 3600)}h ago`
          : `${Math.floor(timeAgo / 86400)}d ago`;
        
        return {
          role: msg.role,
          content: `[${timeStr}] ${msg.content}`
        };
      }
      return msg;
    }),
    { role: "user", content: userMessage },
  ];

  return { messages, ragChunks };
}

// ── Non-streaming RAG chat ────────────────────────────────────────────────────
export async function ragChat(
  userMessage: string,
  conversationHistory: OllamaMessage[],
  modelOverride?: string
): Promise<{ response: string; ragChunks: VectorSearchResult[] }> {
  await logger.info("rag", `Processing query: "${userMessage.slice(0, 80)}..."`);

  const { messages, ragChunks } = await buildAugmentedMessages(
    userMessage,
    conversationHistory
  );
  // Smart model selection (unless overridden)
  const model = modelOverride || await smartRouteModel(userMessage);

  logger.info("rag", `Using model: ${model} for query: ${userMessage.slice(0, 50)}...`);
  // Get response
  const response = await ollamaChat(messages, model);

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