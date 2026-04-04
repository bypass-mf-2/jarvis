/**
 * Background services initializer.
 * Called once at server startup to kick off all scheduled background tasks.
 */
import { startMemoryConsolidation } from "./persistentMemory.js";
import { initializeDefaultSettings } from "./llmSettings.js";
import { startVoiceLearning } from "./voiceLearning.js";
import { startScraperScheduler, scrapeAllSources } from "./scraper";
import { startSelfImprovementScheduler } from "./selfImprovement";
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
import { startAgentOptimization } from "./multiAgent.js";
import {
  collectTrainingExample,
  exportTrainingData,
  trainNewModel,
  trainSpecializedModel,
  getTrainingStats,
  startAutoTraining,
} from "./autoTrain.js";
import { smartRouteModel } from "./autoTrain.js";
import { startAutoTraining } from "./autoTrain.js";


// Default RSS sources to seed on first run (16 high-quality feeds)
const DEFAULT_SOURCES = [
  // News & General
  {
    name: "BBC News",
    url: "https://feeds.bbci.co.uk/news/rss.xml",
    type: "rss" as const,
    intervalMinutes: 60,
  },
  {
    name: "Reuters",
    url: "https://feeds.reuters.com/reuters/topNews",
    type: "rss" as const,
    intervalMinutes: 60,
  },
  {
    name: "The Guardian",
    url: "https://www.theguardian.com/world/rss",
    type: "rss" as const,
    intervalMinutes: 120,
  },
  {
    name: "NPR News",
    url: "https://feeds.npr.org/1001/rss.xml",
    type: "rss" as const,
    intervalMinutes: 120,
  },
  // Technology & AI
  {
    name: "TechCrunch",
    url: "https://techcrunch.com/feed/",
    type: "rss" as const,
    intervalMinutes: 120,
  },
  {
    name: "Hacker News",
    url: "https://news.ycombinator.com/rss",
    type: "rss" as const,
    intervalMinutes: 120,
  },
  {
    name: "ArXiv AI",
    url: "https://arxiv.org/rss/cs.AI",
    type: "rss" as const,
    intervalMinutes: 240,
  },
  {
    name: "ArXiv ML",
    url: "https://arxiv.org/rss/cs.LG",
    type: "rss" as const,
    intervalMinutes: 240,
  },
  {
    name: "OpenAI Blog",
    url: "https://openai.com/blog/rss.xml",
    type: "rss" as const,
    intervalMinutes: 240,
  },
  {
    name: "DeepMind Blog",
    url: "https://www.deepmind.com/blog/rss.xml",
    type: "rss" as const,
    intervalMinutes: 240,
  },
  // Science & Research
  {
    name: "Nature",
    url: "https://www.nature.com/nature.rss",
    type: "rss" as const,
    intervalMinutes: 240,
  },
  {
    name: "Science Daily",
    url: "https://www.sciencedaily.com/rss/all.xml",
    type: "rss" as const,
    intervalMinutes: 240,
  },
  {
    name: "MIT Technology Review",
    url: "https://www.technologyreview.com/feed/",
    type: "rss" as const,
    intervalMinutes: 120,
  },
  // Programming & Development
  {
    name: "Dev.to",
    url: "https://dev.to/api/articles?state=fresh&top=7",
    type: "rss" as const,
    intervalMinutes: 120,
  },
  {
    name: "GitHub Trending",
    url: "https://github.com/trending/typescript.rss",
    type: "rss" as const,
    intervalMinutes: 240,
  },
  {
    name: "Stack Overflow",
    url: "https://stackoverflow.com/feeds/tag/javascript",
    type: "rss" as const,
    intervalMinutes: 120,
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

  // Start scraper (every 60 minutes)
  const scraperInterval = parseInt(process.env.SCRAPER_INTERVAL_MS ?? "3600000");
  startScraperScheduler(scraperInterval);

  // Start self-improvement (every 6 hours)
  const improvementInterval = parseInt(process.env.IMPROVEMENT_INTERVAL_MS ?? "21600000");
  startSelfImprovementScheduler(improvementInterval);



  await logger.info("services", "All background services initialized");
}

export async function startBackgroundServices() {
  // ... existing services


  
  // Start voice learning (updates daily)
  startVoiceLearning(24 * 60 * 60 * 1000);
}


export async function startBackgroundServices() {
  // ... existing services
  
  // Initialize LLM settings
  await initializeDefaultSettings();
  
  // Start memory consolidation (processes conversations hourly)
  startMemoryConsolidation(60 * 60 * 1000);
  
  logger.info("services", "Persistent memory activated");
}

export async function startBackgroundServices() {
  // Existing services
  startScraperScheduler();
  startSelfImprovementScheduler();
  
  // New services
  await initializeDefaultSettings();
  startMemoryConsolidation(60 * 60 * 1000);
  
  // One-time: Pull coding models
  // await initializeCodingAI(); // Run this once manually
  
  logger.info("services", "All systems online - JARVIS God Mode activated");
}

// Training Router
const trainingRouter = router({
  rateMessage: publicProcedure
    .input(z.object({
      messageId: z.number(),
      rating: z.number().min(1).max(5),
    }))
    .mutation(async ({ input }) => {
      // Get message
      const [message] = await db
        .select()
        .from(messages)
        .where(eq(messages.id, input.messageId))
        .limit(1);

      if (!message) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Update message rating
      await db
        .update(messages)
        .set({ userRating: input.rating })
        .where(eq(messages.id, input.messageId));

      // Collect as training example if high rating
      if (input.rating >= 4 && message.role === "assistant") {
        // Find the user message before this
        const userMessage = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, message.conversationId),
              lt(messages.id, message.id)
            )
          )
          .orderBy(desc(messages.id))
          .limit(1);

        if (userMessage[0]) {
          await collectTrainingExample(
            message.conversationId,
            userMessage[0].content,
            message.content,
            input.rating
          );
        }
      }

      return { success: true };
    }),

  getStats: publicProcedure.query(async () => {
    return await getTrainingStats();
  }),

  trainNewModel: publicProcedure.mutation(async () => {
    // Export data
    const dataPath = await exportTrainingData("general", 4, 1000);
    
    // Train (runs async, takes hours)
    trainNewModel(dataPath).catch(err =>
      logger.error("training", `Training failed: ${err}`)
    );

    return { success: true, message: "Training started in background" };
  }),

  trainSpecialized: publicProcedure
    .input(z.object({
      specialty: z.enum(["ios", "web", "data"]),
    }))
    .mutation(async ({ input }) => {
      trainSpecializedModel(input.specialty).catch(err =>
        logger.error("training", `Training failed: ${err}`)
      );

      return { 
        success: true, 
        specialty: input.specialty,
        message: `${input.specialty} training started` 
      };
    }),
});

// Add to main router
export const appRouter = router({
  // ... existing routers
  training: trainingRouter,
});

export async function startBackgroundServices() {
  // ... existing services
  
  // Start auto-training (runs weekly)
  startAutoTraining(7 * 24 * 60 * 60 * 1000); // Weekly
  
  logger.info("services", "🤖 Auto-training enabled - JARVIS will improve weekly");
}