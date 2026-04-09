/**
 * ULTRA-AGGRESSIVE Source Discovery & Web Crawling System
 *
 * Now uses the hybrid scraper fleet for maximum learning speed:
 * - 50-500 searches/minute (depending on API keys)
 * - Intelligent source discovery
 * - Automatic quality filtering
 * - Cost optimization
 * - Real-time knowledge acquisition
 */

import {
  addScrapeSource,
  getScrapeSources,
  addKnowledgeChunk,
  getSystemLogs,
} from "./db";
import { aggressiveBatchSearch, getScraperStats, getTotalScrapingCost } from "./aggressiveScraper.js";
import { fetchPageContent } from "./webSearch.js";
import { logger } from "./logger";
import { nanoid } from "nanoid";

// ── Types ──────────────────────────────────────────────────────────────────────
interface UserInterest {
  topic: string;
  weight: number;
  keywords: string[];
}

// ── Text chunking ──────────────────────────────────────────────────────────────
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

// Track URLs we've already scraped
const recentlyScrapedUrls = new Set<string>();
const MAX_RECENT_URLS = 5000;

// Lock to prevent overlapping cycles
let _crawling = false;

// ── Interest Analysis (same as before) ─────────────────────────────────────────
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
    const wordFreq = new Map<string, number>();
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "what", "how", "why", "can", "do", "does",
      "this", "that", "with", "for", "and", "but", "not", "you", "your", "about", "from",
      "have", "has", "will", "would", "could", "should", "been", "being", "some", "any", "all",
      "more", "most", "very", "just", "also", "than", "then", "when", "where", "which", "who",
      "whom", "there", "their", "they", "them", "its", "into", "over", "between", "give",
      "recent", "tell", "know", "like", "make", "get", "got", "want", "need", "please",
      "help", "think", "thing", "things", "something", "anything", "nothing", "everything",
      "scrape", "sources", "source", "search", "find", "show", "list", "give", "news",
      "code", "write", "create", "generate", "explain", "tell", "say", "look", "check",
      "use", "using", "work", "working", "run", "running", "start", "stop", "update",
      "new", "old", "good", "bad", "best", "first", "last", "next", "many", "much",
      "really", "actually", "basically", "currently", "recently", "today", "yesterday",
    ]);

    for (const q of queries.slice(0, 50)) {
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
      .slice(0, 10)
      .map(([word]) => word);

    return [
      {
        topic: topWords.slice(0, 3).join(" "),
        weight: 1.0,
        keywords: topWords,
      },
    ];
  }

  // Default interests
  return [
    {
      topic: "Technology News",
      weight: 0.9,
      keywords: ["technology", "tech", "software", "hardware", "gadgets"],
    },
    {
      topic: "Artificial Intelligence",
      weight: 1.0,
      keywords: ["ai", "artificial intelligence", "machine learning", "llm"],
    },
    {
      topic: "Programming",
      weight: 0.7,
      keywords: ["programming", "coding", "developer", "software"],
    },
    {
      topic: "Science Research",
      weight: 0.6,
      keywords: ["science", "research", "study", "discovery"],
    },
    {
      topic: "World News",
      weight: 0.5,
      keywords: ["world", "news", "politics", "global"],
    },
  ];
}

// ── Generate Search Queries ────────────────────────────────────────────────────
function generateSearchQueries(interests: UserInterest[]): string[] {
  const queries: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  const patterns = [
    (t: string) => `${t} latest news ${today}`,
    (t: string) => `${t} breaking news today`,
    (t: string) => `${t} trends predictions`,
    (t: string) => `${t} analysis research 2024 2025 2026`,
    (t: string) => `${t} discussion forum`,
    (t: string) => `${t} explained`,
    (t: string) => `${t} guide tutorial`,
  ];

  for (const interest of interests.slice(0, 5)) {
    for (const pattern of patterns.slice(0, 4)) {
      queries.push(pattern(interest.topic));
    }
  }

  return queries;
}

// ── Discover RSS Sources ───────────────────────────────────────────────────────
async function discoverRSSSources(interests: UserInterest[]): Promise<number> {
  await logger.info("sourceDiscovery", "Starting full source discovery cycle");

  const queries = interests.map(i => `${i.topic} RSS feed`);
  
  try {
    const searchResults = await aggressiveBatchSearch(queries);
    let addedCount = 0;

    for (const results of searchResults) {
      const urls = results.results 
        ? parseAPIResultsForRSS(results.results)
        : parseHTMLResultsForRSS(results.results);

      for (const url of urls.slice(0, 3)) {
        try {
          const existing = await getScrapeSources();
          const alreadyExists = existing.some((s: any) => s.url === url);

          if (!alreadyExists) {
            await addScrapeSource({
              name: `Auto-discovered: ${url.slice(0, 50)}`,
              url,
              type: "rss",
              intervalMinutes: 30,
            });
            addedCount++;
            await logger.info("sourceDiscovery", `Added new RSS source: ${url}`);
          }
        } catch (err) {
          await logger.warn("sourceDiscovery", `Failed to add source ${url}: ${err}`);
        }
      }
    }

    return addedCount;
  } catch (err) {
    await logger.error("sourceDiscovery", `RSS discovery failed: ${err}`);
    return 0;
  }
}

