/**
 * Database bridge — automatically uses MySQL (Manus) or SQLite (localhost).
 * All other modules import from this file. The bridge checks DATABASE_URL:
 *   - If set → use Drizzle + MySQL (Manus sandbox)
 *   - If not  → use sql.js SQLite (local Windows)
 */

import { getDatabase, saveDatabase } from "./sqlite-init";

// ── Detect mode ──────────────────────────────────────────────────────────────
const USE_MYSQL = !!process.env.DATABASE_URL;

// ── MySQL (Drizzle) lazy imports ─────────────────────────────────────────────
let _drizzleDb: any = null;
let _drizzleMod: any = null;
let _schemaMod: any = null;

async function getMysqlDb() {
  if (!_drizzleDb) {
    _drizzleMod = await import("drizzle-orm");
    _schemaMod = await import("../drizzle/schema");
    const { drizzle } = await import("drizzle-orm/mysql2");
    _drizzleDb = drizzle(process.env.DATABASE_URL!);
  }
  return { db: _drizzleDb, orm: _drizzleMod, schema: _schemaMod };
}

// ── SQLite helpers ───────────────────────────────────────────────────────────
function sqliteRun(sql: string, params: any[] = []): any[] {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results: any[] = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  saveDatabase();
  return results;
}

function sqliteInsert(sql: string, params: any[] = []): number {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  saveDatabase();
  return (db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] as number) ?? 1;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API — every function works in both MySQL and SQLite mode
// ═══════════════════════════════════════════════════════════════════════════════

// ── Users ────────────────────────────────────────────────────────────────────
export async function upsertUser(user: any): Promise<void> {
  if (!user.openId) throw new Error("User openId is required");
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    const values: any = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    for (const f of ["name", "email", "loginMethod"] as const) {
      if (user[f] !== undefined) { values[f] = user[f] ?? null; updateSet[f] = user[f] ?? null; }
    }
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(schema.users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } else {
    const existing = sqliteRun("SELECT id FROM users WHERE openId = ?", [user.openId]);
    if (existing.length > 0) {
      const updates: string[] = [];
      const values: any[] = [];
      if (user.name !== undefined) { updates.push("name = ?"); values.push(user.name); }
      if (user.email !== undefined) { updates.push("email = ?"); values.push(user.email); }
      if (user.loginMethod !== undefined) { updates.push("loginMethod = ?"); values.push(user.loginMethod); }
      updates.push("lastSignedIn = ?"); values.push(user.lastSignedIn?.getTime?.() ?? Date.now());
      values.push(user.openId);
      if (updates.length > 0) sqliteRun(`UPDATE users SET ${updates.join(", ")} WHERE openId = ?`, values);
    } else {
      sqliteInsert(
        "INSERT INTO users (openId, name, email, loginMethod, role, createdAt, updatedAt, lastSignedIn) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [user.openId, user.name ?? null, user.email ?? null, user.loginMethod ?? null, user.role ?? "user", Date.now(), Date.now(), user.lastSignedIn?.getTime?.() ?? Date.now()]
      );
    }
  }
}

export async function getUserByOpenId(openId: string) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    const rows = await db.select().from(schema.users).where(orm.eq(schema.users.openId, openId)).limit(1);
    return rows[0];
  }
  const rows = sqliteRun("SELECT * FROM users WHERE openId = ? LIMIT 1", [openId]);
  return rows[0];
}

// ── Conversations ────────────────────────────────────────────────────────────
export async function createConversation(data: any) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    const result = await db.insert(schema.conversations).values(data);
    const id = (result as any)[0]?.insertId as number;
    const rows = await db.select().from(schema.conversations).where(orm.eq(schema.conversations.id, id)).limit(1);
    return rows[0];
  }
  const id = sqliteInsert(
    "INSERT INTO conversations (userId, title, model, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
    [data.userId ?? null, data.title ?? "New Conversation", data.model ?? "llama3.2", Date.now(), Date.now()]
  );
  return { id, userId: data.userId, title: data.title ?? "New Conversation", model: data.model ?? "llama3.2", createdAt: Date.now(), updatedAt: Date.now() };
}

export async function getConversations(userId?: number) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    if (userId) return db.select().from(schema.conversations).where(orm.eq(schema.conversations.userId, userId)).orderBy(orm.desc(schema.conversations.updatedAt)).limit(50);
    return db.select().from(schema.conversations).orderBy(orm.desc(schema.conversations.updatedAt)).limit(50);
  }
  if (userId) return sqliteRun("SELECT * FROM conversations WHERE userId = ? ORDER BY updatedAt DESC LIMIT 50", [userId]);
  return sqliteRun("SELECT * FROM conversations ORDER BY updatedAt DESC LIMIT 50");
}

export async function getConversationById(id: number) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    const rows = await db.select().from(schema.conversations).where(orm.eq(schema.conversations.id, id)).limit(1);
    return rows[0];
  }
  const rows = sqliteRun("SELECT * FROM conversations WHERE id = ? LIMIT 1", [id]);
  return rows[0];
}

