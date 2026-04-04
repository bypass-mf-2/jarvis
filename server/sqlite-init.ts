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