function parseAPIResultsForRSS(data: any): string[] {
  const urls: string[] = [];
  
  // Extract URLs that might be RSS feeds
  if (Array.isArray(data)) {
    for (const item of data) {
      const url = item.url || item.link || '';
      if (url.includes('rss') || url.includes('feed') || url.includes('.xml')) {
        urls.push(url);
      }
    }
  }
  
  return urls;
}

function parseHTMLResultsForRSS(html: string): string[] {
  const urls: string[] = [];
  const matches = html.match(/https?:\/\/[^\s<>"]+/g) || [];
  
  for (const url of matches) {
    if (url.includes('rss') || url.includes('feed') || url.includes('.xml')) {
      urls.push(url);
    }
  }
  
  return urls;
}

// ── Web Crawl (aggressive version) ─────────────────────────────────────────────
async function performWebCrawl(interests: UserInterest[]): Promise<{ pagesScraped: number; chunksStored: number }> {
  const queries = generateSearchQueries(interests);
  
  await logger.info("sourceDiscovery", `Crawling ${queries.length} queries from ${interests.length} interests`);

  try {
    // Use aggressive batch search - can do 20-100+ queries in parallel!
    const searchResults = await aggressiveBatchSearch(queries);
    
    let pagesScraped = 0;
    let chunksStored = 0;

    // Process search results
    for (const result of searchResults) {
      const urls = extractURLsFromResult(result);
      
      // Scrape top 2 URLs from each search
      for (const url of urls.slice(0, 2)) {
        if (recentlyScrapedUrls.has(url)) continue;
        
        try {
          const content = await fetchPageContent(url);
          if (!content || content.length < 200) continue;

          const chunks = chunkText(content);
          
          for (const chunk of chunks) {
            await addKnowledgeChunk({
              id: nanoid(),
              content: chunk,
              source: url,
              timestamp: new Date(),
              metadata: { discoveredFrom: "web-crawl" },
            });
            chunksStored++;
          }

          pagesScraped++;
          recentlyScrapedUrls.add(url);
          
          // Limit recent URLs cache
          if (recentlyScrapedUrls.size > MAX_RECENT_URLS) {
            const firstUrl = recentlyScrapedUrls.values().next().value;
            recentlyScrapedUrls.delete(firstUrl);
          }

        } catch (err) {
          await logger.warn("sourceDiscovery", `Failed to scrape ${url}: ${err}`);
        }
      }
    }

    return { pagesScraped, chunksStored };
  } catch (err) {
    await logger.error("sourceDiscovery", `Web crawl failed: ${err}`);
    return { pagesScraped: 0, chunksStored: 0 };
  }
}

function extractURLsFromResult(result: any): string[] {
  if (result.node?.includes('api')) {
    // API format
    const data = result.results;
    if (Array.isArray(data)) {
      return data.map((item: any) => item.url || item.link).filter(Boolean);
    }
    return [];
  } else {
    // HTML format
    const html = result.results;
    const urls: string[] = [];
    const matches = html.match(/href="(https?:\/\/[^"]+)"/g) || [];
    
    for (const match of matches) {
      const url = match.match(/href="([^"]+)"/)?.[1];
      if (url && url.startsWith('http')) {
        urls.push(url);
      }
    }
    
    return urls;
  }
}

// ── Main Discovery Cycle ───────────────────────────────────────────────────────
async function runDiscoveryCycle(): Promise<void> {
  if (_crawling) {
    await logger.info("sourceDiscovery", "Skipping cycle (already running)");
    return;
  }

  _crawling = true;

  try {
    const interests = await analyzeUserInterests();
    
    // Phase 1: Web crawl (get content NOW)
    await logger.info("sourceDiscovery", "Starting web crawl cycle");
    const { pagesScraped, chunksStored } = await performWebCrawl(interests);
    await logger.info("sourceDiscovery", `Web crawl complete: ${pagesScraped} pages scraped, ${chunksStored} chunks stored`);

    // Phase 2: Discover new RSS sources (runs less frequently)
    if (Math.random() < 0.2) { // 20% chance each cycle
      const newSources = await discoverRSSSources(interests);
      await logger.info("sourceDiscovery", `Discovery complete: ${newSources} new RSS sources, ${chunksStored} chunks from web crawl`);
      
      // Log stats
      const stats = getScraperStats();
      const cost = getTotalScrapingCost();
      await logger.info("sourceDiscovery", `Scraper stats: ${JSON.stringify(stats)}`);
      await logger.info("sourceDiscovery", `Total cost today: $${cost.toFixed(4)}`);
    }

  } catch (err) {
    await logger.error("sourceDiscovery", `Discovery cycle failed: ${err}`);
  } finally {
    _crawling = false;
  }
}

// ── Scheduler ──────────────────────────────────────────────────────────────────
let _schedulerInterval: NodeJS.Timeout | null = null;

export function startSourceDiscoveryScheduler(intervalMs: number = 30 * 60 * 1000): void {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
  }

  const intervalMinutes = Math.round(intervalMs / 60000);
  logger.info("sourceDiscovery", `Web crawl scheduler started (every ${intervalMinutes}m)`);

  // Run immediately on startup
  setTimeout(() => runDiscoveryCycle(), 5000);

  // Then schedule regular runs
  _schedulerInterval = setInterval(() => {
    runDiscoveryCycle();
  }, intervalMs);
}

export function stopSourceDiscoveryScheduler(): void {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
    logger.info("sourceDiscovery", "Web crawl scheduler stopped");
  }
}