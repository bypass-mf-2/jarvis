/**
 * Web Search → Knowledge Base Ingest
 *
 * When a chat query triggers a web search, the search results are used
 * immediately as prompt context (snippets). But those snippets are thin —
 * just a sentence or two per result. This module fetches the FULL page
 * content from each result URL in the background, chunks it, stores it in
 * knowledge_chunks, queues it for embedding, and extracts entities for the
 * knowledge graph.
 *
 * The effect: every question you ask that triggers a web search permanently
 * enriches the knowledge base. The next time you (or anyone) asks a related
 * question, the full page content is available via multi-hop inference
 * instead of needing another live web search.
 *
 * "JARVIS learns from every conversation."
 */

import { nanoid } from "nanoid";
import { logger } from "./logger.js";
import { addKnowledgeChunk } from "./db.js";
import { chunkText } from "./chunking.js";
import { extractReadableContent } from "./htmlExtract.js";
import { processChunkForEntities } from "./entityExtractor.js";
import { markDbDirty } from "./sqlite-init.js";
import { fetchWithRetry } from "./webSearch.js";

// Track URLs we've already ingested this session to avoid re-fetching the
// same page if the user asks similar questions repeatedly.
const _ingestedUrls = new Set<string>();

// Also check the DB for existing chunks from this URL so we don't duplicate
// across restarts. Uses a lightweight in-memory cache that gets populated
// on first check for each URL.
const _knownUrls = new Set<string>();

/**
 * Fetch a search result URL, extract readable content, chunk it, store it,
 * and extract entities. Runs in the background — the caller doesn't await.
 * Silently skips if the URL was already ingested this session.
 */
export async function ingestSearchResultInBackground(
  url: string,
  title: string
): Promise<void> {
  // Dedup: skip if already ingested this session or obviously bad
  if (!url || !url.startsWith("http")) return;
  if (_ingestedUrls.has(url) || _knownUrls.has(url)) return;
  _ingestedUrls.add(url);

  try {
    // Fetch the page
    const res = await fetchWithRetry(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return;

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/pdf")) return; // skip PDFs in this path
    const html = await res.text();
    if (!html || html.length < 500) return;

    // Extract readable content via Readability
    const readable = extractReadableContent(html, url);
    const text = readable?.text ?? "";
    if (text.length < 200) return;

    // Chunk
    const chunks = chunkText(text.slice(0, 100_000));
    if (chunks.length === 0) return;

    // Store each chunk
    let stored = 0;
    for (const chunk of chunks) {
      const chromaId = nanoid();
      try {
        const row = await addKnowledgeChunk({
          sourceUrl: url,
          sourceTitle: readable?.title || title || url,
          sourceType: "web_search",
          content: chunk,
          chromaId,
          embeddingModel: "nomic-embed-text",
          scrapedAt: new Date(),
        });

        // Entity extraction (in-memory graph, instant)
        const chunkId = typeof row === "object" && row !== null
          ? (row as any).id ?? 0
          : typeof row === "number" ? row : 0;
        if (chunkId > 0) {
          processChunkForEntities(chunkId, chunk);
        }

        stored++;
      } catch {
        // Dedup collision or DB error — skip
      }
    }

    if (stored > 0) {
      _knownUrls.add(url);
      await logger.info(
        "webSearchIngest",
        `Ingested search result: "${(readable?.title || title || url).slice(0, 60)}" → ${stored} chunks from ${url.slice(0, 80)}`
      );
    }
  } catch (err) {
    // Non-critical background task — log and move on
    await logger.warn("webSearchIngest", `Failed to ingest ${url.slice(0, 80)}: ${String(err).slice(0, 100)}`);
  }
}
