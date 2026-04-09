/**
 * Web Search via SerpAPI and ScrapingAnt
 */

import { logger } from "./logger.js";
import { aggressiveSearch, aggressiveBatchSearch } from "./aggressiveScraper.js";

// ── Main Search Function ─────────────────────────────────────────────────
export async function searchWeb(
  query: string
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  await logger.info("webSearch", `Web search: ${query}`);

  try {
    const result = await aggressiveSearch(query);
    return parseResults(result.results, result.node);
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

// ── Fetch Page Content ───────────────────────────────────────────────────
export async function fetchPageContent(url: string): Promise<string> {
  await logger.info("webSearch", `Fetching page: ${url.slice(0, 50)}...`);

  try {
    const response = await fetch(url, {
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

    let clean = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return clean;
  } catch (err) {
    await logger.warn("webSearch", `Failed to fetch ${url}: ${err}`);
    return "";
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
