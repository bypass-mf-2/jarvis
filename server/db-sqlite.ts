/**
 * SQLite Database Adapter using sql.js
 * Pure JavaScript implementation - no native bindings
 */

import { getDatabase, markDbDirty } from "./sqlite-init";

function isReadOnlySql(sql: string): boolean {
  const trimmed = sql.trimStart().toUpperCase();
  return trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA") || trimmed.startsWith("EXPLAIN");
}
import type { Database as SqlJsDatabase } from "sql.js";
import {
  users,
  conversations,
  messages,
  knowledgeChunks,
  scrapeSources,
  systemLogs,
  selfImprovementPatches,
} from "../drizzle/schema-sqlite";
import type {
  InsertUser,
  InsertConversation,
  InsertMessage,
  InsertKnowledgeChunk,
  InsertScrapeSource,
  InsertSystemLog,
  InsertSelfImprovementPatch,
  Conversation,
  Message,
  KnowledgeChunk,
  ScrapeSource,
  SystemLog,
  SelfImprovementPatch,
  User,
} from "../drizzle/schema-sqlite";

// Helper to run SQL queries
function runQuery(sql: string, params: any[] = []): any[] {
  const db = getDatabase();
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    if (!isReadOnlySql(sql)) markDbDirty();
    return results;
  } catch (error) {
    console.error("[DB] Query error:", sql, error);
    throw error;
  }
}

function runInsert(sql: string, params: any[] = []): number {
  const db = getDatabase();
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
    markDbDirty();
    return db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] as number ?? 1;
  } catch (error) {
    console.error("[DB] Insert error:", sql, error);
    throw error;
  }
}

// ── Users ──────────────────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const existing = runQuery("SELECT id FROM users WHERE openId = ?", [user.openId]);

  if (existing.length > 0) {
    const updates: string[] = [];
    const values: any[] = [];

    if (user.name !== undefined) {
      updates.push("name = ?");
      values.push(user.name);
    }
    if (user.email !== undefined) {
      updates.push("email = ?");
      values.push(user.email);
    }
    if (user.loginMethod !== undefined) {
      updates.push("loginMethod = ?");
      values.push(user.loginMethod);
    }
    updates.push("lastSignedIn = ?");
    values.push(user.lastSignedIn?.getTime() ?? Date.now());
    values.push(user.openId);

    if (updates.length > 0) {
      runQuery(`UPDATE users SET ${updates.join(", ")} WHERE openId = ?`, values);
    }
  } else {
    runInsert(
      "INSERT INTO users (openId, name, email, loginMethod, role, createdAt, updatedAt, lastSignedIn) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        user.openId,
        user.name ?? null,
        user.email ?? null,
        user.loginMethod ?? null,
        user.role ?? "user",
        Date.now(),
        Date.now(),
        user.lastSignedIn?.getTime() ?? Date.now(),
      ]
    );
  }
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const result = runQuery("SELECT * FROM users WHERE openId = ? LIMIT 1", [openId]);
  return result[0] as User | undefined;
}

// ── Conversations ──────────────────────────────────────────────────────────────
export async function createConversation(conv: InsertConversation): Promise<Conversation> {
  const id = runInsert(
    "INSERT INTO conversations (userId, title, model, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
    [conv.userId ?? null, conv.title ?? "New Conversation", conv.model ?? "llama3.2", Date.now(), Date.now()]
  );
  return { id, ...conv, createdAt: new Date(), updatedAt: new Date() } as Conversation;
}

export async function getConversations(userId?: number): Promise<Conversation[]> {
  if (userId) {
    return runQuery("SELECT * FROM conversations WHERE userId = ? OR userId IS NULL ORDER BY updatedAt DESC", [userId]) as Conversation[];
  }
  return runQuery("SELECT * FROM conversations ORDER BY updatedAt DESC") as Conversation[];
}

export async function getConversation(id: number): Promise<Conversation | undefined> {
  const result = runQuery("SELECT * FROM conversations WHERE id = ? LIMIT 1", [id]);
  return result[0] as Conversation | undefined;
}

export async function getConversationById(id: number): Promise<Conversation | undefined> {
  return getConversation(id);
}

export async function updateConversation(id: number, updates: Partial<InsertConversation>): Promise<void> {
  const setters: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    setters.push("title = ?");
    values.push(updates.title);
  }
  if (updates.model !== undefined) {
    setters.push("model = ?");
    values.push(updates.model);
  }
  setters.push("updatedAt = ?");
  values.push(Date.now());
  values.push(id);

  if (setters.length > 0) {
    runQuery(`UPDATE conversations SET ${setters.join(", ")} WHERE id = ?`, values);
  }
}

