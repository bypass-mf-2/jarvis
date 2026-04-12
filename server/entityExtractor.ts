/**
 * Entity Extractor + In-Memory Knowledge Graph.
 *
 * WHY IN-MEMORY (not sql.js):
 * The first version stored entities in sql.js tables. Processing 68k chunks
 * generated ~4M SQL operations that overflowed WASM linear memory with
 * "RuntimeError: memory access out of bounds". The entity graph is a GRAPH
 * problem — lookups need to be O(1), not O(log n) B-tree scans. JavaScript
 * Maps give us that with zero WASM pressure.
 *
 * The graph lives in memory during runtime and serializes to
 * `entity-graph.json` every 30 seconds (same cadence as the DB autosave).
 * On startup, the JSON is loaded back. All 68k chunks process in ~30-60
 * seconds because it's pure Map/Set operations, no SQL overhead.
 *
 * Data structures:
 *   entities:      Map<normalizedName, { name, type, mentionCount }>
 *   entityChunks:  Map<normalizedName, Set<chunkId>>
 *   chunkEntities: Map<chunkId, Set<normalizedName>>
 *   relationships: Map<normalizedName, Map<normalizedName, strength>>
 */

import * as fs from "fs";
import * as path from "path";
import { getDatabase } from "./sqlite-init.js";
import { logger } from "./logger.js";

// ─── Graph storage ─────────────────────────────────────────────────────────

const GRAPH_PATH = path.join(process.cwd(), "entity-graph.json");

interface EntityRecord {
  name: string;
  type: string;
  mentionCount: number;
}

interface SerializedGraph {
  entities: Record<string, EntityRecord>;
  entityChunks: Record<string, number[]>;
  relationships: Record<string, Record<string, number>>;
  meta: { lastBackfillChunkId: number; savedAt: number };
}

// The in-memory graph. All queries go through these Maps.
const _entities = new Map<string, EntityRecord>();
const _entityChunks = new Map<string, Set<number>>();   // normalizedName → chunkIds
const _chunkEntities = new Map<number, Set<string>>();   // chunkId → normalizedNames
const _relationships = new Map<string, Map<string, number>>(); // entityA → (entityB → strength)
let _lastBackfillChunkId = 0;
let _graphDirty = false;
let _graphLoaded = false;

// ─── Persistence ───────────────────────────────────────────────────────────

export function loadGraph(): void {
  if (!fs.existsSync(GRAPH_PATH)) {
    _graphLoaded = true;
    return;
  }
  try {
    const raw = fs.readFileSync(GRAPH_PATH, "utf-8");
    const data: SerializedGraph = JSON.parse(raw);

    _entities.clear();
    _entityChunks.clear();
    _chunkEntities.clear();
    _relationships.clear();

    for (const [norm, rec] of Object.entries(data.entities)) {
      _entities.set(norm, rec);
    }
    for (const [norm, ids] of Object.entries(data.entityChunks)) {
      const set = new Set(ids);
      _entityChunks.set(norm, set);
      for (const id of ids) {
        if (!_chunkEntities.has(id)) _chunkEntities.set(id, new Set());
        _chunkEntities.get(id)!.add(norm);
      }
    }
    for (const [a, neighbors] of Object.entries(data.relationships)) {
      _relationships.set(a, new Map(Object.entries(neighbors)));
    }
    _lastBackfillChunkId = data.meta?.lastBackfillChunkId ?? 0;
    _graphLoaded = true;

    logger.info(
      "entityExtractor",
      `Graph loaded: ${_entities.size.toLocaleString()} entities, ${_relationships.size.toLocaleString()} relationship sets, checkpoint=${_lastBackfillChunkId}`
    );
  } catch (err) {
    logger.warn("entityExtractor", `Failed to load graph: ${String(err)}`);
    _graphLoaded = true;
  }
}

export function saveGraph(): void {
  if (!_graphDirty) return;
  try {
    const data: SerializedGraph = {
      entities: Object.fromEntries(_entities),
      entityChunks: {} as Record<string, number[]>,
      relationships: {} as Record<string, Record<string, number>>,
      meta: { lastBackfillChunkId: _lastBackfillChunkId, savedAt: Date.now() },
    };
    for (const [norm, set] of _entityChunks) {
      data.entityChunks[norm] = Array.from(set);
    }
    for (const [a, neighbors] of _relationships) {
      data.relationships[a] = Object.fromEntries(neighbors);
    }
    const tmpPath = GRAPH_PATH + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data));
    fs.renameSync(tmpPath, GRAPH_PATH);
    _graphDirty = false;
  } catch (err) {
    logger.warn("entityExtractor", `Failed to save graph: ${String(err)}`);
  }
}

