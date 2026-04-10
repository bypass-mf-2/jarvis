/**
 * Web scraping engine for continuous knowledge acquisition.
 * Supports RSS feeds, news sites, and arbitrary URLs.
 * Scraped content is chunked, embedded, and stored in both MySQL and ChromaDB.
 * 
 * NEW: Content deduplication - prevents scraping identical content from same source
 */

import { nanoid } from "nanoid";
import crypto from "crypto";
import {
  getScrapeSources,
  addKnowledgeChunk,
  updateScrapeSourceStatus,
  getKnowledgeChunks,
  incrementConsecutiveZeroScrapes,
  resetConsecutiveZeroScrapes,
  toggleScrapeSource,
} from "./db";

// Auto-disable a source after this many consecutive scrapes that returned
// zero parseable items. "Zero items" specifically means the feed/page
// couldn't be parsed at all — NOT "items found but all duplicates", which
// is normal behavior for healthy RSS feeds with no new posts.
const ZERO_SCRAPE_DISABLE_THRESHOLD = 5;
import { addToVectorStore } from "./vectorStore";
import { logger } from "./logger";
import { fetchWithRetry } from "./webSearch";
import { recordEvent as recordImprovementEvent } from "./improvementFeed";

// ── Content Deduplication Cache ─────────────────────────────────────────────
// Track content hashes to prevent duplicate scraping from same source
const contentHashCache = new Map<string, Set<string>>(); // sourceUrl -> Set<contentHash>
const MAX_CACHE_SIZE = 10000; // Per source

// Generate hash of content for deduplication
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content.toLowerCase().trim()).digest('hex');
}

// Check if content already exists from this source
async function isContentDuplicate(sourceUrl: string, content: string): Promise<boolean> {
  const contentHash = hashContent(content);
  
  // Check in-memory cache first (fast)
  if (!contentHashCache.has(sourceUrl)) {
    contentHashCache.set(sourceUrl, new Set());
  }
  
  const sourceCache = contentHashCache.get(sourceUrl)!;
  
  if (sourceCache.has(contentHash)) {
    return true; // Duplicate found in cache
  }
  
  // If cache is full, clear oldest entries
  if (sourceCache.size >= MAX_CACHE_SIZE) {
    const firstHash = sourceCache.values().next().value;
    if (firstHash !== undefined) {
      sourceCache.delete(firstHash);
    }
  }
  
  // Add to cache for future checks
  sourceCache.add(contentHash);
  
  return false; // Not a duplicate
}

// Initialize cache from database on startup
async function initializeDeduplicationCache(): Promise<void> {
  try {
    const chunks = await getKnowledgeChunks(1000); // Get recent 1000 chunks
    
    for (const chunk of chunks) {
      const sourceUrl = chunk.sourceUrl || '';
      const contentHash = hashContent(chunk.content);
      
      if (!contentHashCache.has(sourceUrl)) {
        contentHashCache.set(sourceUrl, new Set());
      }
      
      contentHashCache.get(sourceUrl)!.add(contentHash);
    }
    
    await logger.info('scraper', `Deduplication cache initialized with ${chunks.length} chunks`);
  } catch (err) {
    await logger.warn('scraper', `Failed to initialize dedup cache: ${err}`);
  }
}

// Cache is initialized from services.ts after SQLite is ready (do NOT call here —
// this module is imported before initializeSQLiteDatabase() finishes).

// ── Text utilities ────────────────────────────────────────────────────────────
// Strips HTML to plain text while preserving anchor URLs as inline
// "text (url)" so downstream chunks keep the actual link destinations.
// Without this preservation, asking Jarvis "what was the link to X?" had
// no way to answer — the href data was destroyed before chunking.
function stripHtml(html: string, baseUrl?: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    // Preserve anchor URLs: <a href="X">text</a> → text (X). When baseUrl
    // is provided, relative hrefs are resolved to absolute. Skips fragment,
    // mailto, and javascript hrefs since they're not useful as references.
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) {
        return text;
      }
      let resolved = href;
      if (baseUrl) {
        try { resolved = new URL(href, baseUrl).toString(); } catch { /* keep raw */ }
      }
      return `${text} (${resolved})`;
    })
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkText(text: string, maxChars = 800): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + " " + sentence).length > maxChars && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 80);
}

