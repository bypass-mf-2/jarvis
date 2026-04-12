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
const LOCK_PATH = DB_PATH + ".lock";
const TMP_PATH = DB_PATH + ".tmp";

let _db: SqlJsDatabase | null = null;
let _sqlJs: any = null;
let _lockAcquired = false;
let _autosaveTimer: NodeJS.Timeout | null = null;
let _shutdownHandlersRegistered = false;
let _dbDirty = false;
let _saving = false;

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

-- ── Knowledge graph ──────────────────────────────────────────────────────
-- Entity storage: every proper noun, concept, technology, organization,
-- person, and event extracted from knowledge_chunks lives here. Built
-- by the fast NER in entityExtractor.ts — no LLM required for the bulk
-- of the work.
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  normalizedName TEXT NOT NULL,
  type TEXT DEFAULT 'unknown',
  mentionCount INTEGER DEFAULT 0,
  firstSeenAt INTEGER,
  lastSeenAt INTEGER,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_normalized ON entities(normalizedName);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_mentions ON entities(mentionCount DESC);

-- Entity ↔ chunk links: which entities appear in which chunks.
-- The join table that powers "give me all chunks about Tesla".
CREATE TABLE IF NOT EXISTS entity_chunk_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entityId INTEGER NOT NULL,
  chunkId INTEGER NOT NULL,
  UNIQUE(entityId, chunkId)
);
CREATE INDEX IF NOT EXISTS idx_ecl_entityId ON entity_chunk_links(entityId);
CREATE INDEX IF NOT EXISTS idx_ecl_chunkId ON entity_chunk_links(chunkId);

-- Entity ↔ entity co-occurrence: when two entities appear in the same
-- chunk, they get a relationship. Strength = number of shared chunks.
-- This IS the knowledge graph — it's what enables multi-hop retrieval.
-- "Hitler" → co-occurs with "Nazi Party" in 47 chunks, "Weimar Republic"
-- in 12 chunks, "World War II" in 89 chunks → follow those edges to
-- expand a query about Hitler into related topics automatically.
CREATE TABLE IF NOT EXISTS entity_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entityAId INTEGER NOT NULL,
  entityBId INTEGER NOT NULL,
  strength REAL DEFAULT 1.0,
  sharedChunkCount INTEGER DEFAULT 1,
  UNIQUE(entityAId, entityBId)
);
CREATE INDEX IF NOT EXISTS idx_er_entityA ON entity_relationships(entityAId);
CREATE INDEX IF NOT EXISTS idx_er_entityB ON entity_relationships(entityBId);
CREATE INDEX IF NOT EXISTS idx_er_strength ON entity_relationships(strength DESC);

-- Track whether the entity graph has been built. The backfill processes
-- all existing chunks once; subsequent chunks get extracted incrementally.
CREATE TABLE IF NOT EXISTS entity_graph_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lastBackfillChunkId INTEGER DEFAULT 0,
  totalEntities INTEGER DEFAULT 0,
  totalRelationships INTEGER DEFAULT 0,
  lastBackfillAt INTEGER,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- ── Navigator sessions ───────────────────────────────────────────────────
-- Stored Playwright storageState blobs — cookies + localStorage from a
-- headed browser session where the user manually logged in. When a task
-- is started with sessionId, the navigator loads this state into the new
-- browser context so the agent starts already authenticated. Actual blob
-- lives on disk at nav-sessions/{id}.json — the DB row is metadata only.
CREATE TABLE IF NOT EXISTS nav_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  storagePath TEXT NOT NULL,       -- absolute path to JSON blob on disk
  origin TEXT,                      -- hostname the session was captured on (for UX hints)
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  lastUsedAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_navSessions_name ON nav_sessions(name);

-- ── Navigator audit log ──────────────────────────────────────────────────
-- Append-only record of every high-stakes confirmation. Exists so there's
-- always a provable trail of "user typed X to approve Y on Z" when the
-- Navigator touches real money or destructive actions.
CREATE TABLE IF NOT EXISTS nav_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taskId TEXT NOT NULL,
  goal TEXT NOT NULL,
  actionJson TEXT NOT NULL,
  confirmationPhrase TEXT NOT NULL,
  userProvidedText TEXT NOT NULL,
  approved INTEGER NOT NULL,        -- 1 = approved, 0 = rejected
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_navAuditLog_taskId ON nav_audit_log(taskId);