// Auto-save every 30 seconds (same cadence as DB autosave)
setInterval(() => saveGraph(), 30_000);

// ─── Entity type patterns (same as before) ─────────────────────────────────

const ORG_SUFFIXES = /\b(?:Inc|Corp|LLC|Ltd|Co|University|Institute|Foundation|Association|Agency|Department|Laboratory|Labs|Lab|Group|Company|Technologies|Systems|Research|Center|Centre|Council|Society|Board|Bureau|Network)\b/i;

const TECH_TERMS = new Set([
  "python", "javascript", "typescript", "rust", "golang", "java", "swift",
  "kotlin", "ruby", "php", "haskell", "scala", "lua", "dart", "julia",
  "sql", "graphql", "html", "css", "react", "angular", "vue", "svelte",
  "nextjs", "django", "flask", "fastapi", "express", "spring", "rails",
  "pytorch", "tensorflow", "keras", "pandas", "numpy", "docker", "kubernetes",
  "terraform", "jenkins", "github", "gitlab", "aws", "azure", "gcp",
  "postgresql", "mysql", "mongodb", "redis", "elasticsearch", "kafka",
  "nginx", "linux", "windows", "macos", "ios", "android", "playwright",
  "openai", "anthropic", "deepmind", "ollama", "llama", "gpt", "bert",
  "transformer", "stable diffusion", "langchain", "chromadb",
  "nmap", "metasploit", "wireshark", "owasp",
  "machine learning", "deep learning", "neural network",
  "reinforcement learning", "natural language processing",
  "computer vision", "blockchain", "quantum computing",
  "cybersecurity", "devops", "microservices",
]);

const STOP_ENTITIES = new Set([
  "the", "this", "that", "these", "those", "here", "there",
  "new", "old", "good", "bad", "best", "first", "last", "next",
  "many", "much", "more", "most", "some", "any", "all", "each",
  "however", "although", "therefore", "furthermore", "moreover",
  "figure", "table", "section", "chapter", "page", "source",
  "introduction", "conclusion", "abstract", "summary", "overview",
  "example", "note", "also", "related", "references",
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
  "search discovery", "frontier crawl", "auto-discovered",
]);

// ─── Normalization + classification ────────────────────────────────────────

export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s'-]/g, "")
    .trim();
}

function classifyEntity(name: string): string {
  const lower = name.toLowerCase();
  if (TECH_TERMS.has(lower)) return "technology";
  if (ORG_SUFFIXES.test(name)) return "organization";
  if (name.split(/\s+/).length >= 2 && /^[A-Z]/.test(name)) return "named_entity";
  return "concept";
}

// ─── Fast NER extraction ───────────────────────────────────────────────────

export function extractEntitiesFromText(text: string): Array<{
  name: string;
  normalizedName: string;
  type: string;
}> {
  const entities = new Map<string, { name: string; type: string }>();

  // Capitalized multi-word sequences (proper nouns)
  const properNounRe = /\b([A-Z][a-z]+(?:\s+(?:of|the|and|for|in|on|at|to|de|von|van)?\s*)?(?:[A-Z][a-z]+){1,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = properNounRe.exec(text)) !== null) {
    const raw = m[1].trim();
    if (raw.length < 4) continue;
    const norm = normalizeEntityName(raw);
    if (STOP_ENTITIES.has(norm) || norm.length < 3) continue;
    if (!entities.has(norm)) entities.set(norm, { name: raw, type: classifyEntity(raw) });
  }

  // Mid-sentence capitalized words (5+ chars)
  const singleCapRe = /(?<=[a-z,;:]\s)([A-Z][a-z]{4,})\b/g;
  while ((m = singleCapRe.exec(text)) !== null) {
    const norm = normalizeEntityName(m[1]);
    if (STOP_ENTITIES.has(norm)) continue;
    if (!entities.has(norm)) entities.set(norm, { name: m[1], type: classifyEntity(m[1]) });
  }

  // Technology terms (case-insensitive)
  const words = text.toLowerCase().split(/[^a-z0-9/-]+/);
  for (let i = 0; i < words.length; i++) {
    if (TECH_TERMS.has(words[i])) {
      const norm = normalizeEntityName(words[i]);
      if (!entities.has(norm)) entities.set(norm, { name: words[i], type: "technology" });
    }
    if (i < words.length - 1) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      if (TECH_TERMS.has(bigram)) {
        const norm = normalizeEntityName(bigram);
        if (!entities.has(norm)) entities.set(norm, { name: bigram, type: "technology" });
      }
    }
  }

  return Array.from(entities.values()).map((e) => ({
    name: e.name,
    normalizedName: normalizeEntityName(e.name),
    type: e.type,
  }));
}