export async function updateConversationTitle(id: number, title: string): Promise<void> {
  runQuery("UPDATE conversations SET title = ?, updatedAt = ? WHERE id = ?", [title, Date.now(), id]);
}

export async function deleteConversation(id: number): Promise<void> {
  runQuery("DELETE FROM conversations WHERE id = ?", [id]);
}

// ── Messages ───────────────────────────────────────────────────────────────────
export async function addMessage(msg: InsertMessage): Promise<Message> {
  const id = runInsert(
    "INSERT INTO messages (conversationId, role, content, audioUrl, tokensUsed, ragChunksUsed, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      msg.conversationId,
      msg.role,
      msg.content,
      msg.audioUrl ?? null,
      msg.tokensUsed ?? null,
      msg.ragChunksUsed ? JSON.stringify(msg.ragChunksUsed) : null,
      Date.now(),
    ]
  );
  return { id, ...msg, createdAt: new Date() } as Message;
}

export async function getMessages(conversationId: number, limit?: number): Promise<Message[]> {
  if (limit) {
    return runQuery("SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC LIMIT ?", [conversationId, limit]) as Message[];
  }
  return runQuery("SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC", [conversationId]) as Message[];
}

export async function deleteMessages(conversationId: number): Promise<void> {
  runQuery("DELETE FROM messages WHERE conversationId = ?", [conversationId]);
}

// ── Knowledge Chunks ───────────────────────────────────────────────────────────
export async function addKnowledgeChunk(chunk: InsertKnowledgeChunk): Promise<KnowledgeChunk> {
  const id = runInsert(
    "INSERT INTO knowledge_chunks (sourceUrl, sourceTitle, sourceType, content, summary, chromaId, embeddingModel, tags, scrapedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      chunk.sourceUrl ?? null,
      chunk.sourceTitle ?? null,
      chunk.sourceType ?? "custom_url",
      chunk.content,
      chunk.summary ?? null,
      chunk.chromaId ?? null,
      chunk.embeddingModel ?? "nomic-embed-text",
      chunk.tags ? JSON.stringify(chunk.tags) : null,
      chunk.scrapedAt?.getTime() ?? Date.now(),
      Date.now(),
    ]
  );
  return { id, ...chunk, scrapedAt: new Date(), createdAt: new Date() } as KnowledgeChunk;
}

export async function getKnowledgeChunks(limit: number = 100, offset: number = 0): Promise<KnowledgeChunk[]> {
  return runQuery("SELECT * FROM knowledge_chunks ORDER BY createdAt DESC LIMIT ? OFFSET ?", [limit, offset]) as KnowledgeChunk[];
}

export async function getKnowledgeChunkCount(): Promise<number> {
  const result = runQuery("SELECT COUNT(*) as count FROM knowledge_chunks");
  return (result[0]?.count as number) ?? 0;
}

export async function countKnowledgeChunks(): Promise<number> {
  return getKnowledgeChunkCount();
}

export async function deleteKnowledgeChunk(id: number): Promise<void> {
  runQuery("DELETE FROM knowledge_chunks WHERE id = ?", [id]);
}

// ── Scrape Sources ─────────────────────────────────────────────────────────────
export async function addScrapeSource(source: InsertScrapeSource): Promise<ScrapeSource> {
  const id = runInsert(
    "INSERT INTO scrape_sources (name, url, type, isActive, intervalMinutes, lastStatus, totalChunks, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      source.name,
      source.url,
      source.type,
      source.isActive ? 1 : 0,
      source.intervalMinutes ?? 60,
      source.lastStatus ?? "pending",
      source.totalChunks ?? 0,
      Date.now(),
      Date.now(),
    ]
  );
  return { id, ...source, createdAt: new Date(), updatedAt: new Date() } as ScrapeSource;
}

export async function getScrapeSources(): Promise<ScrapeSource[]> {
  return runQuery("SELECT * FROM scrape_sources ORDER BY updatedAt DESC") as ScrapeSource[];
}

export async function getActiveScrapeSource(): Promise<ScrapeSource[]> {
  return runQuery("SELECT * FROM scrape_sources WHERE isActive = 1") as ScrapeSource[];
}

