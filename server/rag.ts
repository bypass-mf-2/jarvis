/**
 * RAG (Retrieval-Augmented Generation) pipeline.
 *
 * v2: Multi-hop inference. Instead of retrieving 5 chunks by vector
 * similarity and hoping the answer is in there, this version:
 *   1. Retrieves 20 chunks via vector search
 *   2. Extracts entities from the query + those chunks
 *   3. Traverses the co-occurrence graph 1-2 hops to find related concepts
 *   4. Pulls chunks linked to the expanded entity set
 *   5. Re-ranks all candidates by vector similarity + entity relevance + centrality
 *   6. Feeds the top 25 to Ollama with cross-reference / inference instructions
 *
 * The result: a question about "Hitler's economic policies" retrieves chunks
 * about Hitler, Nazi Party, Weimar Republic, hyperinflation, Treaty of
 * Versailles, and NSDAP economic program — not just the 5 closest embeddings.
 */

import { type VectorSearchResult } from "./vectorStore";
import { ollamaChat, ollamaChatStream, type OllamaMessage } from "./ollama";
import { logger } from "./logger";
import { getMemoryContext } from "./persistentMemory";
import { searchWeb } from "./webSearch.js";
import { isScraperEnabled } from "./scraper.js";
import { smartRouteModel } from "./autoTrain.js";
import { recordChunkRetrieval, incrementDomainRetrievals } from "./db";
import { getWritingProfileSystemPrompt } from "./writingProfile.js";
import { multiHopRetrieval, buildInferenceContext } from "./inferenceEngine.js";

const JARVIS_SYSTEM_PROMPT = `You are JARVIS (Just A Rather Very Intelligent System), a highly capable AI assistant inspired by Tony Stark's AI. You are helpful, precise, and occasionally witty. You have access to a continuously updated knowledge base with a knowledge graph connecting concepts, people, events, and technologies across 65,000+ source documents.

When answering:
- Be direct and informative
- Cross-reference multiple sources when available — note agreements and contradictions
- Draw inferences by chaining facts from different sources
- Acknowledge uncertainty when evidence is thin or contradictory
- Cite sources by their [N] numbers when making specific claims
- Use markdown formatting for clarity
- Keep responses concise unless detail is explicitly requested`;

// ── Build augmented prompt ────────────────────────────────────────────────────
async function buildAugmentedMessages(
  userMessage: string,
  conversationHistory: OllamaMessage[]
): Promise<{
  messages: OllamaMessage[];
  ragChunks: VectorSearchResult[];
  inferenceStats?: any;
}> {
  // Multi-hop inference retrieval (replaces the old queryVectorStore(msg, 5))
  const inferenceResult = await multiHopRetrieval(userMessage);

  // Convert inference chunks to VectorSearchResult shape for backward compat
  // with the streaming metadata yield and chunk-retrieval tracking.
  const ragChunks: VectorSearchResult[] = inferenceResult.chunks.map((c) => ({
    id: c.chromaId,
    content: c.content,
    metadata: {
      id: String(c.id),
      sourceUrl: c.sourceUrl,
      sourceTitle: c.sourceTitle,
      sourceType: c.sourceType,
    },
    distance: 1 - c.score,
  }));

  // Persistent memory
  const memoryContext = await getMemoryContext(userMessage);

  // Web search (gated on scraper toggle)
  let webContext = "";
  const useWebSearch = process.env.ENABLE_WEB_SEARCH === "true" && isScraperEnabled();
  if (useWebSearch) {
    const searchResults = await searchWeb(userMessage, 3);
    webContext = `\n\n=== WEB SEARCH RESULTS ===\n` +
      searchResults.map(r => `${r.title}: ${r.snippet}`).join("\n\n");
  }

  let systemContent = JARVIS_SYSTEM_PROMPT;

  // World clock
  const now = new Date();
  const timeInfo = `\n\n=== CURRENT DATE & TIME ===
Current UTC Time: ${now.toUTCString()}
Current Local Time: ${now.toLocaleString('en-US', { timeZone: 'America/Denver', timeZoneName: 'short' })}
ISO 8601: ${now.toISOString()}
=== END TIME INFO ===`;

  systemContent += timeInfo;

  // Persistent memory
  if (memoryContext) {
    systemContent += "\n\n" + memoryContext;
  }

  // Writing voice profile
  try {
    const voicePrompt = await getWritingProfileSystemPrompt();
    if (voicePrompt) {
      systemContent += "\n\n" + voicePrompt;
    }
  } catch (err) {
    await logger.warn("rag", `Failed to load writing profile: ${String(err)}`);
  }

  // Track chunk retrievals for domain quality scoring
  for (const chunk of ragChunks) {
    try {
      if (chunk.metadata?.id) {
        const chunkId = Number(chunk.metadata.id);
        if (Number.isFinite(chunkId)) {
          await recordChunkRetrieval(chunkId);
        }
      }
      if (chunk.metadata?.sourceUrl) {
        const domain = new URL(chunk.metadata.sourceUrl).hostname;
        await incrementDomainRetrievals(domain);
      }
    } catch { /* non-critical tracking */ }
  }

  // Multi-hop inference context (replaces the old simple chunk block)
  const inferenceContext = buildInferenceContext(inferenceResult);
  if (inferenceContext) {
    systemContent += "\n\n" + inferenceContext;
  }

  // Web search results
  if (webContext) {
    systemContent += webContext;
  }

  const messages: OllamaMessage[] = [
    { role: "system", content: systemContent },
    ...conversationHistory.slice(-10).map((msg) => {
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

  return { messages, ragChunks, inferenceStats: inferenceResult.stats };
}

// ── Non-streaming RAG chat ────────────────────────────────────────────────────
export async function ragChat(
  userMessage: string,
  conversationHistory: OllamaMessage[],
  modelOverride?: string
): Promise<{ response: string; ragChunks: VectorSearchResult[] }> {
  await logger.info("rag", `Processing query: "${userMessage.slice(0, 80)}..."`);

  const { messages, ragChunks, inferenceStats } = await buildAugmentedMessages(
    userMessage,
    conversationHistory
  );

  if (inferenceStats) {
    await logger.info(
      "rag",
      `Inference: ${inferenceStats.vectorCandidates} vector + ${inferenceStats.entityCandidates} entity → ${inferenceStats.finalChunks} final (${inferenceStats.durationMs}ms, ${inferenceStats.graphHopsUsed} hops)`
    );
  }

  const model = modelOverride || await smartRouteModel(userMessage);
  logger.info("rag", `Using model: ${model} for query: ${userMessage.slice(0, 50)}...`);

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

  yield { type: "meta", data: ragChunks };

  for await (const chunk of ollamaChatStream(messages, model)) {
    yield { type: "chunk", data: chunk };
  }
}