-- ── Writing samples ──────────────────────────────────────────────────────
-- Personal documents (essays, lab reports, resumes, etc.) uploaded for
-- STYLE analysis only. Distinct from knowledge_chunks: these are never
-- embedded, never retrieved by RAG, and never appear in chat context as
-- reference material. Their sole purpose is to feed the writing_profile
-- aggregator that teaches Jarvis how the user writes.
CREATE TABLE IF NOT EXISTS writing_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER DEFAULT 1,
  originalName TEXT NOT NULL,
  storedPath TEXT NOT NULL,
  category TEXT DEFAULT 'other',         -- essay, lab_report, resume, book, other
  description TEXT,                       -- user-provided context (assignment prompt, class, audience, etc.)
  rawText TEXT NOT NULL,                  -- extracted text body
  wordCount INTEGER DEFAULT 0,
  styleFeatures TEXT,                     -- JSON: per-sample style analysis from Ollama
  analyzedAt INTEGER,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_writingSamples_userId ON writing_samples(userId);
CREATE INDEX IF NOT EXISTS idx_writingSamples_category ON writing_samples(category);

-- ── Writing profile ──────────────────────────────────────────────────────
-- Single-row aggregate profile. Stores the unified "how does this user
-- write" JSON that gets injected into the chat system prompt so Jarvis
-- matches the user's voice. Regenerated whenever samples are added or
-- removed; users can also trigger a rebuild manually.
CREATE TABLE IF NOT EXISTS writing_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER UNIQUE DEFAULT 1,
  profileJson TEXT NOT NULL,              -- aggregated style JSON
  sampleCount INTEGER DEFAULT 0,
  totalWords INTEGER DEFAULT 0,
  regeneratedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

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
CREATE INDEX IF NOT EXISTS idx_knowledgeChunks_createdAt ON knowledge_chunks(createdAt);
CREATE INDEX IF NOT EXISTS idx_scrapeSources_isActive ON scrape_sources(isActive);
CREATE INDEX IF NOT EXISTS idx_scrapeSources_createdAt ON scrape_sources(createdAt);
CREATE INDEX IF NOT EXISTS idx_systemLogs_level ON system_logs(level);
CREATE INDEX IF NOT EXISTS idx_systemLogs_createdAt ON system_logs(createdAt);
`;

// ── Single-instance lock ────────────────────────────────────────────────────
// sql.js has no file locking — if two processes both writeFileSync the
// exported buffer, you get torn writes and a corrupt DB. This holds an
// exclusive lock file for the lifetime of the process.
function acquireLock(): void {
  try {
    const fd = fs.openSync(LOCK_PATH, "wx"); // exclusive create
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    _lockAcquired = true;
    return;
  } catch (err: any) {
    if (err.code !== "EEXIST") throw err;
  }

  // Lock file exists — check if the holder is still alive.
  let holderPid = 0;
  try {
    holderPid = parseInt(fs.readFileSync(LOCK_PATH, "utf8").trim(), 10) || 0;
  } catch {}

  const stale = holderPid === 0 || !isProcessAlive(holderPid);
  if (stale) {
    console.warn(
      `⚠️  Removing stale jarvis.db.lock (pid ${holderPid} is not running)`
    );
    try { fs.unlinkSync(LOCK_PATH); } catch {}
    acquireLock();
    return;
  }

  throw new Error(
    `Another JARVIS process (pid ${holderPid}) already holds ${LOCK_PATH}. ` +
      `Refusing to start a second instance — concurrent sql.js writes cause DB corruption. ` +
      `Stop the other process (or delete ${LOCK_PATH} if you're certain it's stale) and try again.`
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === "EPERM"; // exists but not ours
  }
}

function releaseLock(): void {
  if (!_lockAcquired) return;
  try { fs.unlinkSync(LOCK_PATH); } catch {}
  _lockAcquired = false;
}

function registerShutdownHandlers(): void {
  if (_shutdownHandlersRegistered) return;
  _shutdownHandlersRegistered = true;

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n🛑 ${signal} received — flushing jarvis.db…`);
    if (_autosaveTimer) { clearInterval(_autosaveTimer); _autosaveTimer = null; }
    // Use flushDatabase (unconditional) for shutdown so we always persist,
    // even if the dirty flag was somehow out of sync.
    try { flushDatabase(); } catch (e) { console.error("final save failed:", e); }
    // Save the in-memory entity graph to disk before exit.
    import("./entityExtractor.js")
      .then((m) => m.saveGraph?.())
      .catch(() => { /* module may not be loaded */ });
    // Close any Playwright browser instances launched by the Navigator.
    import("./navigator.js")
      .then((m) => m.shutdownNavigator?.())
      .catch(() => { /* module may not be loaded */ });
    releaseLock();
    console.log("✅ clean shutdown");
    // Allow other handlers to run; force-exit as a safety net.
    setTimeout(() => process.exit(0), 250).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));
  process.on("beforeExit", () => shutdown("beforeExit"));
  process.on("uncaughtException", (err) => {
    console.error("uncaughtException:", err);
    shutdown("uncaughtException");
  });
}

