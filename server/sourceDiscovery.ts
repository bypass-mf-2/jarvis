/**
 * Intelligent Source Discovery & Web Crawling System
 *
 * Actually searches the web for new content on every cycle:
 * 1. Analyzes user interests from conversation history
 * 2. Generates search queries for those interests
 * 3. Searches the web (DuckDuckGo/Brave/Google)
 * 4. Fetches and scrapes discovered pages
 * 5. Chunks and stores the content in DB + ChromaDB
 * 6. Prunes low-quality sources over time
 */

import {
  addScrapeSource,
  getScrapeSources,
  updateScrapeSourceStatus,
  getKnowledgeChunks,
  addKnowledgeChunk,
  getSystemLogs,
} from "./db";
import { searchWeb, fetchPageContent } from "./webSearch.js";
import { logger } from "./logger";
import { nanoid } from "nanoid";

// ── Types ──────────────────────────────────────────────────────────────────────
interface UserInterest {
  topic: string;
  weight: number;
  keywords: string[];
}

// ── Text chunking (same logic as scraper.ts) ─────────────────────────────────
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

// Track URLs we've already scraped this session to avoid duplicates
const recentlyScrapedUrls = new Set<string>();
const MAX_RECENT_URLS = 5000;

// Lock to prevent overlapping crawl cycles
let _crawling = false;

