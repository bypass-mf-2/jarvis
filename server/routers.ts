import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  createConversation,
  getConversations,
  getConversationById,
  getMessages,
  addMessage,
  updateConversationTitle,
  deleteConversation,
  getKnowledgeChunks,
  countKnowledgeChunks,
  deleteKnowledgeChunk,
  getActivityRates,
  addScrapeSource,
  getScrapeSources,
  toggleScrapeSource,
  deleteScrapeSource,
  getSystemLogs,
  getPatches,
  updatePatchStatus,
  getLearnedFacts,
  searchLearnedFacts,
  getEntityMemory,
  searchEntityMemory,
  getMessageById,
  updateMessageRating,
  getMessagesBeforeId,
} from "./db";
import {
  analyzeWritingStyle,
  loadVoiceProfile,
  writeInTrevorsVoice,
} from "./voiceLearning.js";
import {
  listSamples as listWritingSamplesModule,
  getProfile as getWritingProfileModule,
  regenerateWritingProfile,
  deleteWritingSample as deleteWritingSampleModule,
} from "./writingProfile.js";
import {
  startNavigationTask,
  getRun as getNavRun,
  listRuns as listNavRuns,
  stopTask as stopNavTask,
  resolvePendingAction as resolveNavPending,
  resolveTypedConfirmation as resolveNavTyped,
  beginCaptureSession,
  finalizeCaptureSession,
  cancelCaptureSession,
  listSessions as listNavSessions,
  deleteSession as deleteNavSession,
} from "./navigator.js";
import { listNavAuditLog } from "./db";
import { logger } from "./logger";
import { ragChat } from "./rag";
import { scrapeSource, scrapeAllSources, isScraperEnabled, setScraperEnabled } from "./scraper";
import { analyzeSelfForImprovements, safeApplyCodeChange, analyzeImprovementFeed } from "./selfImprovement";
import { readRecentEvents as readImprovementFeed } from "./improvementFeed";
import { isOllamaAvailable, listOllamaModels } from "./ollama";
import { seedDefaultSources } from "./services";
import { transcribeAudio } from "./_core/voiceTranscription";
import { processConversationMemory } from "./persistentMemory.js";
import {
  getAllSettings,
  getSetting,
  setSetting,
  applyPreset,
  PRESETS,
} from "./llmSettings.js";
import {
  recallRelevantFacts,
  recallEntities,
} from "./persistentMemory.js";
import { generateImage } from "./imageGeneration.js";
import { cloneTrevorsVoice, cloneVoiceElevenLabs } from "./voicecloning.js";
import { executeCode, testCode } from "./codeExecution.js";
import { generateCode, reviewCode, explainCode, fixCode } from "./codingAI.js";
import { searchWeb, searchAndSummarize } from "./webSearch.js";
import { runWebCrawlCycle, runSourceDiscovery } from "./sourceDiscovery.js";
import {
  collectTrainingExample,
  exportTrainingData,
  trainNewModel,
  trainSpecializedModel,
  getTrainingStats,
  generateTrainingFromChunks,
} from "./autoTrain.js";
import { processWithAgentSwarm, getAgentStatus } from "./multiAgent.js";

// ── Chat Router ───────────────────────────────────────────────────────────────
const chatRouter = router({
  listConversations: publicProcedure.query(async ({ ctx }) => {
    return getConversations(ctx.user?.id);
  }),

  getConversation: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const conv = await getConversationById(input.id);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      const msgs = await getMessages(input.id);
      return { conversation: conv, messages: msgs };
    }),

  createConversation: publicProcedure
    .input(z.object({ model: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      return createConversation({
        userId: ctx.user?.id,
        model: input.model ?? "llama3.2",
        title: "New Conversation",
      });
    }),

  sendMessage: publicProcedure
    .input(
      z.object({
        conversationId: z.number(),
        content: z.string().min(1).max(8000),
        model: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Save user message
      await addMessage({
        conversationId: input.conversationId,
        role: "user",
        content: input.content,
      });

      // Get conversation history for context
      const allMessages = await getMessages(input.conversationId);
      const history = allMessages
        .slice(-20)
        .filter((m: any) => m.role !== "system")
        .map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content }));

      // RAG-augmented response
      const { response, ragChunks } = await ragChat(
        input.content,
        history.slice(0, -1), // exclude the message we just added
        input.model
      );

      // Save assistant message
      const assistantMsg = await addMessage({
        conversationId: input.conversationId,
        role: "assistant",
        content: response,
        ragChunksUsed: ragChunks.map((c) => ({
          id: c.id,
          source: c.metadata.sourceTitle || c.metadata.sourceUrl || "Unknown",
          url: c.metadata.sourceUrl || null,
          title: c.metadata.sourceTitle || null,
          sourceType: c.metadata.sourceType || null,
          distance: c.distance,
        })),
      });

      // Process memory in background
      processConversationMemory(input.conversationId).catch(err =>
        logger.error("memory", `Background memory processing failed: ${err}`)
      );

      // Auto-title conversation after first exchange
      const msgs = await getMessages(input.conversationId);
      if (msgs.length === 2) {
        const title = input.content.slice(0, 60) + (input.content.length > 60 ? "..." : "");
        await updateConversationTitle(input.conversationId, title);
      }

      return { message: assistantMsg, ragChunksUsed: ragChunks.length };
    }),

  deleteConversation: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteConversation(input.id);
      return { success: true };
    }),

  transcribeAudio: publicProcedure
    .input(z.object({ audioUrl: z.string().url() }))
    .mutation(async ({ input }) => {
      const result = await transcribeAudio({ audioUrl: input.audioUrl, language: "en" });
      const text = 'text' in result ? result.text : '';
      return { text };
    }),
});

