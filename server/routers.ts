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
import { logger } from "./logger";
import { ragChat } from "./rag";
import { scrapeSource, scrapeAllSources } from "./scraper";
import { analyzeSelfForImprovements, safeApplyCodeChange } from "./selfImprovement";
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
} from "./autoTrain.js";

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
          source: c.metadata.sourceTitle || c.metadata.sourceUrl,
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
});

// ── Self-Improvement Router ───────────────────────────────────────────────────
const selfImprovementRouter = router({
  listPatches: publicProcedure.query(() => getPatches(20)),

  runAnalysis: publicProcedure.mutation(async () => {
    return analyzeSelfForImprovements();
  }),

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
});

export type AppRouter = typeof appRouter;
