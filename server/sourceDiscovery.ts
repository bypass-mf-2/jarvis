/**
 * Smart Random Web Crawler — Worker Thread Architecture
 *
 * All HTTP scraping runs in a worker thread so the server stays responsive.
 * This file (main thread) handles:
 *   - Spawning/managing the worker
 *   - All database writes (frontier, chunks, domain scores)
 *   - Scheduling crawl cycles
 *
 * The worker (crawlWorker.ts) handles:
 *   - Search API calls (SerpAPI, ScrapingAnt)
 *   - HTTP page fetching
 *   - Text extraction and chunking
 *   - Link harvesting
 */

import { Worker } from "worker_threads";
import path from "path";
import { fileURLToPath } from "url";
import {
  addScrapeSource,
  getScrapeSources,
  addKnowledgeChunk,
  addToFrontier,
  getNextFrontierUrls,
  markFrontierScraped,
  markFrontierFailed,
  isFrontierUrl,
  getFrontierStats,
  recordTopicUsed,
  getRecentlyUsedTopics,
  upsertDomainScore,
  getDomainScore,
  getTopDomains,
  recomputeDomainQualityScores,
  pruneFrontier,
} from "./db";
import { getScraperStats, getTotalScrapingCost } from "./aggressiveScraper.js";
import { isScraperEnabled } from "./scraper.js";
import { logger } from "./logger";
import { nanoid } from "nanoid";
import { recordEvent as recordImprovementEvent } from "./improvementFeed.js";