export async function initializeSQLiteDatabase(): Promise<SqlJsDatabase> {
  if (_db) return _db;

  try {
    // Take the single-instance lock BEFORE reading the DB file.
    acquireLock();
    registerShutdownHandlers();

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
      // Force a save after schema init — the DB was just created or
      // migrated and should be persisted immediately.
      flushDatabase();
      // Arm autosave only after a successful init with the lock held.
      startAutosave();
      console.log(`✅ SQLite database initialized at: ${DB_PATH}`);
      return _db as SqlJsDatabase;
    }
    throw new Error("Failed to create database instance");
  } catch (error) {
    console.error("❌ Failed to initialize SQLite database:", error);
    releaseLock();
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

  // writing_samples: user-provided context describing each sample
  ensureColumn("writing_samples", "description", "TEXT");
}

export function getDatabase(): SqlJsDatabase {
  if (!_db) {
    throw new Error("Database not initialized. Call initializeSQLiteDatabase() first.");
  }
  return _db as SqlJsDatabase;
}

// Mark the in-memory DB as dirty so the next autosave tick (or explicit
// flushDatabase call) persists it. Writes from db.ts / db-sqlite.ts /
// autoTrain.ts / etc. should call this instead of saveDatabase so the
// full-DB export + rename only happens on a timer, not on every single
// INSERT. Previously, save-on-every-write was causing 200+ full-DB
// rewrites per second during active scraping and triggering Windows
// EPERM on rename under contention.
export function markDbDirty(): void {
  _dbDirty = true;
}

// Save only if dirty. Called by the autosave interval. Cheap no-op when
// nothing has changed. Use flushDatabase() when you need to force a write
// (shutdown, post-init seed).
export function saveDatabase(): void {
  if (!_dbDirty) return;
  flushDatabase();
}

// Unconditional save. Use this from shutdown handlers and post-init flush
// where you don't care about the dirty flag.
export function flushDatabase(): void {
  if (!_db) return;
  if (!_lockAcquired) {
    // Never write without the lock — prevents a second process from
    // corrupting the file if it somehow reached flushDatabase.
    console.warn("⚠️  flushDatabase called without lock — skipping write");
    return;
  }
  if (_saving) {
    // A previous save is mid-flight. The dirty flag stays set so the next
    // tick picks up whatever changed since. Don't stack synchronous saves.
    return;
  }
  _saving = true;
  try {
    const data = _db.export();
    const buffer = Buffer.from(data);
    // Atomic write: write to a temp file then rename. On Unix, rename()
    // overwrites atomically. On Windows, rename() fails with EPERM when
    // the destination is open by anything else (antivirus scan, another
    // Node module holding a read handle, File Explorer preview). Retry
    // with exponential backoff — transient locks usually release within
    // 50-500 ms. The dirty flag is cleared only after a successful write.
    fs.writeFileSync(TMP_PATH, buffer);
    renameWithRetry(TMP_PATH, DB_PATH);
    _dbDirty = false;
  } catch (error) {
    console.error("❌ Failed to save database:", error);
    try { fs.unlinkSync(TMP_PATH); } catch {}
    // Leave _dbDirty set so the next tick retries the write.
  } finally {
    _saving = false;
  }
}

// Windows-aware atomic rename. On Windows, fs.renameSync can throw EPERM,
// EBUSY, EACCES, or UNKNOWN when the target file is momentarily locked by
// another process (commonly antivirus or file indexers). All of these are
// transient — retrying with a short backoff almost always succeeds.
function renameWithRetry(src: string, dest: string): void {
  const transientCodes = new Set(["EPERM", "EBUSY", "EACCES", "UNKNOWN", "ENOENT"]);
  const backoffsMs = [25, 75, 200, 500, 1000, 1500];
  let lastErr: any = null;

  for (let attempt = 0; attempt <= backoffsMs.length; attempt++) {
    try {
      fs.renameSync(src, dest);
      return;
    } catch (err: any) {
      lastErr = err;
      if (!transientCodes.has(err?.code) || attempt === backoffsMs.length) {
        throw err;
      }
      // Sync sleep: we're on the hot save path and can't easily await.
      // This runs on the autosave tick which is off the user-chat path.
      const wait = backoffsMs[attempt];
      const end = Date.now() + wait;
      while (Date.now() < end) { /* busy-wait */ }
    }
  }
  throw lastErr;
}

export function getDatabasePath(): string {
  return DB_PATH;
}

// Auto-save on interval — only arm once initialize has actually run.
export function startAutosave(): void {
  if (_autosaveTimer) return;
  _autosaveTimer = setInterval(() => {
    if (_db) saveDatabase();
  }, 30000); // Save every 30 seconds
}