// ── Knowledge Router ──────────────────────────────────────────────────────────
const knowledgeRouter = router({
  list: publicProcedure
    .input(z.object({ limit: z.number().default(50), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const chunks = await getKnowledgeChunks(input.limit, input.offset);
      const total = await countKnowledgeChunks();
      return { chunks, total };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteKnowledgeChunk(input.id);
      return { success: true };
    }),
});

// ── Scraper Router ────────────────────────────────────────────────────────────
const scraperRouter = router({
  listSources: publicProcedure.query(() => getScrapeSources()),

  addSource: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        url: z.string().url(),
        type: z.enum(["rss", "news", "custom_url"]),
        intervalMinutes: z.number().min(5).max(1440).default(60),
      })
    )
    .mutation(async ({ input }) => {
      return addScrapeSource(input);
    }),

  toggleSource: publicProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      await toggleScrapeSource(input.id, input.isActive);
      return { success: true };
    }),

  deleteSource: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteScrapeSource(input.id);
      return { success: true };
    }),

  scrapeNow: publicProcedure
    .input(
      z.object({
        sourceId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (input.sourceId) {
        const sources = await getScrapeSources();
        const source = sources.find((s: any) => s.id === input.sourceId);
        if (!source) throw new TRPCError({ code: "NOT_FOUND" });
        return scrapeSource({ id: source.id, url: source.url, name: source.name, type: source.type });
      }
      return scrapeAllSources();
    }),

  scrapeURL: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
        name: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const tempSource = {
        id: -1,
        url: input.url,
        name: input.name || new URL(input.url).hostname,
        type: "custom_url" as const,
      };
      return scrapeSource(tempSource);
    }),

  seedSources: publicProcedure.mutation(async () => {
    return seedDefaultSources();
  }),

  webCrawl: publicProcedure.mutation(async () => {
    return runWebCrawlCycle();
  }),

  discoverSources: publicProcedure.mutation(async () => {
    return runSourceDiscovery();
  }),

  getEnabled: publicProcedure.query(() => ({ enabled: isScraperEnabled() })),

  setEnabled: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      setScraperEnabled(input.enabled);
      try {
        await setSetting(
          "scraper_enabled",
          input.enabled ? "true" : "false",
          "boolean",
          null,
          "Global on/off switch for background scraping scheduler"
        );
      } catch (err) {
        await logger.warn("scraper", `Failed to persist scraper_enabled: ${String(err)}`);
      }
      return { enabled: input.enabled };
    }),
});

// ── Self-Improvement Router ───────────────────────────────────────────────────
const selfImprovementRouter = router({
  listPatches: publicProcedure.query(() => getPatches(20)),

  runAnalysis: publicProcedure.mutation(async () => {
    return analyzeSelfForImprovements();
  }),

  // Phase 2: scan the improvement feed (real failure events captured during
  // operation) for recurring patterns and turn them into pending patches.
  // Safer than the legacy speculative analyzer because each proposal is
  // grounded in concrete, recent failures.
  analyzeFeed: publicProcedure.mutation(async () => {
    return analyzeImprovementFeed();
  }),

  // Read-only view of the recent improvement feed events. Used by the
  // Self-Improve panel to show "what's been hurting" alongside the
  // proposed patches.
  listFeed: publicProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(({ input }) => readImprovementFeed(input?.limit ?? 50)),

  approveOrRejectPatch: publicProcedure
    .input(
      z.object({
        id: z.number(),
        action: z.enum(["approved", "rejected"]),
      })
    )
    .mutation(async ({ input }) => {
      await updatePatchStatus(input.id, input.action);
      return { success: true };
    }),

  applyPatch: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const patches = await getPatches(100);
      const patch = patches.find((p: any) => p.id === input.id);
      if (!patch) throw new TRPCError({ code: "NOT_FOUND" });
      return safeApplyCodeChange(patch.targetFile, patch.patchDiff, patch.suggestion);
    }),
});