export async function updateConversationTitle(id: number, title: string) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    await db.update(schema.conversations).set({ title }).where(orm.eq(schema.conversations.id, id));
    return;
  }
  sqliteRun("UPDATE conversations SET title = ?, updatedAt = ? WHERE id = ?", [title, Date.now(), id]);
}

export async function deleteConversation(id: number) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    await db.delete(schema.messages).where(orm.eq(schema.messages.conversationId, id));
    await db.delete(schema.conversations).where(orm.eq(schema.conversations.id, id));
    return;
  }
  sqliteRun("DELETE FROM messages WHERE conversationId = ?", [id]);
  sqliteRun("DELETE FROM conversations WHERE id = ?", [id]);
}

// ── Messages ─────────────────────────────────────────────────────────────────
export async function addMessage(data: any) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    const result = await db.insert(schema.messages).values(data);
    const id = (result as any)[0]?.insertId as number;
    const rows = await db.select().from(schema.messages).where(orm.eq(schema.messages.id, id)).limit(1);
    return rows[0];
  }
  const ragStr = data.ragChunksUsed ? JSON.stringify(data.ragChunksUsed) : null;
  const id = sqliteInsert(
    "INSERT INTO messages (conversationId, role, content, audioUrl, tokensUsed, ragChunksUsed, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [data.conversationId, data.role, data.content, data.audioUrl ?? null, data.tokensUsed ?? null, ragStr, Date.now()]
  );
  return { id, ...data, createdAt: Date.now() };
}

export async function getMessages(conversationId: number) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    return db.select().from(schema.messages).where(orm.eq(schema.messages.conversationId, conversationId)).orderBy(schema.messages.createdAt);
  }
  return sqliteRun("SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC", [conversationId]);
}

// ── Knowledge Chunks ─────────────────────────────────────────────────────────
export async function addKnowledgeChunk(data: any) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    const result = await db.insert(schema.knowledgeChunks).values(data);
    const id = (result as any)[0]?.insertId as number;
    const rows = await db.select().from(schema.knowledgeChunks).where(orm.eq(schema.knowledgeChunks.id, id)).limit(1);
    return rows[0];
  }
  const id = sqliteInsert(
    "INSERT INTO knowledge_chunks (sourceUrl, sourceTitle, sourceType, content, summary, chromaId, embeddingModel, tags, scrapedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [data.sourceUrl ?? null, data.sourceTitle ?? null, data.sourceType ?? "custom_url", data.content, data.summary ?? null, data.chromaId ?? null, data.embeddingModel ?? "nomic-embed-text", data.tags ? JSON.stringify(data.tags) : null, data.scrapedAt?.getTime?.() ?? Date.now(), Date.now()]
  );
  return { id, ...data, createdAt: Date.now() };
}

export async function getKnowledgeChunks(limit = 50, offset = 0) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    return db.select().from(schema.knowledgeChunks).orderBy(orm.desc(schema.knowledgeChunks.createdAt)).limit(limit).offset(offset);
  }
  return sqliteRun("SELECT * FROM knowledge_chunks ORDER BY createdAt DESC LIMIT ? OFFSET ?", [limit, offset]);
}

export async function countKnowledgeChunks() {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    const result = await db.select({ count: orm.sql<number>`COUNT(*)` }).from(schema.knowledgeChunks);
    return Number(result[0]?.count ?? 0);
  }
  const result = sqliteRun("SELECT COUNT(*) as count FROM knowledge_chunks");
  return Number(result[0]?.count ?? 0);
}

export async function deleteKnowledgeChunk(id: number) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    await db.delete(schema.knowledgeChunks).where(orm.eq(schema.knowledgeChunks.id, id));
    return;
  }
  sqliteRun("DELETE FROM knowledge_chunks WHERE id = ?", [id]);
}

// ── Scrape Sources ───────────────────────────────────────────────────────────
export async function addScrapeSource(data: any) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    const result = await db.insert(schema.scrapeSources).values(data);
    const id = (result as any)[0]?.insertId as number;
    const rows = await db.select().from(schema.scrapeSources).where(orm.eq(schema.scrapeSources.id, id)).limit(1);
    return rows[0];
  }
  const id = sqliteInsert(
    "INSERT INTO scrape_sources (name, url, type, isActive, intervalMinutes, lastStatus, totalChunks, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [data.name, data.url, data.type, 1, data.intervalMinutes ?? 60, data.lastStatus ?? "pending", data.totalChunks ?? 0, Date.now(), Date.now()]
  );
  return { id, ...data, isActive: true, createdAt: Date.now(), updatedAt: Date.now() };
}

export async function getScrapeSources() {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    return db.select().from(schema.scrapeSources).orderBy(orm.desc(schema.scrapeSources.createdAt));
  }
  return sqliteRun("SELECT * FROM scrape_sources ORDER BY updatedAt DESC");
}

