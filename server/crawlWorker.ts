/**
 * Crawl Worker — runs in a separate thread so scraping never blocks the server.
 *
 * Handles: HTTP fetching, text extraction, chunking, link harvesting.
 * Sends results back to the main thread via parentPort messages.
 * The main thread handles all DB writes.
 */

import { parentPort, workerData } from "worker_threads";
import { aggressiveSearch, aggressiveBatchSearch } from "./aggressiveScraper.js";
import { fetchPageContentAndLinks } from "./webSearch.js";
import { chunkText } from "./chunking.js";

if (!parentPort) {
  throw new Error("crawlWorker must be run as a worker thread");
}

const port = parentPort;

// ── Helpers ────────────────────────────────────────────────────────────────────
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

const BLOCKED_DOMAINS = new Set([
  "google.com", "www.google.com", "google.co.uk",
  "facebook.com", "www.facebook.com",
  "twitter.com", "x.com",
  "instagram.com", "www.instagram.com",
  "youtube.com", "www.youtube.com",
  "linkedin.com", "www.linkedin.com",
  "reddit.com", "www.reddit.com",
  "pinterest.com", "tiktok.com",
  "amazon.com", "www.amazon.com",
  "ebay.com", "apple.com",
  "play.google.com", "accounts.google.com", "maps.google.com",
]);

function isUrlAllowed(url: string): boolean {
  const domain = extractDomain(url);
  if (BLOCKED_DOMAINS.has(domain)) return false;
  if (url.includes("/login") || url.includes("/signup") || url.includes("/auth")) return false;
  if (url.endsWith(".pdf") || url.endsWith(".zip") || url.endsWith(".exe")) return false;
  if (url.endsWith(".jpg") || url.endsWith(".png") || url.endsWith(".gif")) return false;
  return true;
}

// chunkText imported from ./chunking — shared across scraper, crawlWorker,
// and fileIngestion. Sentence-based with overlap and a minimum length filter.

// ── Link extraction ────────────────────────────────────────────────────────────
function extractLinksFromHTML(html: string): string[] {
  const urls: string[] = [];
  const matches = html.match(/href="(https?:\/\/[^"]+)"/g) || [];
  for (const match of matches) {
    const url = match.match(/href="([^"]+)"/)?.[1];
    if (url && url.startsWith("http") && isUrlAllowed(url)) {
      urls.push(url);
    }
  }
  return [...new Set(urls)];
}

function extractURLsFromResult(result: any): string[] {
  if (result.node === "serpapi") {
    const data = result.results;
    if (data?.organic_results) {
      return data.organic_results.map((item: any) => item.link).filter(Boolean).filter(isUrlAllowed);
    }
    if (Array.isArray(data)) {
      return data.map((item: any) => item.url || item.link).filter(Boolean).filter(isUrlAllowed);
    }
    return [];
  } else {
    const html = result.results;
    if (typeof html !== "string") return [];
    return extractLinksFromHTML(html);
  }
}

