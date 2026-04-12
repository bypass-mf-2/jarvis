import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { COOKIE_NAME } from "../shared/const";

// ── Mock DB helpers ───────────────────────────────────────────────────────────
vi.mock("./db-sqlite", () => ({
  getConversations: vi.fn().mockResolvedValue([
    { id: 1, title: "Test Conv", model: "llama3.2", userId: null, createdAt: new Date(), updatedAt: new Date() },
  ]),
  createConversation: vi.fn().mockResolvedValue({
    id: 2, title: "New Conversation", model: "llama3.2", userId: null, createdAt: new Date(), updatedAt: new Date(),
  }),
  getConversationById: vi.fn().mockResolvedValue({
    id: 1, title: "Test Conv", model: "llama3.2", userId: null, createdAt: new Date(), updatedAt: new Date(),
  }),
  getMessages: vi.fn().mockResolvedValue([
    { id: 1, conversationId: 1, role: "user", content: "Hello", createdAt: new Date(), ragChunksUsed: null, tokensUsed: null, audioUrl: null },
    { id: 2, conversationId: 1, role: "assistant", content: "Hi there!", createdAt: new Date(), ragChunksUsed: null, tokensUsed: null, audioUrl: null },
  ]),
  addMessage: vi.fn().mockResolvedValue({
    id: 3, conversationId: 1, role: "assistant", content: "Test response", createdAt: new Date(), ragChunksUsed: null, tokensUsed: null, audioUrl: null,
  }),
  updateConversationTitle: vi.fn().mockResolvedValue(undefined),
  deleteConversation: vi.fn().mockResolvedValue(undefined),
  getKnowledgeChunks: vi.fn().mockResolvedValue([
    { id: 1, sourceUrl: "https://example.com", sourceTitle: "Test", sourceType: "rss", content: "Test content", summary: null, chromaId: "abc", embeddingModel: "nomic-embed-text", tags: [], scrapedAt: new Date(), createdAt: new Date() },
  ]),
  countKnowledgeChunks: vi.fn().mockResolvedValue(1),
  deleteKnowledgeChunk: vi.fn().mockResolvedValue(undefined),
  getScrapeSources: vi.fn().mockResolvedValue([
    { id: 1, name: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml", type: "rss", isActive: true, intervalMinutes: 60, lastScrapedAt: null, lastStatus: "pending", lastError: null, totalChunks: 0, createdAt: new Date(), updatedAt: new Date() },
  ]),
  addScrapeSource: vi.fn().mockResolvedValue({
    id: 2, name: "Test Source", url: "https://example.com/rss", type: "rss", isActive: true, intervalMinutes: 60, lastScrapedAt: null, lastStatus: "pending", lastError: null, totalChunks: 0, createdAt: new Date(), updatedAt: new Date(),
  }),
  toggleScrapeSource: vi.fn().mockResolvedValue(undefined),
  deleteScrapeSource: vi.fn().mockResolvedValue(undefined),
  updateScrapeSourceStatus: vi.fn().mockResolvedValue(undefined),
  getSystemLogs: vi.fn().mockResolvedValue([
    { id: 1, level: "info", module: "test", message: "Test log", metadata: null, createdAt: new Date() },
  ]),
  getRecentErrorLogs: vi.fn().mockResolvedValue([]),
  getPatches: vi.fn().mockResolvedValue([
    { id: 1, analysisInput: "test", suggestion: "Test suggestion", patchDiff: null, targetFile: null, status: "pending", appliedAt: null, createdAt: new Date() },
  ]),
  addPatch: vi.fn().mockResolvedValue({ id: 2, suggestion: "New suggestion", status: "pending", createdAt: new Date() }),
  updatePatchStatus: vi.fn().mockResolvedValue(undefined),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  getUserByOpenId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./rag", () => ({
  ragChat: vi.fn().mockResolvedValue({ response: "Test AI response", ragChunks: [] }),
}));

vi.mock("./scraper", () => ({
  scrapeSource: vi.fn().mockResolvedValue({ chunksAdded: 5 }),
  scrapeAllSources: vi.fn().mockResolvedValue({ total: 1, succeeded: 1, failed: 0 }),
}));

vi.mock("./selfImprovement", () => ({
  runSelfAnalysis: vi.fn().mockResolvedValue({ suggestion: "Test suggestion", patchId: 2 }),
  applyPatch: vi.fn().mockResolvedValue({ success: true, message: "Patch applied" }),
}));

vi.mock("./ollama", () => ({
  isOllamaAvailable: vi.fn().mockResolvedValue(false),
  listOllamaModels: vi.fn().mockResolvedValue([]),
}));

vi.mock("./_core/voiceTranscription", () => ({
  transcribeAudio: vi.fn().mockResolvedValue({ text: "Hello JARVIS" }),
}));

// ── Test context ──────────────────────────────────────────────────────────────
function createCtx(): TrpcContext {
  const clearedCookies: { name: string; options: Record<string, unknown> }[] = [];
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };
}

