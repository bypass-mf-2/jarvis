/**
 * Web Search via SerpAPI and ScrapingAnt
 */

import { logger } from "./logger.js";
import { aggressiveSearch, aggressiveBatchSearch } from "./aggressiveScraper.js";

// ── fetch with retry/backoff ─────────────────────────────────────────────
// Used by scraper.ts and fetchPageContent below. Retries on transient
// network errors and 5xx, but NOT on 4xx (those are real "don't try again"
// responses). Backoff: 500ms, 1s, 2s.
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  attempts = 3
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      // 4xx is final — don't waste retries on a permanent client error.
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ── Main Search Function ─────────────────────────────────────────────────
export async function searchWeb(
  query: string,
  limit?: number
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  await logger.info("webSearch", `Web search: ${query}`);

  try {
    const result = await aggressiveSearch(query);
    const parsed = parseResults(result.results, result.node);
    return typeof limit === "number" ? parsed.slice(0, limit) : parsed;
  } catch (err) {
    await logger.error("webSearch", `Search failed: ${err}`);
    return [];
  }
}

// ── Batch Search (parallel, fast) ──────────────────────────────────────────
export async function batchSearchWeb(
  queries: string[]
): Promise<Array<Array<{ title: string; url: string; snippet: string }>>> {
  await logger.info("webSearch", `Batch searching ${queries.length} queries`);

  try {
    const results = await aggressiveBatchSearch(queries);
    return results.map(result => parseResults(result.results, result.node));
  } catch (err) {
    await logger.error("webSearch", `Batch search failed: ${err}`);
    return [];
  }
}

// ── Parse Results ──────────────────────────────────────────────────────────
function parseResults(
  data: any,
  nodeId: string
): Array<{ title: string; url: string; snippet: string }> {

  // SerpAPI format (JSON)
  if (nodeId === 'serpapi') {
    const organicResults = data.organic_results || [];
    return organicResults.map((r: any) => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
    }));
  }

  // ScrapingAnt format (HTML from Google)
  if (nodeId === 'scrapingant') {
    return parseHTMLResults(data);
  }

  return [];
}

// ── Parse HTML Results (ScrapingAnt returns Google HTML) ──────────────────
function parseHTMLResults(
  html: string
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  const googleBlocks = html.match(/<div class="g"[\s\S]*?<\/div>/gi) || [];

  for (const block of googleBlocks.slice(0, 10)) {
    const urlMatch = block.match(/<a href="([^"]*)"/);
    const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const snippetMatch = block.match(/<div[^>]*class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/);

    if (!urlMatch || !titleMatch) continue;

    const url = urlMatch[1];
    const title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").trim() : title;

    if (!url.startsWith("http")) continue;

    results.push({ title, url, snippet });
  }

  return results;
}

// Strip HTML to plain text, preserving anchor href targets as inline
// `text (url)` so downstream chunks keep the actual destination URLs.
// Removes script/style/nav/header/footer/aside chrome before flattening.
function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")
    // Preserve anchor URLs: <a href="X">text</a> → text (X)
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract absolute http(s) link targets from raw HTML. Relative paths are
// resolved against the page URL so the crawl frontier sees real URLs.
function extractLinksFromHtml(html: string, pageUrl: string): string[] {
  const urls = new Set<string>();
  const anchorRe = /<a\s+[^>]*href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
    try {
      const abs = new URL(href, pageUrl).toString();
      if (abs.startsWith("http://") || abs.startsWith("https://")) {
        urls.add(abs);
      }
    } catch {
      // skip malformed URLs
    }
  }
  return Array.from(urls);
}

// ── Fetch Page Content ───────────────────────────────────────────────────
export async function fetchPageContent(url: string): Promise<string> {
  await logger.info("webSearch", `Fetching page: ${url.slice(0, 50)}...`);

  try {
    const response = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    return htmlToText(html);
  } catch (err) {
    await logger.warn("webSearch", `Failed to fetch ${url}: ${err}`);
    return "";
  }
}

// Like fetchPageContent but also extracts outgoing links from the raw HTML
// in the same fetch. Used by the crawler to grow its frontier — the previous
// design tried to extract links from already-stripped text, which silently
// returned 0 every time.
export async function fetchPageContentAndLinks(
  url: string
): Promise<{ text: string; links: string[] }> {
  await logger.info("webSearch", `Fetching page (with links): ${url.slice(0, 50)}...`);

  try {
    const response = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    return {
      text: htmlToText(html),
      links: extractLinksFromHtml(html, url),
    };
  } catch (err) {
    await logger.warn("webSearch", `Failed to fetch ${url}: ${err}`);
    return { text: "", links: [] };
  }
}

// ── Search and Summarize ─────────────────────────────────────────────────
export async function searchAndSummarize(
  query: string
): Promise<{ query: string; results: Array<{ title: string; url: string; snippet: string }>; summary: string }> {
  const results = await searchWeb(query);
  const summary = results
    .slice(0, 5)
    .map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`)
    .join("\n");
  return { query, results, summary: summary || "No results found." };
}