// ── Topic / query pools (same as sourceDiscovery.ts) ───────────────────────────
const ALL_TOPICS = [
  "python programming", "python advanced techniques", "python asyncio",
  "python data structures", "python metaprogramming", "python decorators",
  "python web scraping", "python automation scripts", "python ctypes",
  "python type hints mypy", "python packaging setuptools", "python performance optimization",
  "javascript frameworks", "typescript advanced types", "rust programming",
  "golang concurrency", "c++ memory management", "c programming tricks",
  "bash scripting", "powershell scripting", "lua scripting",
  "functional programming", "object oriented design patterns", "clean code",
  "code refactoring", "debugging techniques", "test driven development",
  "api design", "rest api best practices", "graphql",
  "web development", "frontend frameworks", "backend architecture",
  "microservices", "serverless computing", "devops practices",
  "docker containers", "kubernetes orchestration", "ci cd pipelines",
  "git advanced usage", "vim tricks", "linux command line",
  "react hooks patterns", "nextjs app router", "svelte framework",
  "node.js streams", "deno runtime", "bun javascript runtime",
  "sql query optimization", "postgresql advanced", "redis caching patterns",
  "websockets real time", "grpc microservices", "message queues rabbitmq kafka",
  "ethical hacking", "penetration testing", "bug bounty hunting",
  "web application security", "owasp top 10", "sql injection techniques",
  "cross site scripting xss", "buffer overflow exploitation",
  "reverse engineering", "binary exploitation", "malware analysis",
  "network security", "wireless hacking", "wifi security",
  "privilege escalation linux", "privilege escalation windows",
  "capture the flag ctf", "ctf writeups", "hackthebox walkthroughs",
  "social engineering attacks", "phishing techniques",
  "cryptography attacks", "password cracking", "hash cracking",
  "red team techniques", "blue team defense", "threat hunting",
  "osint techniques", "reconnaissance tools", "nmap scanning",
  "metasploit framework", "burp suite", "wireshark analysis",
  "exploit development", "shellcode writing", "rop chains",
  "active directory attacks", "kerberos attacks", "windows internals security",
  "linux kernel exploitation", "container security", "cloud security",
  "mobile app security", "android hacking", "ios security research",
  "api security testing", "jwt token attacks", "ssrf exploitation",
  "command injection", "deserialization attacks", "race condition exploits",
  "fuzzing techniques", "afl fuzzer", "binary diffing",
  "data structures and algorithms", "algorithm complexity analysis",
  "graph algorithms", "dynamic programming", "sorting algorithms",
  "compiler design", "operating systems internals", "virtual memory",
  "cpu architecture", "instruction set design", "cache optimization",
  "distributed systems", "consensus algorithms", "database internals",
  "b tree index", "query optimization", "transaction isolation levels",
  "networking tcp ip", "network protocols", "dns internals",
  "type theory", "lambda calculus", "automata theory",
  "machine learning algorithms", "neural network architectures",
  "deep learning", "reinforcement learning", "natural language processing",
  "computer graphics", "ray tracing", "shader programming",
  "cryptography fundamentals", "elliptic curve cryptography",
  "information theory", "signal processing", "compression algorithms",
  "parallel computing", "gpu programming cuda", "fpga programming",
  "embedded systems", "real time operating systems", "iot security",
  "llm fine tuning", "transformer architecture", "attention mechanism",
  "vector databases", "rag retrieval augmented generation",
  "quantum computing", "brain computer interface", "robotics",
  "autonomous vehicles", "augmented reality", "nanotechnology",
  "cybersecurity trends", "blockchain internals", "game theory",
  "chaos theory", "astrophysics", "dark matter",
  "fusion energy", "biotechnology", "synthetic biology",
  "materials science", "neuromorphic chips", "swarm intelligence",
];

const MODIFIERS = [
  "tutorial", "cheat sheet", "explained", "deep dive",
  "how it works", "from scratch", "advanced guide",
  "best practices", "common mistakes", "tips and tricks",
  "real world examples", "hands on", "step by step",
  "internals", "under the hood", "source code walkthrough",
  "latest tools", "new techniques", "open source",
  "beginner to advanced", "interview questions", "challenges",
  "writeup", "walkthrough", "proof of concept",
];

const NOUNS = [
  "algorithms", "exploits", "payloads", "shellcode", "binaries",
  "vulnerabilities", "zero days", "backdoors", "rootkits", "botnets",
  "protocols", "packets", "sockets", "threads", "processes",
  "compilers", "interpreters", "parsers", "lexers", "bytecode",
  "frameworks", "libraries", "modules", "packages", "dependencies",
  "containers", "clusters", "nodes", "endpoints", "proxies",
  "ciphers", "hashes", "keys", "certificates", "tokens",
  "registers", "opcodes", "syscalls", "interrupts", "drivers",
];

const ADJECTIVES = [
  "advanced", "low level", "zero day", "obfuscated", "polymorphic",
  "multithreaded", "distributed", "encrypted", "stealthy", "novel",
  "experimental", "optimized", "minimal", "custom", "weaponized",
  "open source", "cross platform", "memory safe", "lock free", "recursive",
];

