/**
 * Real-Time Web Search
 * 
 * Integrates multiple search providers:
 * - DuckDuckGo (free, no API key)
 * - Brave Search (best quality, needs API key)
 * - Google Custom Search (needs API key)
 * 
 * Used for finding current information beyond training data
 */

import { logger } from "./logger.js";

// ── DuckDuckGo Search (Free, No API Key) ───────────────────────────────────
export async function searchDuckDuckGo(
  query: string,
  maxResults = 10
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  await logger.info("webSearch", `Searching DuckDuckGo: ${query}`);

  try {
    // Use DuckDuckGo HTML search and parse results
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        },
        signal: AbortSignal.timeout(10_000),
      }
    );

    const html = await response.text();
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    // Parse result blocks: <a class="result__a" href="...">Title</a>
    const resultBlocks = html.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi) || [];

    for (const block of resultBlocks.slice(0, maxResults)) {
      // Extract href
      const hrefMatch = block.match(/href="([^"]*)"/);
      // Extract title text (strip tags)
      const titleText = block.replace(/<[^>]+>/g, "").trim();

      if (!hrefMatch?.[1] || !titleText) continue;

      let url = hrefMatch[1];
      // DuckDuckGo wraps URLs in a redirect — extract the actual URL
      const uddgMatch = url.match(/uddg=([^&]*)/);
      if (uddgMatch) {
        url = decodeURIComponent(uddgMatch[1]);
      }

      // Skip non-http URLs
      if (!url.startsWith("http")) continue;

      results.push({
        title: titleText,
        url,
        snippet: titleText, // DuckDuckGo HTML doesn't easily give snippets
      });
    }

    // Also try to extract snippets from result__snippet divs
    const snippetBlocks = html.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi) || [];
    for (let i = 0; i < Math.min(snippetBlocks.length, results.length); i++) {
      const text = snippetBlocks[i].replace(/<[^>]+>/g, "").trim();
      if (text) results[i].snippet = text;
    }

    return results;

  } catch (err) {
    await logger.error("webSearch", `DuckDuckGo search failed: ${err}`);
    return [];
  }
}

// ── Brave Search API ───────────────────────────────────────────────────────
export async function searchBrave(
  query: string,
  maxResults = 5
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error("BRAVE_SEARCH_API_KEY not set");
  }

  await logger.info("webSearch", `Searching Brave: ${query}`);

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
      {
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": apiKey,
        },
      }
    );

    const data = await response.json();
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    if (data.web && data.web.results) {
      for (const result of data.web.results) {
        results.push({
          title: result.title,
          url: result.url,
          snippet: result.description,
        });
      }
    }

    return results;

  } catch (err) {
    await logger.error("webSearch", `Brave search failed: ${err}`);
    return [];
  }
}

// ── Google Custom Search ───────────────────────────────────────────────────
export async function searchGoogle(
  query: string,
  maxResults = 5
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    throw new Error("Google Search API credentials not set");
  }

  await logger.info("webSearch", `Searching Google: ${query}`);

  try {
    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&num=${maxResults}`
    );

    const data = await response.json();
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    if (data.items) {
      for (const item of data.items) {
        results.push({
          title: item.title,
          url: item.link,
          snippet: item.snippet,
        });
      }
    }

    return results;

  } catch (err) {
    await logger.error("webSearch", `Google search failed: ${err}`);
    return [];
  }
}

// ── Smart Provider Selection ───────────────────────────────────────────────
export async function searchWeb(
  query: string,
  maxResults = 5
): Promise<Array<{ title: string; url: string; snippet: string; provider: string }>> {
  await logger.info("webSearch", `Web search: ${query}`);

  let results: any[] = [];
  let provider = "none";

  // Try Brave first (best quality if available)
  if (process.env.BRAVE_SEARCH_API_KEY) {
    try {
      results = await searchBrave(query, maxResults);
      provider = "brave";
      if (results.length > 0) {
        return results.map(r => ({ ...r, provider }));
      }
    } catch {
      // Fall through to next provider
    }
  }

  // Try Google if available
  if (process.env.GOOGLE_SEARCH_API_KEY) {
    try {
      results = await searchGoogle(query, maxResults);
      provider = "google";
      if (results.length > 0) {
        return results.map(r => ({ ...r, provider }));
      }
    } catch {
      // Fall through to next provider
    }
  }

  // Fall back to DuckDuckGo (always available, free)
  results = await searchDuckDuckGo(query, maxResults);
  provider = "duckduckgo";

  return results.map(r => ({ ...r, provider }));
}

// ── Fetch and Extract Page Content ─────────────────────────────────────────
export async function fetchPageContent(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JarvisBot/1.0)",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Simple HTML to text conversion
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return text.slice(0, 5000); // First 5000 chars

  } catch (err) {
    await logger.error("webSearch", `Failed to fetch ${url}: ${err}`);
    return "";
  }
}

// ── Search and Summarize ───────────────────────────────────────────────────
export async function searchAndSummarize(
  query: string,
  maxResults = 3
): Promise<{ summary: string; sources: Array<{ title: string; url: string }> }> {
  const results = await searchWeb(query, maxResults);

  if (results.length === 0) {
    return {
      summary: "No search results found.",
      sources: [],
    };
  }

  // Compile search results into a summary
  let summary = `Search results for: ${query}\n\n`;

  const sources: Array<{ title: string; url: string }> = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    summary += `${i + 1}. ${result.title}\n${result.snippet}\n\n`;
    sources.push({ title: result.title, url: result.url });
  }

  return { summary, sources };
}
