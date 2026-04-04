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
} from "./db";
import { ragChat } from "./rag";
import { scrapeSource, scrapeAllSources } from "./scraper";
import { runSelfAnalysis, applyPatch } from "./selfImprovement";
import { isOllamaAvailable, listOllamaModels } from "./ollama";
import { seedDefaultSources } from "./services";
import { transcribeAudio } from "./_core/voiceTranscription";

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
});

// ── Self-Improvement Router ───────────────────────────────────────────────────
const selfImprovementRouter = router({
  listPatches: publicProcedure.query(() => getPatches(20)),

  runAnalysis: publicProcedure.mutation(async () => {
    return runSelfAnalysis();
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
      return applyPatch(input.id);
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
        activeSources: sources.filter((s: any) => s.isActive).length,
      },
    };
  }),

  logs: publicProcedure
    .input(z.object({ limit: z.number().default(100) }))
    .query(async ({ input }) => getSystemLogs(input.limit)),
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
});

export type AppRouter = typeof appRouter;