// ── Generate queries, excluding recently used topics ───────────────────────────
function generateQueries(count: number, recentlyUsedTopics: string[]): { queries: string[]; topicsUsed: string[] } {
  const recentSet = new Set(recentlyUsedTopics);
  let available = ALL_TOPICS.filter((t) => !recentSet.has(t));
  if (available.length < count) available = [...ALL_TOPICS];

  const topics = pickN(available, count);
  const queries: string[] = [];

  for (const topic of topics) {
    const strategy = Math.random();
    if (strategy < 0.4) {
      queries.push(`${topic} ${pick(MODIFIERS)}`);
    } else if (strategy < 0.6) {
      queries.push(`${pick(ADJECTIVES)} ${pick(NOUNS)} ${topic}`);
    } else if (strategy < 0.75) {
      queries.push(`${topic} and ${pick(ALL_TOPICS)}`);
    } else if (strategy < 0.85) {
      queries.push(`${topic} site:github.com OR site:medium.com OR site:dev.to`);
    } else {
      queries.push(`${topic} ${new Date().getFullYear()}`);
    }
  }

  return { queries, topicsUsed: topics };
}

// ── Scrape a URL, return chunks + discovered links ─────────────────────────────
async function scrapeUrl(url: string): Promise<{
  url: string;
  domain: string;
  chunks: string[];
  discoveredLinks: Array<{ url: string; domain: string }>;
} | null> {
  try {
    // Use the richer fetcher so links are extracted from raw HTML in the
    // same network call. The previous extractLinksFromHTML(content) call
    // was being passed already-stripped text and silently returned 0 every
    // time, starving the crawl frontier.
    const { text, links } = await fetchPageContentAndLinks(url);
    if (!text || text.length < 200) return null;

    const chunks = chunkText(text);
    const allowedLinks = links.filter(isUrlAllowed);
    const discoveredLinks = pickN(allowedLinks, 10).map((link) => ({
      url: link,
      domain: extractDomain(link),
    }));

    return {
      url,
      domain: extractDomain(url),
      chunks,
      discoveredLinks,
    };
  } catch {
    return null;
  }
}

// ── Handle messages from main thread ───────────────────────────────────────────
port.on("message", async (msg: any) => {
  if (msg.type === "search-and-scrape") {
    await handleSearchAndScrape(msg.recentlyUsedTopics || []);
  } else if (msg.type === "crawl-frontier") {
    await handleCrawlFrontier(msg.urls || []);
  } else if (msg.type === "seed-from-domains") {
    await handleSeedFromDomains(msg.domains || []);
  } else if (msg.type === "discover-rss") {
    await handleDiscoverRSS(msg.recentlyUsedTopics || []);
  }
});

// ── Phase 1: Search + scrape ───────────────────────────────────────────────────
async function handleSearchAndScrape(recentlyUsedTopics: string[]) {
  try {
    const { queries, topicsUsed } = generateQueries(40, recentlyUsedTopics);

    // Tell main thread which topics we used
    port.postMessage({ type: "topics-used", topics: topicsUsed });

    port.postMessage({ type: "log", level: "info", message: `Search phase: ${queries.length} random queries` });

    const searchResults = await aggressiveBatchSearch(queries);

    let pagesScraped = 0;
    let chunksStored = 0;
    const domainsThisCycle = new Map<string, number>();

    // Collect all URLs to scrape from search results, then scrape concurrently.
    // Previously this was a double-nested serial loop — each search result
    // processed 3 URLs sequentially. Now we batch them all and scrape 8 at once.
    const urlsToScrape: Array<{ url: string; domain: string }> = [];
    for (const result of searchResults) {
      const urls = extractURLsFromResult(result);
      const selected = pickN(urls, 3);
      for (const url of selected) {
        const domain = extractDomain(url);
        const domainCount = domainsThisCycle.get(domain) || 0;
        if (domainCount >= 2) continue;
        domainsThisCycle.set(domain, domainCount + 1);

        urlsToScrape.push({ url, domain });
        port.postMessage({
          type: "frontier-add",
          url,
          domain,
          depth: 0,
          priority: 0.7 + Math.random() * 0.3,
          discoveredFrom: "search",
        });
      }
    }

    await mapConcurrent(urlsToScrape, CRAWL_CONCURRENCY, async ({ url, domain }) => {
      const scraped = await scrapeUrl(url);
      if (scraped && scraped.chunks.length > 0) {
        port.postMessage({
          type: "scraped-page",
          url: scraped.url,
          domain: scraped.domain,
          chunks: scraped.chunks,
          sourceTitle: "Search Discovery",
          discoveredLinks: scraped.discoveredLinks,
        });
        pagesScraped++;
        chunksStored += scraped.chunks.length;
      } else {
        port.postMessage({ type: "frontier-failed", url });
      }
    });

    port.postMessage({
      type: "search-complete",
      pagesScraped,
      chunksStored,
    });
  } catch (err) {
    port.postMessage({ type: "log", level: "error", message: `Search phase failed: ${err}` });
    port.postMessage({ type: "search-complete", pagesScraped: 0, chunksStored: 0 });
  }
}

