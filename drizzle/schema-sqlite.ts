/**
 * SQLite Schema for JARVIS
 * Same structure as MySQL but using SQLite types
 * Run migrations with: pnpm drizzle-kit generate --dialect sqlite
 */

import {
  integer,
  sqliteTable,
  text,
  real,
  primaryKey,
} from "drizzle-orm/sqlite-core";

// ── Users ─────────────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  openId: text("openId").notNull().unique(),
  name: text("name"),
  email: text("email"),
  loginMethod: text("loginMethod"),
  role: text("role", { enum: ["user", "admin"] }).default("user").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().default(new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().default(new Date()),
  lastSignedIn: integer("lastSignedIn", { mode: "timestamp" }).notNull().default(new Date()),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ── Conversations ─────────────────────────────────────────────────────────────
export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("userId"),
  title: text("title").default("New Conversation"),
  model: text("model").default("llama3.2"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().default(new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().default(new Date()),
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

// ── Messages ──────────────────────────────────────────────────────────────────
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversationId").notNull(),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  audioUrl: text("audioUrl"),
  tokensUsed: integer("tokensUsed"),
  ragChunksUsed: text("ragChunksUsed"), // JSON as text in SQLite
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().default(new Date()),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

// ── Knowledge Chunks (scraped + embedded content) ─────────────────────────────
export const knowledgeChunks = sqliteTable("knowledge_chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceUrl: text("sourceUrl"),
  sourceTitle: text("sourceTitle"),
  sourceType: text("sourceType", { enum: ["rss", "news", "custom_url", "manual"] }).default("custom_url"),
  content: text("content").notNull(),
  summary: text("summary"),
  chromaId: text("chromaId"),
  embeddingModel: text("embeddingModel").default("nomic-embed-text"),
  tags: text("tags"), // JSON as text in SQLite
  scrapedAt: integer("scrapedAt", { mode: "timestamp" }).notNull().default(new Date()),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().default(new Date()),
});

export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type InsertKnowledgeChunk = typeof knowledgeChunks.$inferInsert;

// ── Scrape Sources ────────────────────────────────────────────────────────────
export const scrapeSources = sqliteTable("scrape_sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  type: text("type", { enum: ["rss", "news", "custom_url"] }).notNull(),
  isActive: integer("isActive", { mode: "boolean" }).default(true).notNull(),
  intervalMinutes: integer("intervalMinutes").default(60).notNull(),
  lastScrapedAt: integer("lastScrapedAt", { mode: "timestamp" }),
  lastStatus: text("lastStatus", { enum: ["pending", "success", "failed"] }).default("pending"),
  lastError: text("lastError"),
  totalChunks: integer("totalChunks").default(0),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().default(new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().default(new Date()),
});

export type ScrapeSource = typeof scrapeSources.$inferSelect;
export type InsertScrapeSource = typeof scrapeSources.$inferInsert;

// ── System Logs ───────────────────────────────────────────────────────────────
export const systemLogs = sqliteTable("system_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  level: text("level", { enum: ["debug", "info", "warn", "error"] }).default("info"),
  module: text("module").notNull(),
  message: text("message").notNull(),
  metadata: text("metadata"), // JSON as text in SQLite
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().default(new Date()),
});

export type SystemLog = typeof systemLogs.$inferSelect;
export type InsertSystemLog = typeof systemLogs.$inferInsert;

// ── Self-Improvement Patches ──────────────────────────────────────────────────
export const selfImprovementPatches = sqliteTable("self_improvement_patches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  analysisInput: text("analysisInput"),
  suggestion: text("suggestion").notNull(),
  patchDiff: text("patchDiff"),
  targetFile: text("targetFile"),
  status: text("status", { enum: ["pending", "approved", "rejected", "applied"] }).default("pending"),
  appliedAt: integer("appliedAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().default(new Date()),
});

export type SelfImprovementPatch = typeof selfImprovementPatches.$inferSelect;
export type InsertSelfImprovementPatch = typeof selfImprovementPatches.$inferInsert;