// ── System Router ─────────────────────────────────────────────────────────────
const systemStatusRouter = router({
  status: publicProcedure.query(async () => {
    const ollamaUp = await isOllamaAvailable();
    const models = ollamaUp ? await listOllamaModels() : [];
    const knowledgeCount = await countKnowledgeChunks();
    const sources = await getScrapeSources();
    return {
      ollama: { available: ollamaUp, models },
      knowledge: { totalChunks: knowledgeCount },
      scraper: {
        totalSources: sources.length,
        activeSources: sources.filter((s: any) => s.isActive === true || s.isActive === 1).length,
      },
    };
  }),

  logs: publicProcedure
    .input(z.object({ limit: z.number().default(100) }))
    .query(async ({ input }) => getSystemLogs(input.limit)),

  // Rolling-window counts of recently gathered chunks and sources. Used by
  // the Benchmarks panel to show how fast the system is currently growing.
  // Indexed columns make this fast even on large knowledge bases.
  rates: publicProcedure.query(async () => getActivityRates()),
});

// ── Voice Router ──────────────────────────────────────────────────────────────
const voiceRouter = router({
  clone: publicProcedure
    .input(z.object({ text: z.string() }))
    .mutation(async ({ input }) => {
      const filepath = await cloneTrevorsVoice(input.text);
      return { filepath };
    }),
  analyzeStyle: publicProcedure
    .mutation(async () => {
      return await analyzeWritingStyle();
    }),

  getProfile: publicProcedure
    .query(() => {
      return loadVoiceProfile();
    }),

  writeInMyVoice: publicProcedure
    .input(z.object({
      topic: z.string(),
      length: z.enum(["short", "medium", "long"]).optional(),
      type: z.enum(["essay", "story", "analysis", "chapter"]).optional(),
    }))
    .mutation(async ({ input }) => {
      return await writeInTrevorsVoice(input.topic, input.length, input.type);
    }),

  testVoice: publicProcedure
    .input(z.object({
      voiceId: z.string(),
      text: z.string(),
      stability: z.number(),
      similarityBoost: z.number(),
    }))
    .mutation(async ({ input }) => {
      const path = await import("path");
      const filepath = await cloneVoiceElevenLabs(input.text, input.voiceId);
      return { audioUrl: `/api/audio/${path.basename(filepath)}` };
    }),
});

// ── Settings Router ──────────────────────────────────────────────────────────
const settingsRouter = router({
  saveVoiceSettings: publicProcedure
    .input(z.object({
      voiceId: z.string(),
      stability: z.number(),
      similarityBoost: z.number(),
    }))
    .mutation(async ({ input }) => {
      const fs = await import("fs");
      const path = await import("path");
      const configPath = path.join(process.cwd(), "voice-config.json");
      fs.writeFileSync(configPath, JSON.stringify(input, null, 2));
      return { success: true };
    }),

  getVoiceSettings: publicProcedure.query(async () => {
    const fs = await import("fs");
    const path = await import("path");
    const configPath = path.join(process.cwd(), "voice-config.json");
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
    return {
      voiceId: "21m00Tcm4TlvDq8ikWAM",
      stability: 0.5,
      similarityBoost: 0.75,
    };
  }),
});