// ── Concurrency helper ────────────────────────────────────────────────────
// Process an array of items with bounded concurrency. No external dep needed.
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// ── Phase 2: Crawl frontier URLs (parallelized) ──────────────────────────────
const CRAWL_CONCURRENCY = 8;

async function handleCrawlFrontier(urls: Array<{ url: string }>) {
  let pagesScraped = 0;
  let chunksStored = 0;

  if (urls.length > 0) {
    port.postMessage({
      type: "log",
      level: "info",
      message: `Frontier phase: crawling ${urls.length} URLs (concurrency=${CRAWL_CONCURRENCY})`,
    });
  }

  await mapConcurrent(urls, CRAWL_CONCURRENCY, async (entry) => {
    const scraped = await scrapeUrl(entry.url);
    if (scraped && scraped.chunks.length > 0) {
      port.postMessage({
        type: "scraped-page",
        url: scraped.url,
        domain: scraped.domain,
        chunks: scraped.chunks,
        sourceTitle: "Frontier Crawl",
        discoveredLinks: scraped.discoveredLinks,
      });
      pagesScraped++;
      chunksStored += scraped.chunks.length;
    } else {
      port.postMessage({ type: "frontier-failed", url: entry.url });
    }
  });

  port.postMessage({
    type: "frontier-complete",
    pagesScraped,
    chunksStored,
  });
}

// ── Seed frontier from top domains ─────────────────────────────────────────────
async function handleSeedFromDomains(domains: Array<{ domain: string; quality_score: number }>) {
  if (domains.length === 0) return;

  for (const d of domains) {
    const query = `site:${d.domain} ${pick(ALL_TOPICS)} ${pick(MODIFIERS)}`;
    try {
      const results = await aggressiveBatchSearch([query]);
      for (const result of results) {
        const urls = extractURLsFromResult(result);
        for (const url of urls.slice(0, 5)) {
          port.postMessage({
            type: "frontier-add",
            url,
            domain: d.domain,
            depth: 0,
            priority: d.quality_score ?? 0.5,
            discoveredFrom: "domain-reseed",
          });
        }
      }
    } catch {
      // ignore
    }
  }

  port.postMessage({ type: "seed-complete" });
}

// ── Discover RSS feeds ─────────────────────────────────────────────────────────
async function handleDiscoverRSS(recentlyUsedTopics: string[]) {
  const { topicsUsed } = generateQueries(5, recentlyUsedTopics);
  const queries = topicsUsed.map((t) => `${t} RSS feed`);

  port.postMessage({ type: "topics-used", topics: topicsUsed });
  port.postMessage({ type: "log", level: "info", message: `RSS discovery: ${topicsUsed.join(", ")}` });

  try {
    const searchResults = await aggressiveBatchSearch(queries);

    for (const result of searchResults) {
      const data = result.results;
      let rssUrls: string[] = [];

      if (typeof data === "string") {
        const matches = data.match(/https?:\/\/[^\s<>"]+/g) || [];
        rssUrls = matches.filter((u: string) => u.includes("rss") || u.includes("feed") || u.includes(".xml"));
      } else {
        const items = data?.organic_results || (Array.isArray(data) ? data : []);
        for (const item of items) {
          const url = item.url || item.link || "";
          if (url.includes("rss") || url.includes("feed") || url.includes(".xml")) {
            rssUrls.push(url);
          }
        }
      }

      for (const url of rssUrls.slice(0, 3)) {
        port.postMessage({ type: "rss-discovered", url });
      }
    }
  } catch (err) {
    port.postMessage({ type: "log", level: "error", message: `RSS discovery failed: ${err}` });
  }

  port.postMessage({ type: "rss-complete" });
}

port.postMessage({ type: "ready" });