// ─── Graph mutation (in-memory) ────────────────────────────────────────────

const MAX_ENTITIES_PER_CHUNK = 12;
const MAX_RELATIONSHIP_ENTITIES = 8; // Only top N entities for O(N²) co-occurrence

export function processChunkForEntities(chunkId: number, content: string): void {
  let extracted = extractEntitiesFromText(content);
  if (extracted.length === 0) return;

  // Cap to prevent combinatorial explosion on relationship building
  if (extracted.length > MAX_ENTITIES_PER_CHUNK) {
    extracted = extracted.slice(0, MAX_ENTITIES_PER_CHUNK);
  }

  const chunkEntityNames: string[] = [];

  for (const e of extracted) {
    const existing = _entities.get(e.normalizedName);
    if (existing) {
      existing.mentionCount++;
    } else {
      _entities.set(e.normalizedName, {
        name: e.name,
        type: e.type,
        mentionCount: 1,
      });
    }

    if (!_entityChunks.has(e.normalizedName)) {
      _entityChunks.set(e.normalizedName, new Set());
    }
    _entityChunks.get(e.normalizedName)!.add(chunkId);

    if (!_chunkEntities.has(chunkId)) {
      _chunkEntities.set(chunkId, new Set());
    }
    _chunkEntities.get(chunkId)!.add(e.normalizedName);

    chunkEntityNames.push(e.normalizedName);
  }

  // Co-occurrence relationships (only between top N entities to cap O(N²))
  const forRelationships = chunkEntityNames.slice(0, MAX_RELATIONSHIP_ENTITIES);
  for (let i = 0; i < forRelationships.length; i++) {
    for (let j = i + 1; j < forRelationships.length; j++) {
      const a = forRelationships[i] < forRelationships[j] ? forRelationships[i] : forRelationships[j];
      const b = forRelationships[i] < forRelationships[j] ? forRelationships[j] : forRelationships[i];
      if (!_relationships.has(a)) _relationships.set(a, new Map());
      const neighbors = _relationships.get(a)!;
      neighbors.set(b, (neighbors.get(b) ?? 0) + 1);
    }
  }

  _graphDirty = true;
}

// ─── Graph queries (used by inferenceEngine.ts) ────────────────────────────

export function searchEntitiesInGraph(query: string, limit: number = 20): Array<{
  normalizedName: string;
  name: string;
  type: string;
  mentionCount: number;
}> {
  const normalized = normalizeEntityName(query);
  const results: Array<{ normalizedName: string; name: string; type: string; mentionCount: number }> = [];

  for (const [norm, rec] of _entities) {
    if (norm.includes(normalized)) {
      results.push({ normalizedName: norm, ...rec });
    }
  }

  results.sort((a, b) => b.mentionCount - a.mentionCount);
  return results.slice(0, limit);
}

export function getRelatedEntitiesFromGraph(normalizedName: string, limit: number = 20): Array<{
  normalizedName: string;
  name: string;
  type: string;
  mentionCount: number;
  strength: number;
}> {
  const results: Array<{ normalizedName: string; name: string; type: string; mentionCount: number; strength: number }> = [];

  // Check both directions (a→b and b→a)
  const neighborsA = _relationships.get(normalizedName);
  if (neighborsA) {
    for (const [neighbor, strength] of neighborsA) {
      const rec = _entities.get(neighbor);
      if (rec) results.push({ normalizedName: neighbor, ...rec, strength });
    }
  }

  // Also check reverse direction
  for (const [a, neighbors] of _relationships) {
    if (a === normalizedName) continue;
    const strength = neighbors.get(normalizedName);
    if (strength && !results.some((r) => r.normalizedName === a)) {
      const rec = _entities.get(a);
      if (rec) results.push({ normalizedName: a, ...rec, strength });
    }
  }

  results.sort((a, b) => b.strength - a.strength);
  return results.slice(0, limit);
}