// ── RSS Feed scraper ──────────────────────────────────────────────────────────
async function scrapeRSS(url: string): Promise<Array<{ title: string; content: string; link: string }>> {
  const res = await fetchWithRetry(url, {
    headers: { "User-Agent": "JarvisAI/1.0 RSS Reader" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
  const xml = await res.text();

  const items: Array<{ title: string; content: string; link: string }> = [];

  // Parse <item> blocks
  const itemMatches = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi));
  for (const match of itemMatches) {
    const block = match[1];
    const title = block.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]>|<title[^>]*>(.*?)<\/title>/i);
    const desc = block.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]>|<description[^>]*>([\s\S]*?)<\/description>/i);
    const link = block.match(/<link[^>]*>(.*?)<\/link>/i);

    const titleText = (title?.[1] || title?.[2] || "").trim();
    const linkText = (link?.[1] || "").trim();
    // Use the per-item link as the base URL when resolving relative anchors
    // inside the item description; falls back to the feed URL if missing.
    const descText = stripHtml(desc?.[1] || desc?.[2] || "", linkText || url).slice(0, 2000);

    if (titleText && descText) {
      items.push({ title: titleText, content: descText, link: linkText });
    }
  }

  return items.slice(0, 20); // max 20 items per feed
}

// ── Generic URL scraper ───────────────────────────────────────────────────────
async function scrapeURL(url: string): Promise<{ title: string; content: string }> {
  const res = await fetchWithRetry(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`URL fetch failed: ${res.status}`);
  const html = await res.text();

  // Extract title
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  const title = stripHtml(titleMatch?.[1] ?? "").trim() || url;

  // Extract main content (prefer <article>, <main>, <body>)
  let contentHtml =
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
    html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ||
    html;

  // Pass the page URL so relative anchor hrefs resolve to absolute links.
  const content = stripHtml(contentHtml, url).slice(0, 8000);
  return { title, content };
}

// ── Queue of chunks waiting to be embedded (processed in background) ─────────
interface PendingEmbed {
  chromaId: string;
  content: string;
  metadata: Record<string, string>;
}
const _embedQueue: PendingEmbed[] = [];
let _embeddingInProgress = false;

// Process embed queue in background — 1 chunk at a time with pauses
// so Ollama stays responsive for user chat
async function processEmbedQueue(): Promise<void> {
  if (_embeddingInProgress || _embedQueue.length === 0) return;
  _embeddingInProgress = true;

  try {
    while (_embedQueue.length > 0) {
      const item = _embedQueue.shift()!;
      try {
        await addToVectorStore(item.chromaId, item.content, item.metadata);
      } catch {
        // skip failed embeds
      }
      // Small pause between embeds to let user chat requests through
      await new Promise((r) => setTimeout(r, 200));
    }
  } finally {
    _embeddingInProgress = false;
  }
}

// Start background embed processor (runs every 10s)
setInterval(() => processEmbedQueue(), 10_000);

// ── Store chunks to DB (embedding is queued for background) ─────────────────
async function storeChunks(
  sourceId: number,
  sourceUrl: string,
  sourceTitle: string,
  sourceType: "rss" | "news" | "custom_url",
  content: string,
  itemTitle?: string
): Promise<number> {
  const chunks = chunkText(content);
  let stored = 0;
  let duplicates = 0;

  for (const chunk of chunks) {
    // ✅ CHECK FOR DUPLICATES BEFORE STORING
    const isDuplicate = await isContentDuplicate(sourceUrl, chunk);
    
    if (isDuplicate) {
      duplicates++;
      continue; // Skip this chunk, it's a duplicate from this source
    }

    const chromaId = nanoid();
    try {
      const row = await addKnowledgeChunk({
        sourceUrl,
        sourceTitle: itemTitle || sourceTitle,
        sourceType,
        content: chunk,
        chromaId,
        embeddingModel: "nomic-embed-text",
        scrapedAt: new Date(),
      });

      // Queue for background embedding (with low priority)
      _embedQueue.push({
        chromaId,
        content: chunk,
        metadata: {
          sourceUrl,
          sourceTitle: itemTitle || sourceTitle,
          sourceType,
        },
      });

      stored++;
    } catch (err) {
      await logger.error("scraper", `Failed to store chunk: ${err}`);
    }
  }

  if (duplicates > 0) {
    await logger.info('scraper', `Skipped ${duplicates} duplicate chunks from ${sourceUrl}`);
  }

  return stored;
}

// Auto-disable policy: a "broken" scrape is one where the source produced
// no parseable items at all (e.g., HTML page treated as RSS, dead URL).
// A scrape that parses items but stores 0 chunks (because every chunk was
// already in the cache) is HEALTHY and resets the counter.
async function recordScrapeHealth(id: number, name: string, url: string, isBroken: boolean): Promise<void> {
  if (!isBroken) {
    await resetConsecutiveZeroScrapes(id);
    return;
  }
  const newCount = await incrementConsecutiveZeroScrapes(id);
  if (newCount >= ZERO_SCRAPE_DISABLE_THRESHOLD) {
    await toggleScrapeSource(id, false);
    await logger.warn(
      "scraper",
      `Auto-disabled "${name}" after ${newCount} consecutive failed scrapes — re-enable manually if this was a transient issue`
    );
    recordImprovementEvent({
      type: "scrape_auto_disable",
      module: "scraper",
      summary: `Auto-disabled source "${name}" after ${newCount} broken scrapes`,
      details: { sourceId: id, name, url, consecutiveFailures: newCount },
    });
  }
}

