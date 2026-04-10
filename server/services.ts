/**
 * Background services initializer.
 * Called once at server startup to kick off all scheduled background tasks.
 */
import { startMemoryConsolidation } from "./persistentMemory.js";
import { initializeDefaultSettings, getSetting } from "./llmSettings.js";
import { startVoiceLearning } from "./voiceLearning.js";
import { startScraperScheduler, scrapeAllSources, initializeDeduplicationCache, setScraperEnabled } from "./scraper";
import { logger } from "./logger";
import {
  addScrapeSource,
  getScrapeSources,
} from "./db";
import { startSourceDiscoveryScheduler } from "./sourceDiscovery.js";
import {
  startAutoTraining,
} from "./autoTrain.js";

// Default RSS sources to seed on first run — focused on research, science, and programming knowledge
const DEFAULT_SOURCES = [
  // ── Research papers & academic ────────────────────────────────────────────
  { name: "ArXiv AI",                 url: "https://arxiv.org/rss/cs.AI",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Machine Learning",   url: "https://arxiv.org/rss/cs.LG",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Computation/Lang",   url: "https://arxiv.org/rss/cs.CL",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Computer Vision",    url: "https://arxiv.org/rss/cs.CV",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Neural Computing",   url: "https://arxiv.org/rss/cs.NE",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Software Eng",       url: "https://arxiv.org/rss/cs.SE",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Programming Lang",   url: "https://arxiv.org/rss/cs.PL",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Distributed Sys",    url: "https://arxiv.org/rss/cs.DC",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Cryptography",       url: "https://arxiv.org/rss/cs.CR",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "ArXiv Robotics",           url: "https://arxiv.org/rss/cs.RO",                 type: "rss" as const, intervalMinutes: 30 },
  { name: "Papers With Code",         url: "https://paperswithcode.com/latest.xml",       type: "rss" as const, intervalMinutes: 60 },
  { name: "Nature",                   url: "https://www.nature.com/nature.rss",           type: "rss" as const, intervalMinutes: 60 },
  { name: "Nature Machine Intel",     url: "https://www.nature.com/natmachintell.rss",    type: "rss" as const, intervalMinutes: 60 },
  { name: "Science Magazine",         url: "https://www.science.org/rss/news_current.xml",type: "rss" as const, intervalMinutes: 60 },
  { name: "PLOS One",                 url: "https://journals.plos.org/plosone/feed/atom", type: "rss" as const, intervalMinutes: 120 },
  { name: "MIT News",                 url: "https://news.mit.edu/rss/research",           type: "rss" as const, intervalMinutes: 60 },
  { name: "Stanford AI Lab",          url: "https://ai.stanford.edu/blog/feed.xml",       type: "rss" as const, intervalMinutes: 120 },
  { name: "Berkeley AI Research",     url: "https://bair.berkeley.edu/blog/feed.xml",     type: "rss" as const, intervalMinutes: 120 },

  // ── AI labs & research blogs ──────────────────────────────────────────────
  { name: "OpenAI Research",          url: "https://openai.com/research/rss.xml",         type: "rss" as const, intervalMinutes: 60 },
  { name: "DeepMind",                 url: "https://www.deepmind.com/blog/rss.xml",       type: "rss" as const, intervalMinutes: 60 },
  { name: "Anthropic News",           url: "https://www.anthropic.com/news/rss.xml",      type: "rss" as const, intervalMinutes: 60 },
  { name: "Google AI Blog",           url: "https://blog.research.google/feeds/posts/default", type: "rss" as const, intervalMinutes: 60 },
  { name: "Meta AI Research",         url: "https://ai.meta.com/blog/rss/",               type: "rss" as const, intervalMinutes: 60 },
  { name: "Hugging Face Blog",        url: "https://huggingface.co/blog/feed.xml",        type: "rss" as const, intervalMinutes: 60 },
  { name: "Distill",                  url: "https://distill.pub/rss.xml",                 type: "rss" as const, intervalMinutes: 240 },

  // ── Programming & software engineering ────────────────────────────────────
  { name: "Hacker News (Best)",       url: "https://hnrss.org/best",                      type: "rss" as const, intervalMinutes: 30 },
  { name: "Hacker News (Show HN)",    url: "https://hnrss.org/show",                      type: "rss" as const, intervalMinutes: 30 },
  { name: "GitHub Blog",              url: "https://github.blog/feed/",                   type: "rss" as const, intervalMinutes: 60 },
  { name: "GitHub Trending TS",       url: "https://github.com/trending/typescript.rss",  type: "rss" as const, intervalMinutes: 60 },
  { name: "GitHub Trending Python",   url: "https://github.com/trending/python.rss",      type: "rss" as const, intervalMinutes: 60 },
  { name: "GitHub Trending Rust",     url: "https://github.com/trending/rust.rss",        type: "rss" as const, intervalMinutes: 60 },
  { name: "GitHub Trending Go",       url: "https://github.com/trending/go.rss",          type: "rss" as const, intervalMinutes: 60 },
  { name: "Dev.to",                   url: "https://dev.to/feed",                         type: "rss" as const, intervalMinutes: 30 },
  { name: "Stack Overflow Blog",      url: "https://stackoverflow.blog/feed/",            type: "rss" as const, intervalMinutes: 60 },
  { name: "Martin Fowler",            url: "https://martinfowler.com/feed.atom",          type: "rss" as const, intervalMinutes: 240 },
  { name: "High Scalability",         url: "https://highscalability.com/rss.xml",         type: "rss" as const, intervalMinutes: 240 },
  { name: "InfoQ",                    url: "https://feed.infoq.com/",                     type: "rss" as const, intervalMinutes: 60 },
  { name: "The Pragmatic Engineer",   url: "https://blog.pragmaticengineer.com/rss/",     type: "rss" as const, intervalMinutes: 240 },

  // ── Language & framework docs/blogs ───────────────────────────────────────
  { name: "TypeScript Blog",          url: "https://devblogs.microsoft.com/typescript/feed/", type: "rss" as const, intervalMinutes: 240 },
  { name: "Node.js Blog",             url: "https://nodejs.org/en/feed/blog.xml",         type: "rss" as const, intervalMinutes: 240 },
  { name: "Python Insider",           url: "https://blog.python.org/feeds/posts/default", type: "rss" as const, intervalMinutes: 240 },
  { name: "Rust Blog",                url: "https://blog.rust-lang.org/feed.xml",         type: "rss" as const, intervalMinutes: 240 },
  { name: "Go Blog",                  url: "https://go.dev/blog/feed.atom",               type: "rss" as const, intervalMinutes: 240 },
  { name: "React Blog",               url: "https://react.dev/rss.xml",                   type: "rss" as const, intervalMinutes: 240 },
  { name: "MDN Web Docs",             url: "https://developer.mozilla.org/en-US/blog/rss.xml", type: "rss" as const, intervalMinutes: 240 },

  // ── Engineering blogs (real-world systems) ────────────────────────────────
  { name: "Netflix Tech Blog",        url: "https://netflixtechblog.com/feed",            type: "rss" as const, intervalMinutes: 240 },
  { name: "Uber Engineering",         url: "https://www.uber.com/blog/engineering/rss/",  type: "rss" as const, intervalMinutes: 240 },
  { name: "Cloudflare Blog",          url: "https://blog.cloudflare.com/rss/",            type: "rss" as const, intervalMinutes: 240 },
  { name: "Stripe Engineering",       url: "https://stripe.com/blog/feed.rss",            type: "rss" as const, intervalMinutes: 240 },

  // ── Science & general knowledge ───────────────────────────────────────────
  { name: "Science Daily",            url: "https://www.sciencedaily.com/rss/all.xml",    type: "rss" as const, intervalMinutes: 60 },
  { name: "MIT Technology Review",    url: "https://www.technologyreview.com/feed/",      type: "rss" as const, intervalMinutes: 60 },
  { name: "Quanta Magazine",          url: "https://www.quantamagazine.org/feed/",        type: "rss" as const, intervalMinutes: 240 },
  { name: "Ars Technica Science",     url: "https://feeds.arstechnica.com/arstechnica/science", type: "rss" as const, intervalMinutes: 60 },
  { name: "Wikipedia Featured",       url: "https://en.wikipedia.org/w/api.php?action=featuredfeed&feed=featured&feedformat=rss", type: "rss" as const, intervalMinutes: 720 },
];

export async function startBackgroundServices(): Promise<void> {
  await logger.info("services", "Initializing ALL background services...");

  // Initialize LLM settings first
  await initializeDefaultSettings();

  // Seed any default sources missing from the DB. Idempotent — adds new
  // entries from DEFAULT_SOURCES that aren't already present by URL, so
  // adding new feeds to the default list eventually backfills running
  // installs without wiping user-added sources.
  try {
    const existing = await getScrapeSources();
    const existingUrls = new Set(existing.map((s: any) => s.url));
    const missing = DEFAULT_SOURCES.filter(s => !existingUrls.has(s.url));

    if (missing.length > 0) {
      await logger.info("services", `Seeding ${missing.length} missing default RSS sources (${existing.length} already present)...`);
      for (const source of missing) {
        await addScrapeSource(source);
      }
      await logger.info("services", `Seeded ${missing.length} default sources`);

      // Run an initial scrape only on first run (when the DB was empty),
      // not on every backfill — backfilled sources will get picked up by
      // the regular scheduler.
      if (existing.length === 0) {
        await logger.info("services", "Running initial scrape...");
        try {
          const result = await scrapeAllSources();
          await logger.info("services", `Initial scrape: ${result.succeeded} succeeded, ${result.failed} failed`);
        } catch (err) {
          await logger.warn("services", `Initial scrape failed: ${String(err)}`);
        }
      }
    }
  } catch (err) {
    await logger.warn("services", `Failed to seed sources: ${String(err)}`);
  }

  // Start scraper (every 1 minute by default, configurable via env)
  // Init dedup cache here — it does a DB read, and SQLite is now guaranteed ready.
  await initializeDeduplicationCache();
  const scraperInterval = parseInt(process.env.SCRAPER_INTERVAL_MS ?? "60000");
  // Restore persisted enable/disable state — defaults to enabled if unset.
  try {
    const persisted = await getSetting("scraper_enabled");
    if (persisted === "false") {
      setScraperEnabled(false);
      await logger.info("services", "Scraper scheduler restored in DISABLED state (from persisted setting)");
    }
  } catch (err) {
    await logger.warn("services", `Failed to load scraper_enabled setting: ${String(err)}`);
  }
  startScraperScheduler(scraperInterval);
  await logger.info("services", `✅ Scraper started (${scraperInterval / 1000}s intervals)`);

  // Start memory consolidation (processes conversations hourly)
  startMemoryConsolidation(60 * 60 * 1000);
  await logger.info("services", "✅ Memory consolidation started (hourly)");

  // Start voice learning (updates daily)
  startVoiceLearning(24 * 60 * 60 * 1000);
  await logger.info("services", "✅ Voice learning started (daily)");

  // Start auto-training (runs weekly)
  startAutoTraining(7 * 24 * 60 * 60 * 1000);
  await logger.info("services", "✅ Auto-training started (weekly)");

  // Start source discovery (every 1 minute)
  startSourceDiscoveryScheduler(30* 60 * 1000);
  await logger.info("services", "✅ Source discovery started (1 min intervals)");

  await logger.info("services", "🚀 ALL SYSTEMS ONLINE - JARVIS FULLY ACTIVATED");
}

// Idempotent — adds any DEFAULT_SOURCES whose URL isn't already in the DB.
// Returns the count of NEWLY added sources (not the total). Safe to call
// repeatedly: previously this bailed out if any sources existed, which left
// users stuck with whatever sources they had at first run even after the
// default list grew.
export async function seedDefaultSources(): Promise<{ seeded: number; scraped: boolean }> {
  const existing = await getScrapeSources();
  const existingUrls = new Set(existing.map((s: any) => s.url));

  const missing = DEFAULT_SOURCES.filter(s => !existingUrls.has(s.url));
  if (missing.length === 0) {
    await logger.info("services", `Seed check: all ${DEFAULT_SOURCES.length} default sources already present`);
    return { seeded: 0, scraped: false };
  }

  for (const source of missing) {
    await addScrapeSource(source);
  }
  await logger.info("services", `Seeded ${missing.length} new default sources (${existing.length} already existed)`);

  try {
    await scrapeAllSources();
    return { seeded: missing.length, scraped: true };
  } catch {
    return { seeded: missing.length, scraped: false };
  }
}