// ── Worker management ──────────────────────────────────────────────────────────
let _worker: Worker | null = null;
let _crawling = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getWorker(): Worker {
  if (_worker) return _worker;

  // Use the .mjs bootstrap that registers tsx loader then imports the .ts worker
  _worker = new Worker(path.join(__dirname, "crawlWorkerBoot.mjs"));

  _worker.on("error", (err) => {
    logger.error("sourceDiscovery", `Worker error: ${err.message}`);
    _worker = null;
  });

  _worker.on("exit", (code) => {
    if (code !== 0) {
      logger.warn("sourceDiscovery", `Worker exited with code ${code}`);
    }
    _worker = null;
    _crawling = false;
  });

  return _worker;
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// ── Process messages from worker (DB writes happen here on main thread) ────────
function handleWorkerMessage(msg: any): Promise<void> {
  return (async () => {
    switch (msg.type) {
      case "scraped-page": {
        if (!msg.url || !isValidUrl(msg.url)) break;
        // Store all chunks
        for (const chunk of msg.chunks) {
          await addKnowledgeChunk({
            content: chunk,
            sourceUrl: msg.url,
            sourceTitle: msg.sourceTitle,
            sourceType: "custom_url",
            chromaId: nanoid(),
            embeddingModel: "nomic-embed-text",
            scrapedAt: new Date(),
          });
        }

        // Update domain score
        await upsertDomainScore(msg.domain, 1, msg.chunks.length);
        await markFrontierScraped(msg.url);

        // Add discovered links to frontier
        if (msg.discoveredLinks) {
          const domainQuality = await getDomainScore(msg.domain);
          for (const link of msg.discoveredLinks) {
            if (!link.url || !isValidUrl(link.url)) continue;
            const alreadyQueued = await isFrontierUrl(link.url);
            if (!alreadyQueued) {
              const priority = 0.3 + domainQuality * 0.4 + Math.random() * 0.3;
              await addToFrontier(link.url, link.domain, 1, priority, msg.url);
            }
          }
        }
        break;
      }

      case "frontier-add": {
        if (!msg.url || !isValidUrl(msg.url)) break;
        const alreadyQueued = await isFrontierUrl(msg.url);
        if (!alreadyQueued) {
          await addToFrontier(msg.url, msg.domain, msg.depth, msg.priority, msg.discoveredFrom);
        }
        break;
      }

      case "frontier-failed": {
        await markFrontierFailed(msg.url);
        break;
      }

      case "topics-used": {
        for (const topic of msg.topics) {
          await recordTopicUsed(topic);
        }
        break;
      }

      case "rss-discovered": {
        try {
          if (!msg.url || !isValidUrl(msg.url)) break;
          const existing = await getScrapeSources();
          if (existing.some((s: any) => s.url === msg.url)) break;

          // Validate the feed is reachable AND actually looks like RSS/Atom
          // before persisting it. Prevents the scrape_sources table from
          // filling up with dead or bot-blocked URLs.
          const probe = await fetch(msg.url, {
            method: "GET",
            headers: { "User-Agent": "JarvisAI/1.0 RSS Reader" },
            signal: AbortSignal.timeout(8000),
          }).catch(() => null);

          if (!probe || !probe.ok) {
            await logger.warn("sourceDiscovery", `Rejected unreachable RSS: ${msg.url}`);
            break;
          }

          const ct = probe.headers.get("content-type") || "";
          const head = (await probe.text()).slice(0, 2000).toLowerCase();
          const looksLikeFeed =
            ct.includes("xml") ||
            ct.includes("rss") ||
            ct.includes("atom") ||
            head.includes("<rss") ||
            head.includes("<feed") ||
            head.includes("<rdf");

          if (!looksLikeFeed) {
            // Not an RSS feed — but the URL might still be a useful HTML
            // page (a Reddit thread, a tutorial, a docs page). Instead of
            // dropping it, push it to the crawl frontier so the random
            // crawler can ingest it once and harvest its outgoing links.
            // This recovers all the "Not an RSS/Atom feed" rejections that
            // used to be wasted work.
            try {
              const alreadyQueued = await isFrontierUrl(msg.url);
              if (!alreadyQueued) {
                let domain = "";
                try { domain = new URL(msg.url).hostname; } catch { /* skip on bad URL */ }
                if (domain) {
                  // Lower priority than search-result discoveries (those
                  // are typically depth=1, priority=10) so the frontier
                  // still drains search hits first.
                  await addToFrontier(msg.url, domain, 1, 5, "rss-discovery-fallback");
                  await logger.info("sourceDiscovery", `Routed non-RSS candidate to frontier: ${msg.url}`);
                }
              }
            } catch (err) {
              await logger.warn("sourceDiscovery", `Failed to route non-RSS candidate to frontier: ${err}`);
            }
            recordImprovementEvent({
              type: "discovery_validation_rejected",
              module: "sourceDiscovery",
              summary: `Routed non-RSS URL to crawl frontier`,
              details: { url: msg.url, contentType: ct, action: "frontier" },
            });
            break;
          }

          await addScrapeSource({
            name: `Auto-discovered: ${msg.url.slice(0, 50)}`,
            url: msg.url,
            type: "rss",
            intervalMinutes: 30,
          });
          await logger.info("sourceDiscovery", `Added new RSS source: ${msg.url}`);
        } catch (err) {
          await logger.warn("sourceDiscovery", `Failed to add RSS source: ${err}`);
        }
        break;
      }

      case "log": {
        if (msg.level === "error") {
          await logger.error("sourceDiscovery", msg.message);
        } else if (msg.level === "warn") {
          await logger.warn("sourceDiscovery", msg.message);
        } else {
          await logger.info("sourceDiscovery", msg.message);
        }
        break;
      }
    }
  })();
}

// ── Run a full crawl cycle via the worker ──────────────────────────────────────
async function runDiscoveryCycle(): Promise<void> {
  // Respect the global scraping toggle — source discovery crawls hundreds of
  // pages per cycle, which saturates the network and CPU and causes Ollama
  // chat requests to time out. Pause entirely when scraping is disabled.
  if (!isScraperEnabled()) {
    await logger.info("sourceDiscovery", "Skipping cycle (scraper disabled)");
    return;
  }
  if (_crawling) {
    await logger.info("sourceDiscovery", "Skipping cycle (already running)");
    return;
  }

  _crawling = true;

  try {
    // Housekeeping: recompute domain quality scores from retrieval data,
    // and prune the frontier if it's gotten too large. Both run before the
    // main cycle so the planner sees accurate scores and queue size.
    try {
      const scored = await recomputeDomainQualityScores();
      const pruned = await pruneFrontier(10_000);
      if (pruned > 0) {
        await logger.info("sourceDiscovery", `Pruned ${pruned} low-priority frontier URLs (cap 10k)`);
      }
      await logger.info("sourceDiscovery", `Quality scores recomputed for ${scored} domains`);
    } catch (err) {
      await logger.warn("sourceDiscovery", `Housekeeping failed: ${String(err)}`);
    }

    const worker = getWorker();
    const recentlyUsedTopics = await getRecentlyUsedTopics(6 * 60 * 60 * 1000);

    // Check frontier size to decide strategy. If the queue is already huge,
    // skip the search phase (which adds ~600 URLs) and spend all the cycle
    // budget on draining what we already have. This prevents unbounded
    // queue growth that was hitting 19k+ pending.
    const fStatsPreCycle = await getFrontierStats();
    const queueIsHuge = fStatsPreCycle.pending > 2000;
    const skipSearch = queueIsHuge;

    if (skipSearch) {
      await logger.info(
        "sourceDiscovery",
        `Frontier has ${fStatsPreCycle.pending} pending — skipping search phase to drain queue`
      );
    }

    // Collect stats from both phases
    let searchStats = { pagesScraped: 0, chunksStored: 0 };
    let frontierStats = { pagesScraped: 0, chunksStored: 0 };

    // Pre-fetch frontier URLs for the skipSearch path (needs to happen
    // outside the non-async promise constructor callback).
    const prefetchedFrontier = skipSearch
      ? await getNextFrontierUrls(150, 5)
      : null;

    // Run search phase, then frontier phase, then optionally RSS
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Crawl cycle timed out after 10 minutes"));
      }, 10 * 60 * 1000);

      // When queue is large, jump straight to frontier draining instead of
      // doing another search-and-scrape cycle that would add more URLs.
      let phase: "search" | "frontier" | "seed" | "rss" | "done" = skipSearch ? "frontier" : "search";

      const onMessage = async (msg: any) => {
        try {
          // Handle DB writes for all data messages (non-fatal if individual writes fail)
          try {
            await handleWorkerMessage(msg);
          } catch (dbErr) {
            // Don't kill the cycle over a single bad DB write
            await logger.warn("sourceDiscovery", `DB write error (non-fatal): ${dbErr}`);
          }

          // Phase transitions
          if (msg.type === "search-complete") {
            searchStats = { pagesScraped: msg.pagesScraped, chunksStored: msg.chunksStored };
            // Fall through to start frontier phase
            phase = "frontier";
          }

          // Frontier drain — process a big batch now. Increased from 15 to
          // 75 so we actually make a dent in the queue. With ~5s per URL
          // this takes ~6 min, well within the 10-min cycle timeout. Domain
          // cap raised from 2 to 5 so we don't artificially bottleneck
          // high-value domains.
          if (phase === "frontier" && (msg.type === "search-complete" || msg.type === "ready")) {
            const frontierUrls = await getNextFrontierUrls(150, 5);

            if (frontierUrls.length === 0) {
              // Seed from top domains instead
              phase = "seed";
              const topDomains = await getTopDomains(10);
              if (topDomains.length > 0) {
                await logger.info("sourceDiscovery", "Frontier empty — seeding from top domains");
                worker.postMessage({ type: "seed-from-domains", domains: topDomains });
              } else {
                phase = "done";
              }
            } else {
              await logger.info("sourceDiscovery", `Frontier phase: sending ${frontierUrls.length} URLs to worker`);
              worker.postMessage({ type: "crawl-frontier", urls: frontierUrls });
            }
          }

          if (msg.type === "frontier-complete") {
            frontierStats = { pagesScraped: msg.pagesScraped, chunksStored: msg.chunksStored };
            phase = "done";
          }

          if (msg.type === "seed-complete") {
            phase = "done";
          }

          // After search+frontier phases complete, always run RSS discovery
          // so new feeds are found every cycle (was random 20%).
          if (phase === "done") {
            phase = "rss";
            worker.postMessage({ type: "discover-rss", recentlyUsedTopics });
            return; // wait for rss-complete
          }

          // RSS phase is the final phase — resolve when it completes.
          if (phase === "rss" && msg.type === "rss-complete") {
            clearTimeout(timeout);
            worker.off("message", onMessage);
            resolve();
          }
        } catch (err) {
          clearTimeout(timeout);
          worker.off("message", onMessage);
          reject(err);
        }
      };

      worker.on("message", onMessage);

      if (skipSearch && prefetchedFrontier) {
        // Go straight to frontier draining — send the pre-fetched batch
        // directly instead of doing a search cycle that adds more URLs.
        if (prefetchedFrontier.length > 0) {
          logger.info("sourceDiscovery", `Drain mode: sending ${prefetchedFrontier.length} frontier URLs`);
          worker.postMessage({ type: "crawl-frontier", urls: prefetchedFrontier });
        } else {
          phase = "done";
          clearTimeout(timeout);
          worker.off("message", onMessage);
          resolve();
        }
      } else {
        // Normal mode: search first, then frontier
        worker.postMessage({ type: "search-and-scrape", recentlyUsedTopics });
      }
    });

    // Log results
    const totalPages = searchStats.pagesScraped + frontierStats.pagesScraped;
    const totalChunks = searchStats.chunksStored + frontierStats.chunksStored;
    const fStats = await getFrontierStats();

    await logger.info("sourceDiscovery",
      `Cycle complete: ${totalPages} pages, ${totalChunks} chunks | ` +
      `Search: ${searchStats.pagesScraped}p/${searchStats.chunksStored}c | ` +
      `Frontier: ${frontierStats.pagesScraped}p/${frontierStats.chunksStored}c | ` +
      `Queue: ${fStats.pending} pending, ${fStats.scraped} done`
    );

    // Log top domains periodically
    if (Math.random() < 0.1) {
      const topDomains = await getTopDomains(5);
      if (topDomains.length > 0) {
        const domainInfo = topDomains.map((d: any) =>
          `${d.domain} (q:${(d.quality_score ?? 0).toFixed(2)}, ${d.chunks_stored}ch, ${d.chunks_retrieved}ret)`
        ).join(", ");
        await logger.info("sourceDiscovery", `Top domains: ${domainInfo}`);
      }
    }

  } catch (err) {
    await logger.error("sourceDiscovery", `Discovery cycle failed: ${err}`);
  } finally {
    _crawling = false;
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────
export async function runWebCrawlCycle(): Promise<{ pagesScraped: number; chunksStored: number }> {
  // For manual triggers, run inline (non-blocking since it uses the worker)
  await runDiscoveryCycle();
  return { pagesScraped: 0, chunksStored: 0 }; // stats already logged
}

export async function runSourceDiscovery(): Promise<{ newSources: number }> {
  // Trigger RSS discovery via worker
  const worker = getWorker();
  const recentlyUsedTopics = await getRecentlyUsedTopics(6 * 60 * 60 * 1000);

  return new Promise((resolve) => {
    let count = 0;
    const onMessage = async (msg: any) => {
      await handleWorkerMessage(msg);
      if (msg.type === "rss-discovered") count++;
      if (msg.type === "rss-complete") {
        worker.off("message", onMessage);
        resolve({ newSources: count });
      }
    };
    worker.on("message", onMessage);
    worker.postMessage({ type: "discover-rss", recentlyUsedTopics });
  });
}

let _schedulerInterval: NodeJS.Timeout | null = null;

export function startSourceDiscoveryScheduler(intervalMs: number = 30 * 60 * 1000): void {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
  }

  const intervalMinutes = Math.round(intervalMs / 60000);
  logger.info("sourceDiscovery", `Smart crawler started (every ${intervalMinutes}m) [worker thread]`);

  // Run first cycle after a short delay to let server initialize
  setTimeout(() => runDiscoveryCycle(), 10000);

  _schedulerInterval = setInterval(() => {
    runDiscoveryCycle();
  }, intervalMs);
}

export function stopSourceDiscoveryScheduler(): void {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
  }
  if (_worker) {
    _worker.terminate();
    _worker = null;
  }
  logger.info("sourceDiscovery", "Web crawl scheduler stopped");
}