// ── Scrape single source ──────────────────────────────────────────────────────
async function scrapeSource(source: any): Promise<{ success: boolean; chunks: number }> {
  const { id, name, url, type } = source;

  try {
    await logger.info("scraper", `Scraping source: ${name} (${url})`);

    let totalChunks = 0;
    let itemsParsed = 0;

    if (type === "rss") {
      const items = await scrapeRSS(url);
      itemsParsed = items.length;
      for (const item of items) {
        const combined = `${item.title}\n\n${item.content}`;
        const stored = await storeChunks(id, url, name, "rss", combined, item.title);
        totalChunks += stored;
      }
    } else if (type === "custom_url") {
      const { title, content } = await scrapeURL(url);
      itemsParsed = content && content.trim().length > 0 ? 1 : 0;
      totalChunks = await storeChunks(id, url, name, "custom_url", content, title);
    }

    await updateScrapeSourceStatus(id, "success", undefined, totalChunks);
    await recordScrapeHealth(id, name, url, itemsParsed === 0);
    await logger.info("scraper", `Scraped ${totalChunks} chunks from ${name}`);

    return { success: true, chunks: totalChunks };
  } catch (err) {
    await logger.error("scraper", `Failed to scrape ${name}: ${err}`);
    await updateScrapeSourceStatus(id, "error");
    await recordScrapeHealth(id, name, url, true);
    return { success: false, chunks: 0 };
  }
}

// ── Scrape all sources ────────────────────────────────────────────────────────
export async function scrapeAllSources(): Promise<{ succeeded: number; failed: number }> {
  const sources = await getScrapeSources();
  let succeeded = 0;
  let failed = 0;

  for (const source of sources) {
    if (source.isActive === false || source.isActive === 0) continue;
    const result = await scrapeSource(source);
    if (result.success) succeeded++;
    else failed++;
  }

  return { succeeded, failed };
}

// ── Scheduler ──────────────────────────────────────────────────────────────────
let _schedulerInterval: NodeJS.Timeout | null = null;
let _scraperRunning = false;
let _scraperEnabled = true;

// Global enable/disable — gates the scheduler tick. Manual scrapeSource/
// scrapeAllSources calls are intentionally left alone so the user can still
// trigger one-off scrapes while background scraping is paused.
export function isScraperEnabled(): boolean {
  return _scraperEnabled;
}

export function setScraperEnabled(enabled: boolean): void {
  if (_scraperEnabled === enabled) return;
  _scraperEnabled = enabled;
  logger.info("scraper", `Scraper ${enabled ? "enabled" : "disabled"} via global toggle`);
}

export function startScraperScheduler(intervalMs: number = 60_000): void {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
  }

  logger.info("scraper", `Scraper scheduler started (checking every ${intervalMs / 1000}s)`);

  _schedulerInterval = setInterval(async () => {
    // Global pause — skip entire tick while scraping is disabled.
    if (!_scraperEnabled) return;
    // Skip this tick if a previous tick is still running — prevents pile-up
    // when sources are slow or numerous.
    if (_scraperRunning) return;
    _scraperRunning = true;

    try {
      const sources = await getScrapeSources();
      const now = Date.now();
      const due = sources.filter((s: any) => {
        // Skip inactive sources — including ones the auto-disable policy
        // turned off after repeated failures.
        if (s.isActive === false || s.isActive === 0) return false;
        if (!s.lastScrapedAt) return true;
        const nextScrape = s.lastScrapedAt + (s.intervalMinutes || 60) * 60_000;
        return now >= nextScrape;
      });

      if (due.length === 0) return;

      await logger.info("scraper", `Scraping ${due.length} due sources (${sources.length - due.length} not yet due)`);

      // scrapeSource() already calls updateScrapeSourceStatus() with the real
      // success/error result. Do NOT overwrite it here, and do NOT additionally
      // re-scrape every source via scrapeAllSources() — that was a double-scrape bug.
      //
      // Check _scraperEnabled BETWEEN sources so that toggling the switch off
      // mid-cycle stops within seconds instead of burning through all 60+ due
      // sources (each generating dozens of embedding calls that starve Ollama
      // and make the user's chat time out).
      for (const source of due) {
        if (!_scraperEnabled) {
          await logger.info("scraper", "Aborting in-flight scrape cycle (scraper disabled mid-cycle)");
          break;
        }
        await scrapeSource(source);
      }
    } finally {
      _scraperRunning = false;
    }
  }, intervalMs);
}

export function stopScraperScheduler(): void {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
    logger.info("scraper", "Scraper scheduler stopped");
  }
}

// Export deduplication utilities for testing
export { scrapeSource, isContentDuplicate, hashContent, initializeDeduplicationCache };