export async function updateScrapeSourceStatus(id: number, status: string, error?: string, chunksAdded?: number) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    await db.update(schema.scrapeSources).set({
      lastScrapedAt: new Date(),
      lastStatus: status,
      lastError: error ?? null,
      ...(chunksAdded !== undefined ? { totalChunks: orm.sql`totalChunks + ${chunksAdded}` } : {}),
    }).where(orm.eq(schema.scrapeSources.id, id));
    return;
  }
  if (chunksAdded !== undefined) {
    sqliteRun("UPDATE scrape_sources SET lastScrapedAt = ?, lastStatus = ?, lastError = ?, totalChunks = totalChunks + ?, updatedAt = ? WHERE id = ?",
      [Date.now(), status, error ?? null, chunksAdded, Date.now(), id]);
  } else {
    sqliteRun("UPDATE scrape_sources SET lastScrapedAt = ?, lastStatus = ?, lastError = ?, updatedAt = ? WHERE id = ?",
      [Date.now(), status, error ?? null, Date.now(), id]);
  }
}

export async function toggleScrapeSource(id: number, isActive: boolean) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    await db.update(schema.scrapeSources).set({ isActive }).where(orm.eq(schema.scrapeSources.id, id));
    return;
  }
  sqliteRun("UPDATE scrape_sources SET isActive = ?, updatedAt = ? WHERE id = ?", [isActive ? 1 : 0, Date.now(), id]);
}

export async function deleteScrapeSource(id: number) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    await db.delete(schema.scrapeSources).where(orm.eq(schema.scrapeSources.id, id));
    return;
  }
  sqliteRun("DELETE FROM scrape_sources WHERE id = ?", [id]);
}

// ── System Logs ──────────────────────────────────────────────────────────────
export async function addSystemLog(data: any) {
  if (USE_MYSQL) {
    const { db, schema } = await getMysqlDb();
    await db.insert(schema.systemLogs).values(data);
    return;
  }
  sqliteInsert(
    "INSERT INTO system_logs (level, module, message, metadata, createdAt) VALUES (?, ?, ?, ?, ?)",
    [data.level ?? "info", data.module, data.message, data.metadata ? JSON.stringify(data.metadata) : null, Date.now()]
  );
}

export async function getSystemLogs(limit = 100) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    return db.select().from(schema.systemLogs).orderBy(orm.desc(schema.systemLogs.createdAt)).limit(limit);
  }
  return sqliteRun("SELECT * FROM system_logs ORDER BY createdAt DESC LIMIT ?", [limit]);
}

export async function getRecentErrorLogs(limit = 20) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    return db.select().from(schema.systemLogs).where(orm.eq(schema.systemLogs.level, "error")).orderBy(orm.desc(schema.systemLogs.createdAt)).limit(limit);
  }
  return sqliteRun("SELECT * FROM system_logs WHERE level = 'error' ORDER BY createdAt DESC LIMIT ?", [limit]);
}

// ── Self-Improvement Patches ─────────────────────────────────────────────────
export async function addPatch(data: any) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    const result = await db.insert(schema.selfImprovementPatches).values(data);
    const id = (result as any)[0]?.insertId as number;
    const rows = await db.select().from(schema.selfImprovementPatches).where(orm.eq(schema.selfImprovementPatches.id, id)).limit(1);
    return rows[0];
  }
  const id = sqliteInsert(
    "INSERT INTO self_improvement_patches (analysisInput, suggestion, patchDiff, targetFile, status, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
    [data.analysisInput ?? null, data.suggestion, data.patchDiff ?? null, data.targetFile ?? null, data.status ?? "pending", Date.now()]
  );
  return { id, ...data, status: data.status ?? "pending", createdAt: Date.now() };
}

export async function getPatches(limit = 20) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    return db.select().from(schema.selfImprovementPatches).orderBy(orm.desc(schema.selfImprovementPatches.createdAt)).limit(limit);
  }
  return sqliteRun("SELECT * FROM self_improvement_patches ORDER BY createdAt DESC LIMIT ?", [limit]);
}

export async function updatePatchStatus(id: number, status: string) {
  if (USE_MYSQL) {
    const { db, schema, orm } = await getMysqlDb();
    await db.update(schema.selfImprovementPatches).set({
      status,
      ...(status === "applied" ? { appliedAt: new Date() } : {}),
    }).where(orm.eq(schema.selfImprovementPatches.id, id));
    return;
  }
  if (status === "applied") {
    sqliteRun("UPDATE self_improvement_patches SET status = ?, appliedAt = ? WHERE id = ?", [status, Date.now(), id]);
  } else {
    sqliteRun("UPDATE self_improvement_patches SET status = ? WHERE id = ?", [status, id]);
  }
}

// ── Compatibility shim for vectorStore.ts keyword fallback ───────────────────
export async function getDb() {
  if (USE_MYSQL) {
    const { db } = await getMysqlDb();
    return db;
  }
  return null; // SQLite mode — vectorStore keyword fallback uses its own path
}
