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


// ─── v2.0 Autonomous Features ───────────────────────────────────────────────────
export const autonomyConfig = mysqlTable("autonomy_config", {
  id: serial("id").primaryKey(),
  autonomyLevel: int("autonomy_level").notNull().default(1),
  maxPatchesPerHour: int("max_patches_per_hour").notNull().default(3),
  enabledCategories: json("enabled_categories").notNull().default("[]"),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const sourceMetrics = mysqlTable("source_metrics", {
  id: serial("id").primaryKey(),
  sourceId: int("source_id").notNull(),
  qualityScore: decimal("quality_score", { precision: 3, scale: 2 }),
  avgChunkLength: int("avg_chunk_length"),
  errorRate: decimal("error_rate", { precision: 3, scale: 2 }),
  lastEvaluated: timestamp("last_evaluated").defaultNow(),
});

export const agentMetrics = mysqlTable("agent_metrics", {
  id: serial("id").primaryKey(),
  agentName: varchar("agent_name", { length: 50 }).notNull().unique(),
  totalCalls: int("total_calls").notNull().default(0),
  avgConfidence: decimal("avg_confidence", { precision: 3, scale: 2 }),
  avgResponseTime: int("avg_response_time"),
  errorRate: decimal("error_rate", { precision: 3, scale: 2 }),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// ─── Persistent Memory Tables ───────────────────────────────────────────────

export const learnedFacts = mysqlTable("learned_facts", {
  id: int("id").autoincrement().primaryKey(),
  category: mysqlEnum("category", [
    "personal", "preferences", "knowledge", "goals", 
    "relationships", "experiences", "skills"
  ]).notNull(),
  fact: text("fact").notNull(),
  confidence: decimal("confidence", { precision: 3, scale: 2 }).notNull(),
  sourceConversationId: int("sourceConversationId"),
  verified: boolean("verified").default(false),
  timesReferenced: int("timesReferenced").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const entityMemory = mysqlTable("entity_memory", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  type: mysqlEnum("type", ["person", "place", "organization", "concept", "event", "object"]).notNull(),
  description: text("description"),
  attributes: json("attributes"),
  relationships: json("relationships"),
  firstMentioned: timestamp("firstMentioned").defaultNow(),
  lastMentioned: timestamp("lastMentioned").defaultNow(),
  mentionCount: int("mentionCount").default(1),
  importance: decimal("importance", { precision: 3, scale: 2 }).default("0.50"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const conversationContext = mysqlTable("conversation_context", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  topicSummary: text("topicSummary"),
  extractedFacts: json("extractedFacts"),
  entities: json("entities"),
  sentiment: mysqlEnum("sentiment", ["positive", "neutral", "negative"]),
  keyTopics: json("keyTopics"),
  followUpNeeded: boolean("followUpNeeded").default(false),
  followUpTopic: text("followUpTopic"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const fileUploads = mysqlTable("file_uploads", {
  id: int("id").autoincrement().primaryKey(),
  filename: varchar("filename", { length: 512 }).notNull(),
  originalPath: varchar("originalPath", { length: 1024 }).notNull(),
  fileType: varchar("fileType", { length: 64 }).notNull(),
  fileSize: int("fileSize").notNull(),
  processed: boolean("processed").default(false),
  processingStatus: mysqlEnum("processingStatus", ["pending", "processing", "complete", "error"]).default("pending"),
  chunksExtracted: int("chunksExtracted").default(0),
  metadata: json("metadata"),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
  processedAt: timestamp("processedAt"),
});

export const llmSettings = mysqlTable("llm_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  settingName: varchar("settingName", { length: 128 }).notNull(),
  settingValue: text("settingValue").notNull(),
  settingType: mysqlEnum("settingType", ["string", "number", "boolean", "json"]).notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const learningSessions = mysqlTable("learning_sessions", {
  id: int("id").autoincrement().primaryKey(),
  sessionType: mysqlEnum("sessionType", [
    "conversation_analysis", "file_processing", "web_scraping", 
    "voice_analysis", "self_improvement"
  ]).notNull(),
  itemsProcessed: int("itemsProcessed").default(0),
  factsLearned: int("factsLearned").default(0),
  entitiesDiscovered: int("entitiesDiscovered").default(0),
  duration: int("duration"),
  status: mysqlEnum("status", ["success", "partial", "error"]).default("success"),
  notes: text("notes"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

// Add to existing messages table:
export const messages = mysqlTable("messages", {
  // ... existing fields
  userRating: int("userRating"), // ADD THIS
});

// Add new tables:
export const trainingExamples = mysqlTable("training_examples", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId"),
  instruction: text("instruction").notNull(),
  output: text("output").notNull(),
  rating: int("rating").notNull(),
  category: mysqlEnum("category", ["ios", "web", "data", "general"]).default("general"),
  usedInTraining: boolean("usedInTraining").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const modelVersions = mysqlTable("model_versions", {
  id: int("id").autoincrement().primaryKey(),
  modelName: varchar("modelName", { length: 255 }).notNull(),
  baseModel: varchar("baseModel", { length: 255 }).notNull(),
  specialty: mysqlEnum("specialty", ["ios", "web", "data", "general"]).default("general"),
  trainingExamples: int("trainingExamples").default(0),
  status: mysqlEnum("status", ["training", "trained", "deployed", "archived"]).default("training"),
  performanceScore: decimal("performanceScore", { precision: 3, scale: 2 }),
  abTestWins: int("abTestWins").default(0),
  abTestLosses: int("abTestLosses").default(0),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deployedAt: timestamp("deployedAt"),
});