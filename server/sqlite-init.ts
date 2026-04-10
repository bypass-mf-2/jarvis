/**
 * SQLite Database Initialization using sql.js
 * Pure JavaScript SQLite - no native bindings required
 */

import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "jarvis.db");

let _db: SqlJsDatabase | null = null;
let _sqlJs: any = null;

const SCHEMA_SQL = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openId TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  loginMethod TEXT,
  role TEXT DEFAULT 'user' NOT NULL,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  lastSignedIn INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  title TEXT DEFAULT 'New Conversation',
  model TEXT DEFAULT 'llama3.2',
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversationId INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  audioUrl TEXT,
  tokensUsed INTEGER,
  ragChunksUsed TEXT,
  userRating INTEGER,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Knowledge chunks table
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sourceUrl TEXT,
  sourceTitle TEXT,
  sourceType TEXT DEFAULT 'custom_url',
  content TEXT NOT NULL,
  summary TEXT,
  chromaId TEXT,
  embeddingModel TEXT DEFAULT 'nomic-embed-text',
  tags TEXT,
  scrapedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Scrape sources table
CREATE TABLE IF NOT EXISTS scrape_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL,
  isActive INTEGER DEFAULT 1 NOT NULL,
  intervalMinutes INTEGER DEFAULT 60 NOT NULL,
  lastScrapedAt INTEGER,
  lastStatus TEXT DEFAULT 'pending',
  lastError TEXT,
  totalChunks INTEGER DEFAULT 0,
  consecutiveZeroScrapes INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- System logs table
CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT DEFAULT 'info',
  module TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Self-improvement patches table
CREATE TABLE IF NOT EXISTS self_improvement_patches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysisInput TEXT,
  suggestion TEXT NOT NULL,
  patchDiff TEXT,
  targetFile TEXT,
  status TEXT DEFAULT 'pending',
  appliedAt INTEGER,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Autonomy config table
CREATE TABLE IF NOT EXISTS autonomy_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  autonomy_level INTEGER NOT NULL DEFAULT 1,
  max_patches_per_hour INTEGER NOT NULL DEFAULT 3,
  enabled_categories TEXT NOT NULL DEFAULT '[]',
  updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Agent metrics table
CREATE TABLE IF NOT EXISTS agent_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name TEXT NOT NULL UNIQUE,
  total_calls INTEGER NOT NULL DEFAULT 0,
  avg_confidence TEXT,
  avg_response_time INTEGER,
  error_rate TEXT,
  updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Learned facts table
CREATE TABLE IF NOT EXISTS learned_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  fact TEXT NOT NULL,
  confidence TEXT NOT NULL,
  sourceConversationId INTEGER,
  verified INTEGER DEFAULT 0,
  timesReferenced INTEGER DEFAULT 0,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Entity memory table
CREATE TABLE IF NOT EXISTS entity_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  attributes TEXT,
  relationships TEXT,
  firstMentioned INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  lastMentioned INTEGER DEFAULT (strftime('%s', 'now') * 1000),
  mentionCount INTEGER DEFAULT 1,
  importance TEXT DEFAULT '0.50',
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Conversation context table
CREATE TABLE IF NOT EXISTS conversation_context (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversationId INTEGER NOT NULL,
  topicSummary TEXT,
  extractedFacts TEXT,
  entities TEXT,
  sentiment TEXT,
  keyTopics TEXT,
  followUpNeeded INTEGER DEFAULT 0,
  followUpTopic TEXT,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- File uploads table
CREATE TABLE IF NOT EXISTS file_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  originalPath TEXT NOT NULL,
  fileType TEXT NOT NULL,
  fileSize INTEGER NOT NULL,
  processed INTEGER DEFAULT 0,
  processingStatus TEXT DEFAULT 'pending',
  chunksExtracted INTEGER DEFAULT 0,
  metadata TEXT,
  uploadedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  processedAt INTEGER
);

-- LLM settings table
CREATE TABLE IF NOT EXISTS llm_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  settingName TEXT NOT NULL,
  settingValue TEXT NOT NULL,
  settingType TEXT NOT NULL,
  description TEXT,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Learning sessions table
CREATE TABLE IF NOT EXISTS learning_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionType TEXT NOT NULL,
  itemsProcessed INTEGER DEFAULT 0,
  factsLearned INTEGER DEFAULT 0,
  entitiesDiscovered INTEGER DEFAULT 0,
  duration INTEGER,
  status TEXT DEFAULT 'success',
  notes TEXT,
  startedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  completedAt INTEGER
);

-- Training examples table
CREATE TABLE IF NOT EXISTS training_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversationId INTEGER,
  chunkId INTEGER,
  source TEXT DEFAULT 'chat',
  instruction TEXT NOT NULL,
  output TEXT NOT NULL,
  rating INTEGER NOT NULL,
  category TEXT DEFAULT 'general',
  usedInTraining INTEGER DEFAULT 0,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Model versions table
