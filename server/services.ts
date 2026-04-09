/**
 * Background services initializer.
 * Called once at server startup to kick off all scheduled background tasks.
 */
import { startMemoryConsolidation } from "./persistentMemory.js";
import { initializeDefaultSettings } from "./llmSettings.js";
import { startVoiceLearning } from "./voiceLearning.js";
import { startScraperScheduler, scrapeAllSources } from "./scraper";
import { logger } from "./logger";
import {
  addScrapeSource,
  getScrapeSources,
} from "./db";
import { startSourceDiscoveryScheduler } from "./sourceDiscovery.js";
import {
  startAutoTraining,
} from "./autoTrain.js";

// Default RSS sources to seed on first run (16 high-quality feeds)
const DEFAULT_SOURCES = [
  // News & General
  {
    name: "BBC News",
    url: "https://feeds.bbci.co.uk/news/rss.xml",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  {
    name: "Reuters",
    url: "https://feeds.reuters.com/reuters/topNews",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  {
    name: "The Guardian",
    url: "https://www.theguardian.com/world/rss",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  {
    name: "NPR News",
    url: "https://feeds.npr.org/1001/rss.xml",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  // Technology & AI
  {
    name: "TechCrunch",
    url: "https://techcrunch.com/feed/",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  {
    name: "Hacker News",
    url: "https://news.ycombinator.com/rss",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  {
    name: "ArXiv AI",
    url: "https://arxiv.org/rss/cs.AI",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  {
    name: "ArXiv ML",
    url: "https://arxiv.org/rss/cs.LG",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  {
    name: "OpenAI Blog",
    url: "https://openai.com/blog/rss.xml",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  {
    name: "DeepMind Blog",
    url: "https://www.deepmind.com/blog/rss.xml",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  // Science & Research
  {
    name: "Nature",
    url: "https://www.nature.com/nature.rss",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  {
    name: "Science Daily",
    url: "https://www.sciencedaily.com/rss/all.xml",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  {
    name: "MIT Technology Review",
    url: "https://www.technologyreview.com/feed/",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  // Programming & Development
  {
    name: "Dev.to",
    url: "https://dev.to/api/articles?state=fresh&top=7",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  {
    name: "GitHub Trending",
    url: "https://github.com/trending/typescript.rss",
    type: "rss" as const,
    intervalMinutes: 15,
  },
  {
    name: "Stack Overflow",
    url: "https://stackoverflow.com/feeds/tag/javascript",
    type: "rss" as const,
    intervalMinutes: 15,
  },
];

export async function startBackgroundServices(): Promise<void> {
  await logger.info("services", "Initializing ALL background services...");

  // Initialize LLM settings first
  await initializeDefaultSettings();

  // Seed default scrape sources if none exist
  try {
    const existing = await getScrapeSources();
    if (existing.length === 0) {
      await logger.info("services", "Seeding default RSS sources...");
      for (const source of DEFAULT_SOURCES) {
        await addScrapeSource(source);
      }
      await logger.info("services", `Seeded ${DEFAULT_SOURCES.length} default sources`);
      
      // Run initial scrape
      await logger.info("services", "Running initial scrape...");
      try {
        const result = await scrapeAllSources();
        await logger.info("services", `Initial scrape: ${result.succeeded} succeeded, ${result.failed} failed`);
      } catch (err) {
        await logger.warn("services", `Initial scrape failed: ${String(err)}`);
      }
    }
  } catch (err) {
    await logger.warn("services", `Failed to seed sources: ${String(err)}`);
  }

  // Start scraper (every 1 minute by default, configurable via env)
  const scraperInterval = parseInt(process.env.SCRAPER_INTERVAL_MS ?? "60000");
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

export async function seedDefaultSources(): Promise<{ seeded: number; scraped: boolean }> {
  const existing = await getScrapeSources();
  if (existing.length > 0) {
    return { seeded: existing.length, scraped: false };
  }
  for (const source of DEFAULT_SOURCES) {
    await addScrapeSource(source);
  }
  await logger.info("services", `Seeded ${DEFAULT_SOURCES.length} default sources`);
  try {
    const result = await scrapeAllSources();
    return { seeded: DEFAULT_SOURCES.length, scraped: true };
  } catch {
    return { seeded: DEFAULT_SOURCES.length, scraped: false };
  }
}