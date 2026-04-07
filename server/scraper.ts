/**
 * Web scraping engine for continuous knowledge acquisition.
 * Supports RSS feeds, news sites, and arbitrary URLs.
 * Scraped content is chunked, embedded, and stored in both MySQL and ChromaDB.
 */

import { nanoid } from "nanoid";
import {
  getScrapeSources,
  addKnowledgeChunk,
  updateScrapeSourceStatus,
} from "./db";
import { addToVectorStore } from "./vectorStore";
import { logger } from "./logger";

// ── Text utilities ────────────────────────────────────────────────────────────
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
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
  const res = await fetch(url, {
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
    const descText = stripHtml(desc?.[1] || desc?.[2] || "").slice(0, 2000);
    const linkText = (link?.[1] || "").trim();

    if (titleText && descText) {
      items.push({ title: titleText, content: descText, link: linkText });
    }
  }

  return items.slice(0, 20); // max 20 items per feed
}

// ── Generic URL scraper ───────────────────────────────────────────────────────
async function scrapeURL(url: string): Promise<{ title: string; content: string }> {
  const res = await fetch(url, {
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

  const content = stripHtml(contentHtml).slice(0, 8000);
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

  for (const chunk of chunks) {
    const chromaId = nanoid();
    try {
      const row = await addKnowledgeChunk({
        sourceUrl,
        sourceTitle: itemTitle || sourceTitle,
        sourceType,
        content: chunk,
        chromaId,
        tags: [],
      });

      // Queue embedding for background processing (don't block scraping or Ollama)
      _embedQueue.push({
        chromaId,
        content: chunk,
        metadata: {
          sourceUrl,
          sourceTitle: itemTitle || sourceTitle,
          sourceType,
          dbId: String(row?.id ?? ""),
        },
      });

      stored++;
    } catch (err) {
      await logger.warn("scraper", `Failed to store chunk: ${String(err)}`);
    }
  }

  return stored;
}

// ── Scrape a single source ────────────────────────────────────────────────────
export async function scrapeSource(source: {
  id: number;
  url: string;
  name: string;
  type: "rss" | "news" | "custom_url";
}): Promise<{ chunksAdded: number; error?: string }> {
  await logger.info("scraper", `Scraping source: ${source.name} (${source.url})`);

  try {
    let totalChunks = 0;

    if (source.type === "rss") {
      const items = await scrapeRSS(source.url);
      for (const item of items) {
        const added = await storeChunks(
          source.id,
          item.link || source.url,
          source.name,
          "rss",
          `${item.title}\n\n${item.content}`,
          item.title
        );
        totalChunks += added;
      }
    } else {
      const { title, content } = await scrapeURL(source.url);
      totalChunks = await storeChunks(
        source.id,
        source.url,
        source.name,
        source.type,
        content,
        title
      );
    }

    await updateScrapeSourceStatus(source.id, "success", undefined, totalChunks);
    await logger.info("scraper", `Scraped ${totalChunks} chunks from ${source.name}`);
    return { chunksAdded: totalChunks };
  } catch (err) {
    const errorMsg = String(err);
    await updateScrapeSourceStatus(source.id, "error", errorMsg);
    await logger.error("scraper", `Failed to scrape ${source.name}: ${errorMsg}`);
    return { chunksAdded: 0, error: errorMsg };
  }
}

// ── Scrape lock (prevents overlapping cycles) ───────────────────────────────
let _scraping = false;

// ── Scrape sources that are due (respects per-source intervalMinutes) ────────
export async function scrapeDueSources(): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}> {
  if (_scraping) {
    await logger.info("scraper", "Previous scrape still running, skipping this cycle");
    return { total: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  _scraping = true;
  try {
    const sources = await getScrapeSources();
    const active = sources.filter((s: any) => s.isActive === true || s.isActive === 1);

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    const due: typeof active = [];

    for (const source of active) {
      const intervalMin = source.intervalMinutes || 15;
      const lastScraped = source.lastScrapedAt
        ? new Date(source.lastScrapedAt).getTime()
        : 0;
      const minutesSince = (Date.now() - lastScraped) / 60_000;

      if (minutesSince >= intervalMin) {
        due.push(source);
      } else {
        skipped++;
      }
    }

    if (due.length === 0) return { total: 0, succeeded: 0, failed: 0, skipped };

    await logger.info("scraper", `Scraping ${due.length} due sources (${skipped} not yet due)`);

    for (const source of due) {
      const result = await scrapeSource({
        id: source.id,
        url: source.url,
        name: source.name,
        type: source.type,
      });
      if (result.error) failed++;
      else succeeded++;
    }

    await logger.info("scraper", `Scrape complete: ${succeeded} succeeded, ${failed} failed`);
    return { total: due.length, succeeded, failed, skipped };
  } finally {
    _scraping = false;
  }
}

// ── Scrape all (force, for manual trigger) ───────────────────────────────────
export async function scrapeAllSources(): Promise<{
  total: number;
  succeeded: number;
  failed: number;
}> {
  if (_scraping) {
    return { total: 0, succeeded: 0, failed: 0 };
  }

  _scraping = true;
  try {
    const sources = await getScrapeSources();
    const active = sources.filter((s: any) => s.isActive === true || s.isActive === 1);
    await logger.info("scraper", `Force scraping all ${active.length} sources`);

    let succeeded = 0;
    let failed = 0;

    for (const source of active) {
      const result = await scrapeSource({
        id: source.id,
        url: source.url,
        name: source.name,
        type: source.type,
      });
      if (result.error) failed++;
      else succeeded++;
    }

    await logger.info("scraper", `Scrape complete: ${succeeded} succeeded, ${failed} failed`);
    return { total: active.length, succeeded, failed };
  } finally {
    _scraping = false;
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
let scraperInterval: ReturnType<typeof setInterval> | null = null;

export function startScraperScheduler(intervalMs = 60 * 1000): void {
  if (scraperInterval) return;
  logger.info("scraper", `Scraper scheduler started (checking every ${intervalMs / 1000}s)`);
  // Initial scrape after 15 seconds
  setTimeout(() => scrapeDueSources(), 15_000);
  // Then check which sources are due every tick
  scraperInterval = setInterval(() => scrapeDueSources(), intervalMs);
}

export function stopScraperScheduler(): void {
  if (scraperInterval) {
    clearInterval(scraperInterval);
    scraperInterval = null;
    logger.info("scraper", "Scraper scheduler stopped");
  }
}