CREATE TABLE IF NOT EXISTS model_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modelName TEXT NOT NULL,
  baseModel TEXT NOT NULL,
  specialty TEXT DEFAULT 'general',
  trainingExamples INTEGER DEFAULT 0,
  status TEXT DEFAULT 'training',
  performanceScore TEXT,
  abTestWins INTEGER DEFAULT 0,
  abTestLosses INTEGER DEFAULT 0,
  notes TEXT,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  deployedAt INTEGER
);

-- Source metrics table
CREATE TABLE IF NOT EXISTS source_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  quality_score TEXT,
  avg_chunk_length INTEGER,
  error_rate TEXT,
  last_evaluated INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

-- Crawl frontier: persistent URL queue for web crawling
CREATE TABLE IF NOT EXISTS crawl_frontier (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  depth INTEGER DEFAULT 0,
  priority REAL DEFAULT 0.5,
  status TEXT DEFAULT 'pending',
  discoveredFrom TEXT,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  scrapedAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_crawlFrontier_status ON crawl_frontier(status);
CREATE INDEX IF NOT EXISTS idx_crawlFrontier_domain ON crawl_frontier(domain);
CREATE INDEX IF NOT EXISTS idx_crawlFrontier_priority ON crawl_frontier(priority);

-- Topic rotation: track which topics have been searched
CREATE TABLE IF NOT EXISTS crawl_topics_used (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  searchedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_crawlTopicsUsed_topic ON crawl_topics_used(topic);

-- Domain scores: track which domains produce useful content
CREATE TABLE IF NOT EXISTS domain_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  pages_scraped INTEGER DEFAULT 0,
  chunks_stored INTEGER DEFAULT 0,
  chunks_retrieved INTEGER DEFAULT 0,
  avg_rating REAL DEFAULT 0,
  quality_score REAL DEFAULT 0.5,
  last_scraped_at INTEGER,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_domainScores_quality ON domain_scores(quality_score);

-- Chunk retrieval tracking: which chunks are actually used by RAG
CREATE TABLE IF NOT EXISTS chunk_retrievals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunkId INTEGER NOT NULL,
  messageId INTEGER,
  userRating INTEGER,
  retrievedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_chunkRetrievals_chunkId ON chunk_retrievals(chunkId);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_conversations_userId ON conversations(userId);
CREATE INDEX IF NOT EXISTS idx_messages_conversationId ON messages(conversationId);
CREATE INDEX IF NOT EXISTS idx_knowledgeChunks_sourceUrl ON knowledge_chunks(sourceUrl);
CREATE INDEX IF NOT EXISTS idx_scrapeSources_isActive ON scrape_sources(isActive);
CREATE INDEX IF NOT EXISTS idx_systemLogs_level ON system_logs(level);
CREATE INDEX IF NOT EXISTS idx_systemLogs_createdAt ON system_logs(createdAt);
`;

export async function initializeSQLiteDatabase(): Promise<SqlJsDatabase> {
  if (_db) return _db;

  try {
    // Initialize sql.js
    _sqlJs = await initSqlJs();

    // Load existing database or create new one
    let data: Buffer | undefined;
    if (fs.existsSync(DB_PATH)) {
      data = fs.readFileSync(DB_PATH);
    }

    _db = new _sqlJs.Database(data);

    // Initialize schema
    if (_db) {
      _db.run(SCHEMA_SQL);
      runPendingMigrations(_db);
      // Save to disk
      saveDatabase();
      console.log(`✅ SQLite database initialized at: ${DB_PATH}`);
      return _db as SqlJsDatabase;
    }
    throw new Error("Failed to create database instance");
  } catch (error) {
    console.error("❌ Failed to initialize SQLite database:", error);
    throw error;
  }
}

// ── Idempotent migrations ───────────────────────────────────────────────────
// SQLite doesn't support "ALTER TABLE ADD COLUMN IF NOT EXISTS", so we
// inspect PRAGMA table_info and add only missing columns.
function runPendingMigrations(db: SqlJsDatabase): void {
  const ensureColumn = (table: string, column: string, definition: string) => {
    const existing = db.exec(`PRAGMA table_info(${table})`);
    const cols = existing[0]?.values.map((row: any[]) => row[1] as string) ?? [];
    if (!cols.includes(column)) {
      try {
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`📦 migration: added ${table}.${column}`);
      } catch (err) {
        console.warn(`⚠️  migration skipped for ${table}.${column}:`, err);
      }
    }
  };

  // training_examples: track origin + which chunk the example was derived from
  ensureColumn("training_examples", "chunkId", "INTEGER");
  ensureColumn("training_examples", "source", "TEXT DEFAULT 'chat'");

  // scrape_sources: track consecutive failed scrapes for auto-disable
  ensureColumn("scrape_sources", "consecutiveZeroScrapes", "INTEGER NOT NULL DEFAULT 0");
}

export function getDatabase(): SqlJsDatabase {
  if (!_db) {
    throw new Error("Database not initialized. Call initializeSQLiteDatabase() first.");
  }
  return _db as SqlJsDatabase;
}

export function saveDatabase(): void {
  if (!_db) return;
  try {
    const data = _db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (error) {
    console.error("❌ Failed to save database:", error);
  }
}

export function getDatabasePath(): string {
  return DB_PATH;
}

// Auto-save on interval
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    if (_db) saveDatabase();
  }, 30000); // Save every 30 seconds
}
