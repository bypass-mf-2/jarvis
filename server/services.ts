/**
 * Background services initializer.
 * Called once at server startup to kick off all scheduled background tasks.
 */
import { startMemoryConsolidation } from "./persistentMemory.js";
import { initializeDefaultSettings } from "./llmSettings.js";
import { startVoiceLearning } from "./voiceLearning.js";
import { startScraperScheduler, scrapeAllSources } from "./scraper";
// selfImprovement doesn't export a scheduler, use a no-op wrapper
const startSelfImprovementScheduler = (_intervalMs?: number) => {};
import { logger } from "./logger";
import {
  addScrapeSource,
  getScrapeSources,
} from "./db";
import {
  startAutonomousScheduler,
  setAutonomyLevel,
} from "./autonomousImprovement.js";
import { startSourceDiscoveryScheduler } from "./sourceDiscovery.js";
// multiAgent doesn't export startAgentOptimization
import {
  collectTrainingExample,
  exportTrainingData,
  trainNewModel,
  trainSpecializedModel,
  getTrainingStats,
  startAutoTraining,
  smartRouteModel,
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

export async function seedDefaultSources(): Promise<{ seeded: number; scraped: boolean }> {
  try {
    const existing = await getScrapeSources();
    if (existing.length > 0) {
      return { seeded: existing.length, scraped: false };
    }
    for (const source of DEFAULT_SOURCES) {
      await addScrapeSource(source);
    }
    await logger.info("services", `Seeded ${DEFAULT_SOURCES.length} default sources`);
    // Run initial scrape
    try {
      const result = await scrapeAllSources();
      await logger.info("services", `Initial scrape: ${result.succeeded} succeeded, ${result.failed} failed`);
      return { seeded: DEFAULT_SOURCES.length, scraped: true };
    } catch (err) {
      await logger.warn("services", `Initial scrape failed: ${String(err)}`);
      return { seeded: DEFAULT_SOURCES.length, scraped: false };
    }
  } catch (err) {
    await logger.error("services", `Failed to seed sources: ${String(err)}`);
    throw err;
  }
}

export async function initializeServices(): Promise<void> {
  await logger.info("services", "Initializing background services...");

  // Seed default scrape sources if none exist
  let shouldRunInitialScrape = false;
  try {
    const existing = await getScrapeSources();
    if (existing.length === 0) {
      await logger.info("services", "Seeding default RSS sources...");
      for (const source of DEFAULT_SOURCES) {
        await addScrapeSource(source);
      }
      await logger.info("services", `Seeded ${DEFAULT_SOURCES.length} default sources`);
      shouldRunInitialScrape = true;
    }
  } catch (err) {
    await logger.warn("services", `Failed to seed sources: ${String(err)}`);
  }

  // Run initial scrape if we just seeded sources
  if (shouldRunInitialScrape) {
    await logger.info("services", "Running initial scrape to populate knowledge base...");
    try {
      const result = await scrapeAllSources();
      await logger.info("services", `Initial scrape complete: ${result.succeeded} succeeded, ${result.failed} failed`);
    } catch (err) {
      await logger.warn("services", `Initial scrape failed: ${String(err)}`);
    }
  }

  // Start scraper (every 1 minute)
  const scraperInterval = parseInt(process.env.SCRAPER_INTERVAL_MS ?? "60000");
  startScraperScheduler(scraperInterval);

  // Start self-improvement (every 6 hours)
  const improvementInterval = parseInt(process.env.IMPROVEMENT_INTERVAL_MS ?? "21600000");
  startSelfImprovementScheduler(improvementInterval);

  // Start web crawl & source discovery (every 2 minutes)
  startSourceDiscoveryScheduler(60 * 1000);

  await logger.info("services", "All background services initialized");
}

export async function startBackgroundServices() {
  // Initialize LLM settings
  await initializeDefaultSettings();

  // Start scheduled services
  startScraperScheduler();
  startSelfImprovementScheduler();

  // Start memory consolidation (processes conversations hourly)
  startMemoryConsolidation(60 * 60 * 1000);

  // Start voice learning (updates daily)
  startVoiceLearning(24 * 60 * 60 * 1000);

  // Start auto-training (runs weekly)
  startAutoTraining(7 * 24 * 60 * 60 * 1000);

  // Start web crawl & source discovery (every 2 minutes)
  startSourceDiscoveryScheduler(60 * 1000);

  logger.info("services", "All systems online - JARVIS activated");
}