export async function updateScrapeSource(id: number, updates: Partial<InsertScrapeSource>): Promise<void> {
  const setters: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    setters.push("name = ?");
    values.push(updates.name);
  }
  if (updates.url !== undefined) {
    setters.push("url = ?");
    values.push(updates.url);
  }
  if (updates.type !== undefined) {
    setters.push("type = ?");
    values.push(updates.type);
  }
  if (updates.isActive !== undefined) {
    setters.push("isActive = ?");
    values.push(updates.isActive ? 1 : 0);
  }
  if (updates.lastStatus !== undefined) {
    setters.push("lastStatus = ?");
    values.push(updates.lastStatus);
  }
  if (updates.totalChunks !== undefined) {
    setters.push("totalChunks = ?");
    values.push(updates.totalChunks);
  }
  setters.push("updatedAt = ?");
  values.push(Date.now());
  values.push(id);

  if (setters.length > 0) {
    runQuery(`UPDATE scrape_sources SET ${setters.join(", ")} WHERE id = ?`, values);
  }
}

export async function deleteScrapeSource(id: number): Promise<void> {
  runQuery("DELETE FROM scrape_sources WHERE id = ?", [id]);
}

export async function toggleScrapeSource(id: number, isActive: boolean): Promise<void> {
  runQuery("UPDATE scrape_sources SET isActive = ? WHERE id = ?", [isActive ? 1 : 0, id]);
}

export async function updateScrapeSourceStatus(id: number, status: string, error?: string, totalChunks?: number): Promise<void> {
  const updates: string[] = [];
  const values: any[] = [];
  
  updates.push("lastStatus = ?");
  values.push(status);
  
  if (error !== undefined) {
    updates.push("lastError = ?");
    values.push(error);
  }
  
  if (totalChunks !== undefined) {
    updates.push("totalChunks = ?");
    values.push(totalChunks);
  }
  
  updates.push("updatedAt = ?");
  values.push(Date.now());
  values.push(id);
  
  runQuery(`UPDATE scrape_sources SET ${updates.join(", ")} WHERE id = ?`, values);
}

// ── System Logs ────────────────────────────────────────────────────────────────
export async function addSystemLog(log: InsertSystemLog): Promise<SystemLog> {
  const id = runInsert(
    "INSERT INTO system_logs (level, module, message, metadata, createdAt) VALUES (?, ?, ?, ?, ?)",
    [log.level ?? "info", log.module, log.message, log.metadata ? JSON.stringify(log.metadata) : null, Date.now()]
  );
  return { id, ...log, createdAt: new Date() } as SystemLog;
}

export async function getSystemLogs(limit: number = 100): Promise<SystemLog[]> {
  return runQuery("SELECT * FROM system_logs ORDER BY createdAt DESC LIMIT ?", [limit]) as SystemLog[];
}

export async function deleteOldLogs(beforeDays: number = 7): Promise<void> {
  const cutoffTime = Date.now() - beforeDays * 24 * 60 * 60 * 1000;
  runQuery("DELETE FROM system_logs WHERE createdAt < ?", [cutoffTime]);
}

// ── Self-Improvement Patches ───────────────────────────────────────────────────
export async function addSelfImprovementPatch(patch: InsertSelfImprovementPatch): Promise<SelfImprovementPatch> {
  const id = runInsert(
    "INSERT INTO self_improvement_patches (analysisInput, suggestion, patchDiff, targetFile, status, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
    [patch.analysisInput ?? null, patch.suggestion, patch.patchDiff ?? null, patch.targetFile ?? null, patch.status ?? "pending", Date.now()]
  );
  return { id, ...patch, createdAt: new Date() } as SelfImprovementPatch;
}

export async function getPendingPatches(): Promise<SelfImprovementPatch[]> {
  return runQuery("SELECT * FROM self_improvement_patches WHERE status = 'pending'") as SelfImprovementPatch[];
}

export async function getAllPatches(): Promise<SelfImprovementPatch[]> {
  return runQuery("SELECT * FROM self_improvement_patches ORDER BY createdAt DESC") as SelfImprovementPatch[];
}

export async function getPatches(limit: number = 20): Promise<SelfImprovementPatch[]> {
  return runQuery("SELECT * FROM self_improvement_patches ORDER BY createdAt DESC LIMIT ?", [limit]) as SelfImprovementPatch[];
}

export async function updatePatchStatus(id: number, status: "pending" | "approved" | "rejected" | "applied"): Promise<void> {
  runQuery("UPDATE self_improvement_patches SET status = ? WHERE id = ?", [status, id]);
}

export async function updatePatchApplied(id: number): Promise<void> {
  runQuery("UPDATE self_improvement_patches SET status = 'applied', appliedAt = ? WHERE id = ?", [Date.now(), id]);
}