// ── Auth tests ────────────────────────────────────────────────────────────────
describe("auth", () => {
  it("returns null user when not authenticated", async () => {
    const caller = appRouter.createCaller(createCtx());
    const user = await caller.auth.me();
    expect(user).toBeNull();
  });

  it("logout clears session cookie", async () => {
    const clearedCookies: { name: string; options: Record<string, unknown> }[] = [];
    const ctx: TrpcContext = {
      user: { id: 1, openId: "test", name: "Test", email: null, loginMethod: null, role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {
        clearCookie: (name: string, options: Record<string, unknown>) => clearedCookies.push({ name, options }),
      } as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
  });
});

// ── Chat tests ────────────────────────────────────────────────────────────────
describe("chat", () => {
  it("lists conversations", async () => {
    const caller = appRouter.createCaller(createCtx());
    const convs = await caller.chat.listConversations();
    expect(Array.isArray(convs)).toBe(true);
    expect(convs.length).toBeGreaterThan(0);
  });

  it("creates a new conversation", async () => {
    const caller = appRouter.createCaller(createCtx());
    const conv = await caller.chat.createConversation({});
    expect(conv).toBeDefined();
    expect(conv?.id).toBe(2);
  });

  it("gets conversation with messages", async () => {
    const caller = appRouter.createCaller(createCtx());
    const data = await caller.chat.getConversation({ id: 1 });
    expect(data.conversation.id).toBe(1);
    expect(data.messages.length).toBe(2);
  });

  it("sends a message and gets AI response", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.chat.sendMessage({
      conversationId: 1,
      content: "Hello JARVIS",
    });
    expect(result.message).toBeDefined();
    expect(result.message?.content).toBe("Test response");
  });

  it("deletes a conversation", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.chat.deleteConversation({ id: 1 });
    expect(result.success).toBe(true);
  });
});

// ── Knowledge tests ───────────────────────────────────────────────────────────
describe("knowledge", () => {
  it("lists knowledge chunks with total count", async () => {
    const caller = appRouter.createCaller(createCtx());
    const data = await caller.knowledge.list({ limit: 10, offset: 0 });
    expect(data.chunks.length).toBeGreaterThan(0);
    expect(data.total).toBe(1);
  });

  it("deletes a knowledge chunk", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.knowledge.delete({ id: 1 });
    expect(result.success).toBe(true);
  });
});

// ── Scraper tests ─────────────────────────────────────────────────────────────
describe("scraper", () => {
  it("lists scrape sources", async () => {
    const caller = appRouter.createCaller(createCtx());
    const sources = await caller.scraper.listSources();
    expect(Array.isArray(sources)).toBe(true);
    expect(sources[0]?.name).toBe("BBC News");
  });

  it("adds a new scrape source", async () => {
    const caller = appRouter.createCaller(createCtx());
    const source = await caller.scraper.addSource({
      name: "Test Source",
      url: "https://example.com/rss",
      type: "rss",
      intervalMinutes: 60,
    });
    expect(source?.name).toBe("Test Source");
  });

  it("triggers a scrape of all sources", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.scraper.scrapeNow({});
    expect((result as any).succeeded).toBe(1);
  });
});

// ── Self-improvement tests ────────────────────────────────────────────────────
describe("selfImprovement", () => {
  it("lists patches", async () => {
    const caller = appRouter.createCaller(createCtx());
    const patches = await caller.selfImprovement.listPatches();
    expect(Array.isArray(patches)).toBe(true);
    expect(patches[0]?.suggestion).toBe("Test suggestion");
  });

  it("runs self-analysis and creates a patch", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.selfImprovement.runAnalysis();
    expect(result.suggestion).toBe("Test suggestion");
    expect(result.patchId).toBe(2);
  });

  it("approves a patch", async () => {
    const caller = appRouter.createCaller(createCtx());
    const result = await caller.selfImprovement.approveOrRejectPatch({ id: 1, action: "approved" });
    expect(result.success).toBe(true);
  });
});

// ── System status tests ───────────────────────────────────────────────────────
describe("systemStatus", () => {
  it("returns system status with ollama, knowledge, and scraper info", async () => {
    const caller = appRouter.createCaller(createCtx());
    const status = await caller.systemStatus.status();
    expect(status.ollama).toBeDefined();
    expect(status.knowledge).toBeDefined();
    expect(status.scraper).toBeDefined();
    expect(typeof status.ollama.available).toBe("boolean");
  });

  it("returns system logs", async () => {
    const caller = appRouter.createCaller(createCtx());
    const logs = await caller.systemStatus.logs({ limit: 10 });
    expect(Array.isArray(logs)).toBe(true);
    expect(logs[0]?.message).toBe("Test log");
  });
});