// ── Memory Router ─────────────────────────────────────────────────────────────
const memoryRouter = router({
  getFacts: publicProcedure
    .input(z.object({ query: z.string().optional(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      if (!input.query) {
        return getLearnedFacts(input.limit || 50);
      }
      return recallRelevantFacts(input.query, input.limit || 10);
    }),

  getEntities: publicProcedure
    .input(z.object({ query: z.string().optional(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      if (!input.query) {
        return getEntityMemory(input.limit || 50);
      }
      return recallEntities(input.query, input.limit || 10);
    }),

  processConversation: publicProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ input }) => {
      await processConversationMemory(input.conversationId);
      return { success: true };
    }),
});

// ── LLM Settings Router ──────────────────────────────────────────────────────
const llmRouter = router({
  getSettings: publicProcedure
    .query(async () => {
      return await getAllSettings();
    }),

  getSetting: publicProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ input }) => {
      return await getSetting(input.name);
    }),

  setSetting: publicProcedure
    .input(z.object({
      name: z.string(),
      value: z.string(),
      type: z.enum(["string", "number", "boolean", "json"]).optional(),
    }))
    .mutation(async ({ input }) => {
      await setSetting(input.name, input.value, input.type || "string");
      return { success: true };
    }),

  getPresets: publicProcedure
    .query(() => {
      return PRESETS;
    }),

  applyPreset: publicProcedure
    .input(z.object({ preset: z.string() }))
    .mutation(async ({ input }) => {
      await applyPreset(input.preset as any);
      return { success: true };
    }),
});

// ── Image Generation Router ─────────────────────────────────────────────────
const imageRouter = router({
  generate: publicProcedure
    .input(z.object({
      prompt: z.string(),
      preferLocal: z.boolean().optional()
    }))
    .mutation(async ({ input }) => {
      const result = await generateImage(input.prompt, input.preferLocal);
      return result;
    }),
});

// ── Code Execution Router ───────────────────────────────────────────────────
const codeRouter = router({
  execute: publicProcedure
    .input(z.object({
      code: z.string(),
      language: z.enum(["javascript", "python", "swift"]).optional(),
    }))
    .mutation(async ({ input }) => {
      return await executeCode(input.code, input.language);
    }),

  generate: publicProcedure
    .input(z.object({
      task: z.string(),
      language: z.enum(["swift", "python", "javascript", "typescript", "java", "cpp"]),
      includeTests: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      return await generateCode(input.task, input.language, input.includeTests);
    }),

  review: publicProcedure
    .input(z.object({
      code: z.string(),
      language: z.enum(["swift", "python", "javascript", "typescript"]),
    }))
    .mutation(async ({ input }) => {
      return await reviewCode(input.code, input.language);
    }),

  explain: publicProcedure
    .input(z.object({
      code: z.string(),
      language: z.string(),
    }))
    .mutation(async ({ input }) => {
      return await explainCode(input.code, input.language);
    }),

  fix: publicProcedure
    .input(z.object({
      code: z.string(),
      error: z.string(),
      language: z.string(),
    }))
    .mutation(async ({ input }) => {
      return await fixCode(input.code, input.error, input.language);
    }),
});

// ── Web Search Router ───────────────────────────────────────────────────────
const searchRouter = router({
  web: publicProcedure
    .input(z.object({
      query: z.string(),
      maxResults: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return await searchWeb(input.query, input.maxResults);
    }),

  summarize: publicProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      return await searchAndSummarize(input.query);
    }),
});

