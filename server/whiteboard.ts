/**
 * Whiteboard / drawn-notes module.
 *
 * Two-level structure: subjects (folders) hold pages (canvases). Each page
 * is stored as a base64 PNG dataURL — simplest format that round-trips
 * through SQLite TEXT, and React can drop straight into <img src> or hand
 * to a canvas.drawImage(). Could optimize to vector-stroke storage later
 * if file sizes become a problem; PNG is fine for "tens of pages."
 *
 * No external deps. Schema is created lazily on first call.
 */

import { getDatabase, markDbDirty } from "./sqlite-init.js";
import { logger } from "./logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WhiteboardSubject {
  id: number;
  name: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
}

export interface WhiteboardPage {
  id: number;
  subjectId: number;
  title: string;
  imageData: string | null; // base64 PNG dataURL
  width: number;
  height: number;
  pageOrder: number;
  createdAt: number;
  updatedAt: number;
}

// ── Schema ───────────────────────────────────────────────────────────────────

let _schemaReady = false;
function ensureSchema(): void {
  if (_schemaReady) return;
  const db = getDatabase();
  db.run(`
    CREATE TABLE IF NOT EXISTS whiteboard_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS whiteboard_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subjectId INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled',
      imageData TEXT,
      width INTEGER NOT NULL DEFAULT 1200,
      height INTEGER NOT NULL DEFAULT 800,
      pageOrder INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_whiteboard_pages_subjectId ON whiteboard_pages(subjectId)`);
  _schemaReady = true;
}

// ── Subjects ─────────────────────────────────────────────────────────────────

export function listSubjects(): WhiteboardSubject[] {
  ensureSchema();
  const db = getDatabase();
  const r = db.exec(`
    SELECT s.id, s.name, s.color, s.createdAt, s.updatedAt,
           (SELECT COUNT(*) FROM whiteboard_pages p WHERE p.subjectId = s.id) AS pageCount
    FROM whiteboard_subjects s
    ORDER BY s.updatedAt DESC
  `);
  if (r.length === 0) return [];
  return r[0].values.map((row): WhiteboardSubject => {
    const [id, name, color, createdAt, updatedAt, pageCount] = row as [
      number, string, string | null, number, number, number,
    ];
    return { id, name, color, createdAt, updatedAt, pageCount };
  });
}

export function createSubject(input: { name: string; color?: string }): WhiteboardSubject {
  ensureSchema();
  const name = input.name.trim();
  if (!name) throw new Error("Subject name is required");
  const db = getDatabase();
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO whiteboard_subjects (name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?)`,
  );
  stmt.bind([name, input.color ?? null, now, now]);
  stmt.step();
  stmt.free();
  const id = (db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] as number) ?? 0;
  markDbDirty();
  return { id, name, color: input.color ?? null, createdAt: now, updatedAt: now, pageCount: 0 };
}

export function renameSubject(input: { id: number; name?: string; color?: string }): void {
  ensureSchema();
  const db = getDatabase();
  const updates: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) { updates.push("name = ?"); params.push(input.name.trim()); }
  if (input.color !== undefined) { updates.push("color = ?"); params.push(input.color || null); }
  if (updates.length === 0) return;
  updates.push("updatedAt = ?");
  params.push(Date.now());
  params.push(input.id);
  const stmt = db.prepare(`UPDATE whiteboard_subjects SET ${updates.join(", ")} WHERE id = ?`);
  stmt.bind(params as never);
  stmt.step();
  stmt.free();
  markDbDirty();
}

export function deleteSubject(id: number): void {
  ensureSchema();
  const db = getDatabase();
  // Delete all pages for this subject first (no FK cascade in this schema)
  const delPages = db.prepare("DELETE FROM whiteboard_pages WHERE subjectId = ?");
  delPages.bind([id]);
  delPages.step();
  delPages.free();
  const delSubj = db.prepare("DELETE FROM whiteboard_subjects WHERE id = ?");
  delSubj.bind([id]);
  delSubj.step();
  delSubj.free();
  markDbDirty();
}

// ── Pages ────────────────────────────────────────────────────────────────────

export function listPages(subjectId: number): WhiteboardPage[] {
  ensureSchema();
  const db = getDatabase();
  const r = db.exec(
    `SELECT id, subjectId, title, imageData, width, height, pageOrder, createdAt, updatedAt
     FROM whiteboard_pages WHERE subjectId = ?
     ORDER BY pageOrder ASC, id ASC`,
    [subjectId],
  );
  if (r.length === 0) return [];
  return r[0].values.map((row): WhiteboardPage => {
    const [id, sid, title, imageData, width, height, pageOrder, createdAt, updatedAt] = row as [
      number, number, string, string | null, number, number, number, number, number,
    ];
    return { id, subjectId: sid, title, imageData, width, height, pageOrder, createdAt, updatedAt };
  });
}

export function getPage(id: number): WhiteboardPage | null {
  ensureSchema();
  const db = getDatabase();
  const r = db.exec(
    `SELECT id, subjectId, title, imageData, width, height, pageOrder, createdAt, updatedAt
     FROM whiteboard_pages WHERE id = ? LIMIT 1`,
    [id],
  );
  if (r.length === 0 || r[0].values.length === 0) return null;
  const [rid, sid, title, imageData, width, height, pageOrder, createdAt, updatedAt] = r[0].values[0] as [
    number, number, string, string | null, number, number, number, number, number,
  ];
  return { id: rid, subjectId: sid, title, imageData, width, height, pageOrder, createdAt, updatedAt };
}

export function createPage(input: {
  subjectId: number;
  title?: string;
  imageData?: string;
  width?: number;
  height?: number;
}): WhiteboardPage {
  ensureSchema();
  const db = getDatabase();
  const now = Date.now();
  // Compute next pageOrder for this subject
  const orderRow = db.exec(
    `SELECT COALESCE(MAX(pageOrder), -1) + 1 AS next FROM whiteboard_pages WHERE subjectId = ?`,
    [input.subjectId],
  );
  const pageOrder = (orderRow[0]?.values[0]?.[0] as number) ?? 0;
  const title = input.title?.trim() || "Untitled";
  const width = input.width ?? 1200;
  const height = input.height ?? 800;

  const stmt = db.prepare(
    `INSERT INTO whiteboard_pages
       (subjectId, title, imageData, width, height, pageOrder, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.bind([
    input.subjectId,
    title,
    input.imageData ?? null,
    width,
    height,
    pageOrder,
    now,
    now,
  ]);
  stmt.step();
  stmt.free();
  const id = (db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] as number) ?? 0;
  // Bump subject's updatedAt
  const upd = db.prepare("UPDATE whiteboard_subjects SET updatedAt = ? WHERE id = ?");
  upd.bind([now, input.subjectId]);
  upd.step();
  upd.free();
  markDbDirty();
  return {
    id,
    subjectId: input.subjectId,
    title,
    imageData: input.imageData ?? null,
    width,
    height,
    pageOrder,
    createdAt: now,
    updatedAt: now,
  };
}

