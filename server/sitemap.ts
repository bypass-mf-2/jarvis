/**
 * Sitemap discovery and parsing.
 *
 * For any scraped source, we probe /robots.txt and /sitemap.xml (the two
 * standard places a site advertises its sitemap). If a sitemap is found,
 * we parse it and return every URL. The caller enqueues them into
 * crawl_frontier so the existing crawler works through them over time.
 *
 * This is the biggest multiplier in the scraper pipeline: one "source"
 * like docs.python.org turns into thousands of pages instead of one.
 */

import { logger } from "./logger.js";
import { fetchWithRetry } from "./webSearch.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_URLS_PER_SITEMAP = 5_000; // safety cap — some sitemaps are huge
const MAX_NESTED_SITEMAPS = 20;     // sitemap indexes can nest; cap fan-out

/**
 * Discover and fetch a sitemap for the given URL's origin.
 * Returns an array of URLs found in the sitemap (or nested sitemaps).
 * Returns an empty array if no sitemap is found or parsing fails.
 */
export async function discoverSitemapUrls(pageUrl: string): Promise<string[]> {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }

  // Step 1: check robots.txt for Sitemap: directives
  const sitemapUrls = await sitemapUrlsFromRobotsTxt(origin);

  // Step 2: fall back to the standard /sitemap.xml location
  if (sitemapUrls.length === 0) {
    sitemapUrls.push(`${origin}/sitemap.xml`);
  }

  // Step 3: fetch and parse each sitemap. Sitemap index files (list of
  // sitemaps) get recursively expanded up to MAX_NESTED_SITEMAPS.
  const allUrls = new Set<string>();
  const toProcess = [...sitemapUrls];
  let nestedCount = 0;

  while (toProcess.length > 0 && nestedCount < MAX_NESTED_SITEMAPS) {
    const url = toProcess.shift()!;
    nestedCount++;

    const parsed = await fetchAndParseSitemap(url);
    if (!parsed) continue;

    for (const entry of parsed.urls) {
      allUrls.add(entry);
      if (allUrls.size >= MAX_URLS_PER_SITEMAP) break;
    }
    if (allUrls.size >= MAX_URLS_PER_SITEMAP) break;

    for (const nested of parsed.nestedSitemaps) {
      if (nestedCount + toProcess.length < MAX_NESTED_SITEMAPS) {
        toProcess.push(nested);
      }
    }
  }

  return Array.from(allUrls);
}

async function sitemapUrlsFromRobotsTxt(origin: string): Promise<string[]> {
  try {
    const res = await fetchWithRetry(`${origin}/robots.txt`, {
      headers: { "User-Agent": "JarvisAI/1.0 SitemapDiscover" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const text = await res.text();
    const sitemaps: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*Sitemap:\s*(\S+)/i);
      if (m) sitemaps.push(m[1]);
    }
    return sitemaps;
  } catch {
    return [];
  }
}

async function fetchAndParseSitemap(
  url: string
): Promise<{ urls: string[]; nestedSitemaps: string[] } | null> {
  try {
    const res = await fetchWithRetry(url, {
      headers: { "User-Agent": "JarvisAI/1.0 SitemapParser" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    let text = await res.text();

    // Some sitemaps are gzipped and served as .xml.gz; others are served
    // as raw XML from a .gz URL. fetchWithRetry doesn't auto-decompress
    // binary responses, so if we don't see XML markers we give up — rarely
    // worth the native dep to handle gzip here.
    if (!text.includes("<urlset") && !text.includes("<sitemapindex")) {
      return null;
    }

    // Sitemap index: list of other sitemaps
    if (text.includes("<sitemapindex")) {
      const nested: string[] = [];
      const locs = text.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/sitemap>/gi);
      for (const m of locs) {
        nested.push(m[1].trim());
      }
      return { urls: [], nestedSitemaps: nested };
    }

    // Standard sitemap: list of URLs
    const urls: string[] = [];
    const locs = text.matchAll(/<url>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/url>/gi);
    for (const m of locs) {
      urls.push(m[1].trim());
      if (urls.length >= MAX_URLS_PER_SITEMAP) break;
    }

    return { urls, nestedSitemaps: [] };
  } catch (err) {
    await logger.warn("sitemap", `Failed to fetch/parse ${url}: ${String(err)}`);
    return null;
  }
}

/**
 * Given a list of URLs, filter out ones that are obviously not worth crawling:
 * binaries, login pages, images, etc. Caller should additionally apply their
 * own domain-level blocklist.
 */
export function filterCrawlableUrls(urls: string[]): string[] {
  const out: string[] = [];
  for (const url of urls) {
    if (!url || !url.startsWith("http")) continue;
    const lower = url.toLowerCase();
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png")) continue;
    if (lower.endsWith(".gif") || lower.endsWith(".webp") || lower.endsWith(".svg")) continue;
    if (lower.endsWith(".zip") || lower.endsWith(".tar.gz") || lower.endsWith(".exe")) continue;
    if (lower.endsWith(".mp4") || lower.endsWith(".mp3") || lower.endsWith(".webm")) continue;
    if (lower.includes("/login") || lower.includes("/signup") || lower.includes("/signin")) continue;
    if (lower.includes("/logout") || lower.includes("/auth/")) continue;
    out.push(url);
  }
  return out;
}