// ── Training Router ─────────────────────────────────────────────────────────
const trainingRouter = router({
  rateMessage: publicProcedure
    .input(z.object({
      messageId: z.number(),
      rating: z.number().min(1).max(5),
    }))
    .mutation(async ({ input }) => {
      const message = await getMessageById(input.messageId);

      if (!message) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await updateMessageRating(input.messageId, input.rating);

      if (input.rating >= 4 && message.role === "assistant") {
        const userMessages = await getMessagesBeforeId(
          message.conversationId,
          message.id,
          1
        );

        if (userMessages[0]) {
          await collectTrainingExample(
            message.conversationId,
            userMessages[0].content,
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
    const dataPath = await exportTrainingData("general", 4, 1000);

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

  // Convert knowledge chunks into synthetic training examples on demand.
  // Runs inline (not backgrounded) so the caller gets the counts back.
  generateFromSources: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await generateTrainingFromChunks(input.limit ?? 50);
      return { success: true, ...result };
    }),
});

// Multi-Agent Swarm Router
const multiAgentRouter = router({
  // Process complex query with agent swarm
  processQuery: publicProcedure
    .input(z.object({
      query: z.string(),
      conversationId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const result = await processWithAgentSwarm(input.query);
        return {
          success: true,
          result: result,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err.message,
        };
      }
    }),

  // Get agent status
  getStatus: publicProcedure.query(async () => {
    return getAgentStatus();
  }),
});

// ── Writing Profile Router ────────────────────────────────────────────────────
// Personal writing samples for voice learning. SEPARATE from the regular
// knowledge base — these never feed RAG, only the chat system prompt.
const writingProfileRouter = router({
  // List all uploaded samples (metadata only — rawText is too big to ship
  // on every list call).
  listSamples: publicProcedure.query(async () => {
    const samples = await listWritingSamplesModule();
    return samples.map((s) => ({
      id: s.id,
      originalName: s.originalName,
      category: s.category,
      description: s.description,
      wordCount: s.wordCount,
      analyzed: !!s.analyzedAt,
      analyzedAt: s.analyzedAt,
      createdAt: s.createdAt,
    }));
  }),

  // Return the current aggregated profile (or null if no samples yet).
  getProfile: publicProcedure.query(async () => {
    return getWritingProfileModule();
  }),

  // Force a profile rebuild across all currently-stored samples. Useful
  // after deleting samples or after an LLM upgrade so the profile reflects
  // the latest analyses.
  regenerate: publicProcedure.mutation(async () => {
    const profile = await regenerateWritingProfile();
    return { success: true, profile };
  }),

  // Delete a sample by id. Also unlinks the file on disk and re-aggregates
  // the profile.
  deleteSample: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteWritingSampleModule(input.id);
      return { success: true };
    }),
});

// ── Navigator Router ──────────────────────────────────────────────────────────
// Playwright-driven browser automation. See server/navigator.ts for the
// safety model. Every destructive action requires explicit user approval
// via the approveAction mutation.
const navigatorRouter = router({
  startTask: publicProcedure
    .input(
      z.object({
        goal: z.string().min(5),
        allowlist: z.array(z.string()).optional(),
        maxSteps: z.number().min(1).max(30).optional(),
        allowDestructive: z.boolean().optional(),
        highStakes: z.boolean().optional(),
        headless: z.boolean().optional(),
        sessionId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const taskId = await startNavigationTask(input);
      return { taskId };
    }),

  // Return the current state of a single run (used for polling while the
  // agent is working). Omits extractedText to keep the payload small; the
  // UI can request the full run for a detailed view.
  getRun: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => {
      const run = getNavRun(input.taskId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown taskId" });
      return run;
    }),

  listRuns: publicProcedure.query(() => {
    // Strip the rawText extract fields for list view to keep it lightweight.
    return listNavRuns().map((r) => ({
      taskId: r.taskId,
      goal: r.goal,
      status: r.status,
      stepCount: r.steps.length,
      finalResult: r.finalResult,
      error: r.error,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      pendingAction: r.pendingAction,
    }));
  }),

  stopTask: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ input }) => {
      await stopNavTask(input.taskId);
      return { success: true };
    }),

  // Approve or reject a pending destructive action (simple single-click
  // confirmation for non-high-stakes tasks).
  resolvePending: publicProcedure
    .input(z.object({ taskId: z.string(), approve: z.boolean() }))
    .mutation(async ({ input }) => {
      await resolveNavPending(input.taskId, input.approve);
      return { success: true };
    }),

  // Typed-confirmation approval for high-stakes tasks. User must type the
  // exact requiredConfirmationPhrase. Anything else rejects and logs.
  resolveTyped: publicProcedure
    .input(z.object({ taskId: z.string(), userText: z.string() }))
    .mutation(async ({ input }) => {
      return resolveNavTyped(input.taskId, input.userText);
    }),

  // ── Sessions (credential passthrough) ────────────────────────────────
  listSessions: publicProcedure.query(async () => {
    return listNavSessions();
  }),

  beginCapture: publicProcedure
    .input(z.object({ startUrl: z.string().optional() }).optional())
    .mutation(async ({ input }) => {
      return beginCaptureSession(input?.startUrl);
    }),

  finalizeCapture: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const session = await finalizeCaptureSession(input.name, input.description ?? null);
      return session;
    }),

  cancelCapture: publicProcedure.mutation(async () => {
    await cancelCaptureSession();
    return { success: true };
  }),

  deleteSession: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteNavSession(input.id);
      return { success: true };
    }),

  // ── Audit log (high-stakes decisions) ────────────────────────────────
  listAuditLog: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => {
      return listNavAuditLog(input?.limit ?? 100);
    }),
});

// ── App Router ────────────────────────────────────────────────────────────────
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  chat: chatRouter,
  knowledge: knowledgeRouter,
  scraper: scraperRouter,
  selfImprovement: selfImprovementRouter,
  systemStatus: systemStatusRouter,
  training: trainingRouter,
  voice: voiceRouter,
  memory: memoryRouter,
  llm: llmRouter,
  image: imageRouter,
  code: codeRouter,
  search: searchRouter,
  settings: settingsRouter,
  multiAgent: multiAgentRouter,
  writingProfile: writingProfileRouter,
  navigator: navigatorRouter,
});

export type AppRouter = typeof appRouter;