export function updatePage(input: {
  id: number;
  title?: string;
  imageData?: string;
  pageOrder?: number;
}): void {
  ensureSchema();
  const db = getDatabase();
  const updates: string[] = [];
  const params: unknown[] = [];
  if (input.title !== undefined) { updates.push("title = ?"); params.push(input.title.trim() || "Untitled"); }
  if (input.imageData !== undefined) { updates.push("imageData = ?"); params.push(input.imageData); }
  if (input.pageOrder !== undefined) { updates.push("pageOrder = ?"); params.push(input.pageOrder); }
  if (updates.length === 0) return;
  updates.push("updatedAt = ?");
  const now = Date.now();
  params.push(now);
  params.push(input.id);
  const stmt = db.prepare(`UPDATE whiteboard_pages SET ${updates.join(", ")} WHERE id = ?`);
  stmt.bind(params as never);
  stmt.step();
  stmt.free();
  // Bump subject's updatedAt too — best-effort lookup
  const r = db.exec("SELECT subjectId FROM whiteboard_pages WHERE id = ?", [input.id]);
  const sid = r[0]?.values[0]?.[0] as number | undefined;
  if (sid) {
    const upd = db.prepare("UPDATE whiteboard_subjects SET updatedAt = ? WHERE id = ?");
    upd.bind([now, sid]);
    upd.step();
    upd.free();
  }
  markDbDirty();
}

export function deletePage(id: number): void {
  ensureSchema();
  const db = getDatabase();
  const stmt = db.prepare("DELETE FROM whiteboard_pages WHERE id = ?");
  stmt.bind([id]);
  stmt.step();
  stmt.free();
  markDbDirty();
}

// ── Maintenance helper ───────────────────────────────────────────────────────

export function getStats(): { subjects: number; pages: number; bytes: number } {
  try {
    ensureSchema();
    const db = getDatabase();
    const subj = (db.exec("SELECT COUNT(*) FROM whiteboard_subjects")[0]?.values[0]?.[0] as number) ?? 0;
    const pages = (db.exec("SELECT COUNT(*) FROM whiteboard_pages")[0]?.values[0]?.[0] as number) ?? 0;
    const bytes = (db.exec("SELECT COALESCE(SUM(LENGTH(imageData)), 0) FROM whiteboard_pages")[0]?.values[0]?.[0] as number) ?? 0;
    return { subjects: subj, pages, bytes };
  } catch (err) {
    void logger.warn("whiteboard", `getStats failed: ${err}`);
    return { subjects: 0, pages: 0, bytes: 0 };
  }
}