// ── Interest Analysis ──────────────────────────────────────────────────────────
async function analyzeUserInterests(): Promise<UserInterest[]> {
  const logs = await getSystemLogs(500);
  const queries = logs
    .filter((l: any) => l.module === "rag" && l.message?.includes("query"))
    .map((l: any) => {
      const match = l.message.match(/"([^"]+)"/);
      return match ? match[1] : null;
    })
    .filter(Boolean);

  if (queries.length >= 5) {
    // Extract topics from user queries using keyword frequency
    // (avoids calling Ollama which competes with user chat)
    const wordFreq = new Map<string, number>();
    const stopWords = new Set([
      // Common English
      "the", "a", "an", "is", "are", "was", "were", "what", "how", "why", "can", "do", "does",
      "this", "that", "with", "for", "and", "but", "not", "you", "your", "about", "from",
      "have", "has", "will", "would", "could", "should", "been", "being", "some", "any", "all",
      "more", "most", "very", "just", "also", "than", "then", "when", "where", "which", "who",
      "whom", "there", "their", "they", "them", "its", "into", "over", "between", "give",
      "recent", "tell", "know", "like", "make", "get", "got", "want", "need", "please",
      "help", "think", "thing", "things", "something", "anything", "nothing", "everything",
      // Chat/command noise (things users say to Jarvis)
      "scrape", "sources", "source", "search", "find", "show", "list", "give", "news",
      "code", "write", "create", "generate", "explain", "tell", "say", "look", "check",
      "use", "using", "work", "working", "run", "running", "start", "stop", "update",
      "new", "old", "good", "bad", "best", "first", "last", "next", "many", "much",
      "really", "actually", "basically", "currently", "recently", "today", "yesterday",
    ]);

    for (const q of queries.slice(0, 50)) {
      // Clean query: remove punctuation, ellipsis, question marks
      const cleaned = (q as string).toLowerCase().replace(/[?.!,;:'"…]+/g, " ").trim();
      const words = cleaned.split(/\s+/).filter((w: string) =>
        w.length > 3 && !stopWords.has(w) && !/^\d+$/.test(w)
      );
      for (const w of words) {
        wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
      }
    }

    const topWords = [...wordFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    if (topWords.length >= 3) {
      const interests: UserInterest[] = [];
      const maxFreq = topWords[0][1];

      for (let i = 0; i < Math.min(topWords.length, 6); i++) {
        const [word, freq] = topWords[i];
        interests.push({
          topic: word.charAt(0).toUpperCase() + word.slice(1),
          weight: freq / maxFreq,
          keywords: [word],
        });
      }

      if (interests.length > 0) return interests;
    }
  }

  return getDefaultInterests();
}

function getDefaultInterests(): UserInterest[] {
  return [
    { topic: "Artificial Intelligence", weight: 0.9, keywords: ["AI", "machine learning", "LLM", "neural network"] },
    { topic: "Technology News", weight: 0.8, keywords: ["tech", "software", "startup", "innovation"] },
    { topic: "Science Research", weight: 0.7, keywords: ["research", "study", "discovery", "breakthrough"] },
    { topic: "Programming", weight: 0.7, keywords: ["coding", "developer", "javascript", "python", "typescript"] },
    { topic: "World News", weight: 0.5, keywords: ["world", "politics", "economy", "global"] },
  ];
}

// ── Generate search queries from interests ───────────────────────────────────
function generateSearchQueries(interests: UserInterest[]): string[] {
  const queries: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  for (const interest of interests) {
    // Current events
    queries.push(`${interest.topic} latest news ${today}`);
    queries.push(`${interest.topic} breaking news today`);
    // Deep content
    queries.push(`${interest.keywords.slice(0, 2).join(" ")} guide tutorial`);
    queries.push(`${interest.keywords.slice(0, 2).join(" ")} explained`);
    // Research / analysis
    queries.push(`${interest.topic} analysis research 2024 2025 2026`);
    queries.push(`${interest.topic} trends predictions`);
    // Opinion / discussion
    queries.push(`${interest.topic} discussion forum`);
  }

  // Shuffle and return up to 20 queries (× 10 results each = 200 candidate URLs → ~100 pages)
  return queries.sort(() => Math.random() - 0.5).slice(0, 20);
}

// ── Scrape a single URL and store chunks ─────────────────────────────────────
async function scrapeAndStore(
  url: string,
  title: string,
  sourceType: "news" | "custom_url" = "custom_url"
): Promise<number> {
  if (recentlyScrapedUrls.has(url)) return 0;

  // Evict old URLs if set is too large
  if (recentlyScrapedUrls.size > MAX_RECENT_URLS) {
    const firstHalf = [...recentlyScrapedUrls].slice(0, MAX_RECENT_URLS / 2);
    firstHalf.forEach((u) => recentlyScrapedUrls.delete(u));
  }
  recentlyScrapedUrls.add(url);

  try {
    const content = await fetchPageContent(url);
    if (!content || content.length < 200) return 0;

    const chunks = chunkText(content);
    let stored = 0;

    for (const chunk of chunks) {
      const chromaId = nanoid();
      try {
        await addKnowledgeChunk({
          sourceUrl: url,
          sourceTitle: title,
          sourceType,
          content: chunk,
          chromaId,
          tags: [],
        });

        // Embedding happens in the background via scraper's embed queue
        // (avoids blocking Ollama and starving user chat)

        stored++;
      } catch {
        // Skip duplicate or failed chunks
      }
    }

    return stored;
  } catch (err) {
    await logger.warn("sourceDiscovery", `Failed to scrape ${url}: ${String(err)}`);
    return 0;
  }
}

// ── Main Web Crawl Cycle ─────────────────────────────────────────────────────
export async function runWebCrawlCycle(): Promise<{
  searched: number;
  pagesScraped: number;
  chunksStored: number;
}> {
  if (_crawling) {
    await logger.info("sourceDiscovery", "Previous crawl still running, skipping");
    return { searched: 0, pagesScraped: 0, chunksStored: 0 };
  }

  _crawling = true;
  await logger.info("sourceDiscovery", "Starting web crawl cycle");

  let searched = 0;
  let pagesScraped = 0;
  let chunksStored = 0;

  try {
    // Step 1: Figure out what to search for (uses defaults if Ollama is busy)
    const interests = await analyzeUserInterests();
    const queries = generateSearchQueries(interests);

    await logger.info(
      "sourceDiscovery",
      `Crawling ${queries.length} queries from ${interests.length} interests`
    );

    // Step 2: Search the web and scrape results (target: 100 pages per cycle)
    const PAGE_TARGET = 100;

    for (const query of queries) {
      if (pagesScraped >= PAGE_TARGET) break;

      try {
        const results = await searchWeb(query, 10);
        searched++;

        for (const result of results) {
          if (pagesScraped >= PAGE_TARGET) break;
          if (recentlyScrapedUrls.has(result.url)) continue;

          const stored = await scrapeAndStore(result.url, result.title, "news");
          if (stored > 0) {
            pagesScraped++;
            chunksStored += stored;
          }
        }
      } catch (err) {
        await logger.warn("sourceDiscovery", `Search failed for "${query}": ${String(err)}`);
      }
    }

    await logger.info(
      "sourceDiscovery",
      `Web crawl complete: ${searched} searches, ${pagesScraped} pages scraped, ${chunksStored} chunks stored`
    );
  } catch (err) {
    await logger.error("sourceDiscovery", `Web crawl cycle failed: ${String(err)}`);
  } finally {
    _crawling = false;
  }

  return { searched, pagesScraped, chunksStored };
}

// ── Also discover and add new RSS sources via real web search ────────────────
export async function discoverNewSources(): Promise<number> {
  const interests = await analyzeUserInterests();
  const existing = await getScrapeSources();
  const existingUrls = new Set(existing.map((s: any) => s.url));
  let added = 0;

  for (const interest of interests.slice(0, 3)) {
    try {
      // Search for RSS feeds on this topic
      const results = await searchWeb(`${interest.topic} RSS feed`, 5);

      for (const result of results) {
        const url = result.url;
        if (existingUrls.has(url)) continue;

        // Check if URL looks like an RSS feed
        const isRSS =
          url.includes("/rss") ||
          url.includes("/feed") ||
          url.includes(".xml") ||
          url.includes("atom");

        if (isRSS) {
          try {
            await addScrapeSource({
              url,
              name: result.title || new URL(url).hostname,
              type: "rss",
              intervalMinutes: 1,
            });
            existingUrls.add(url);
            added++;
            await logger.info("sourceDiscovery", `Discovered new RSS source: ${result.title} (${url})`);
          } catch {
            // skip if already exists or invalid
          }
        }
      }
    } catch (err) {
      await logger.warn("sourceDiscovery", `RSS discovery failed for ${interest.topic}: ${String(err)}`);
    }
  }

  return added;
}

// ── Full Discovery Cycle (RSS discovery + web crawl) ─────────────────────────
export async function runSourceDiscovery(): Promise<{
  discovered: number;
  added: number;
  pruned: number;
  crawl: { searched: number; pagesScraped: number; chunksStored: number };
}> {
  await logger.info("sourceDiscovery", "Starting full source discovery cycle");

  // Phase 1: Discover new RSS sources
  const added = await discoverNewSources();

  // Phase 2: Web crawl — search + scrape live pages
  const crawl = await runWebCrawlCycle();

  await logger.info(
    "sourceDiscovery",
    `Discovery complete: ${added} new RSS sources, ${crawl.chunksStored} chunks from web crawl`
  );

  return { discovered: added + crawl.pagesScraped, added, pruned: 0, crawl };
}

// ── Scheduler ──────────────────────────────────────────────────────────────────
let discoveryInterval: ReturnType<typeof setInterval> | null = null;

export function startSourceDiscoveryScheduler(intervalMs = 60 * 1000): void {
  if (discoveryInterval) return;

  logger.info("sourceDiscovery", `Web crawl scheduler started (every ${intervalMs / 1000}s)`);

  // First crawl 30 seconds after startup (give scraper time to do RSS feeds first)
  setTimeout(() => runWebCrawlCycle(), 30_000);

  // Then run full discovery cycle on interval
  discoveryInterval = setInterval(() => runSourceDiscovery(), intervalMs);
}

export function stopSourceDiscoveryScheduler(): void {
  if (discoveryInterval) {
    clearInterval(discoveryInterval);
    discoveryInterval = null;
    logger.info("sourceDiscovery", "Source discovery scheduler stopped");
  }
}