export function getEntityChunkIdsFromGraph(normalizedName: string, limit: number = 50): number[] {
  const set = _entityChunks.get(normalizedName);
  if (!set) return [];
  return Array.from(set).slice(0, limit);
}

export function getGraphStats(): {
  entities: number;
  chunkLinks: number;
  relationshipPairs: number;
  lastBackfillChunkId: number;
  loaded: boolean;
} {
  let totalLinks = 0;
  for (const set of _entityChunks.values()) totalLinks += set.size;
  let totalRels = 0;
  for (const neighbors of _relationships.values()) totalRels += neighbors.size;

  return {
    entities: _entities.size,
    chunkLinks: totalLinks,
    relationshipPairs: totalRels,
    lastBackfillChunkId: _lastBackfillChunkId,
    loaded: _graphLoaded,
  };
}

// ─── Backfill ──────────────────────────────────────────────────────────────

export async function backfillEntityGraph(): Promise<{
  chunksProcessed: number;
  entitiesFound: number;
  relationshipsBuilt: number;
  durationMs: number;
}> {
  if (!_graphLoaded) loadGraph();

  const db = getDatabase();
  const countResult = db.exec(
    `SELECT COUNT(*) FROM knowledge_chunks WHERE id > ${_lastBackfillChunkId}`
  );
  const remaining = (countResult[0]?.values[0]?.[0] as number) ?? 0;

  if (remaining === 0) {
    const stats = getGraphStats();
    await logger.info(
      "entityExtractor",
      `Entity graph up to date: ${stats.entities.toLocaleString()} entities, ${stats.relationshipPairs.toLocaleString()} relationships`
    );
    return { chunksProcessed: 0, entitiesFound: stats.entities, relationshipsBuilt: stats.relationshipPairs, durationMs: 0 };
  }

  await logger.info(
    "entityExtractor",
    `Backfilling entity graph: ${remaining.toLocaleString()} chunks (from id ${_lastBackfillChunkId})`
  );

  const start = Date.now();
  const BATCH_SIZE = 1000;
  let processed = 0;

  while (true) {
    const stmt = db.prepare(
      "SELECT id, content FROM knowledge_chunks WHERE id > ? ORDER BY id ASC LIMIT ?"
    );
    stmt.bind([_lastBackfillChunkId, BATCH_SIZE]);

    const batch: Array<{ id: number; content: string }> = [];
    while (stmt.step()) {
      batch.push(stmt.getAsObject() as any);
    }
    stmt.free();

    if (batch.length === 0) break;

    for (const { id, content } of batch) {
      processChunkForEntities(id, content);
      _lastBackfillChunkId = id;
    }

    processed += batch.length;

    // Checkpoint to disk every batch so crashes don't lose all progress
    saveGraph();

    if (processed % 5000 < BATCH_SIZE) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const rate = Math.round(processed / ((Date.now() - start) / 1000));
      const stats = getGraphStats();
      await logger.info(
        "entityExtractor",
        `Backfill: ${processed.toLocaleString()}/${remaining.toLocaleString()} (${elapsed}s, ${rate}/sec, ${stats.entities.toLocaleString()} entities, ${stats.relationshipPairs.toLocaleString()} rels)`
      );
    }
  }

  saveGraph();
  const durationMs = Date.now() - start;
  const stats = getGraphStats();

  await logger.info(
    "entityExtractor",
    `Backfill complete: ${processed.toLocaleString()} chunks → ${stats.entities.toLocaleString()} entities, ${stats.relationshipPairs.toLocaleString()} relationships (${(durationMs / 1000).toFixed(1)}s)`
  );

  return {
    chunksProcessed: processed,
    entitiesFound: stats.entities,
    relationshipsBuilt: stats.relationshipPairs,
    durationMs,
  };
}
