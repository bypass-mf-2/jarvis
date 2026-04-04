import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  float,
  boolean,
  json,
  bigint,
} from "drizzle-orm/mysql-core";

// ── Users ─────────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ── Conversations ─────────────────────────────────────────────────────────────
export const conversations = mysqlTable("conversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  title: varchar("title", { length: 255 }).default("New Conversation"),
  model: varchar("model", { length: 128 }).default("llama3.2"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

// ── Messages ──────────────────────────────────────────────────────────────────
export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content").notNull(),
  audioUrl: varchar("audioUrl", { length: 512 }),
  tokensUsed: int("tokensUsed"),
  ragChunksUsed: json("ragChunksUsed"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

// ── Knowledge Chunks (scraped + embedded content) ─────────────────────────────
export const knowledgeChunks = mysqlTable("knowledge_chunks", {
  id: int("id").autoincrement().primaryKey(),
  sourceUrl: varchar("sourceUrl", { length: 1024 }),
  sourceTitle: varchar("sourceTitle", { length: 512 }),
  sourceType: mysqlEnum("sourceType", ["rss", "news", "custom_url", "manual"]).default("custom_url"),
  content: text("content").notNull(),
  summary: text("summary"),
  chromaId: varchar("chromaId", { length: 128 }),
  embeddingModel: varchar("embeddingModel", { length: 128 }).default("nomic-embed-text"),
  tags: json("tags"),
  scrapedAt: timestamp("scrapedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type InsertKnowledgeChunk = typeof knowledgeChunks.$inferInsert;

// ── Scrape Sources ────────────────────────────────────────────────────────────
export const scrapeSources = mysqlTable("scrape_sources", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  url: varchar("url", { length: 1024 }).notNull(),
  type: mysqlEnum("type", ["rss", "news", "custom_url"]).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  intervalMinutes: int("intervalMinutes").default(60),
  lastScrapedAt: timestamp("lastScrapedAt"),
  lastStatus: mysqlEnum("lastStatus", ["success", "error", "pending"]).default("pending"),
  lastError: text("lastError"),
  totalChunks: int("totalChunks").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ScrapeSource = typeof scrapeSources.$inferSelect;
export type InsertScrapeSource = typeof scrapeSources.$inferInsert;

// ── System Logs ───────────────────────────────────────────────────────────────
export const systemLogs = mysqlTable("system_logs", {
  id: int("id").autoincrement().primaryKey(),
  level: mysqlEnum("level", ["info", "warn", "error", "debug"]).default("info"),
  module: varchar("module", { length: 128 }),
  message: text("message").notNull(),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SystemLog = typeof systemLogs.$inferSelect;
export type InsertSystemLog = typeof systemLogs.$inferInsert;

// ── Self-Improvement Patches ──────────────────────────────────────────────────
export const selfImprovementPatches = mysqlTable("self_improvement_patches", {
  id: int("id").autoincrement().primaryKey(),
  analysisInput: text("analysisInput"),
  suggestion: text("suggestion").notNull(),
  patchDiff: text("patchDiff"),
  targetFile: varchar("targetFile", { length: 512 }),
  status: mysqlEnum("status", ["pending", "approved", "applied", "rejected"]).default("pending"),
  appliedAt: timestamp("appliedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SelfImprovementPatch = typeof selfImprovementPatches.$inferSelect;
export type InsertSelfImprovementPatch = typeof selfImprovementPatches.$inferInsert;
