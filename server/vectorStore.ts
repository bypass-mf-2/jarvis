/**
 * Vector store abstraction using ChromaDB (via HTTP API).
 * Falls back to simple keyword search in SQLite/MySQL when ChromaDB is unavailable.
 * ChromaDB runs locally at http://localhost:8000 (started by setup scripts).
 */

import { getEmbedding } from "./ollama";
import { getKnowledgeChunks } from "./db";
import { logger } from "./logger";

const CHROMA_BASE = process.env.CHROMA_BASE_URL || "http://localhost:8000";
const COLLECTION_NAME = "jarvis_knowledge";

// ── Cached state (avoids repeated HTTP calls per chunk) ──────────────────────
let _chromaAvailable: boolean | null = null;
let _chromaCheckedAt = 0;
const CHROMA_CACHE_TTL = 30_000; // recheck every 30s

let _collectionId: string | null = null;
let _collectionEnsured = false;
let _chromaUnavailableLogged = false;

// ── ChromaDB availability ─────────────────────────────────────────────────────
async function isChromaAvailable(): Promise<boolean> {
  const now = Date.now();
  if (_chromaAvailable !== null && now - _chromaCheckedAt < CHROMA_CACHE_TTL) {
    return _chromaAvailable;
  }
  try {
    const res = await fetch(`${CHROMA_BASE}/api/v2/heartbeat`, {
      signal: AbortSignal.timeout(2000),
    });
    _chromaAvailable = res.ok;
  } catch {
    _chromaAvailable = false;
    _collectionId = null;
    _collectionEnsured = false;
  }
  _chromaCheckedAt = now;
  return _chromaAvailable!;
}

// ── Ensure collection exists (cached) ────────────────────────────────────────
async function ensureCollection(): Promise<boolean> {
  if (_collectionEnsured && _collectionId) return true;
  try {
    const getRes = await fetch(
      `${CHROMA_BASE}/api/v2/tenants/default_tenant/databases/default_database/collections/${COLLECTION_NAME}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (getRes.ok) {
      const data = (await getRes.json()) as { id?: string };
      _collectionId = data.id ?? null;
      _collectionEnsured = true;
      return true;
    }

    const createRes = await fetch(
      `${CHROMA_BASE}/api/v2/tenants/default_tenant/databases/default_database/collections`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: COLLECTION_NAME,
          metadata: { "hnsw:space": "cosine" },
        }),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (createRes.ok) {
      const data = (await createRes.json()) as { id?: string };
      _collectionId = data.id ?? null;
      _collectionEnsured = true;
    }
    return createRes.ok;
  } catch {
    return false;
  }
}

async function getCollectionId(): Promise<string | null> {
  if (_collectionId) return _collectionId;
  try {
    const res = await fetch(
      `${CHROMA_BASE}/api/v2/tenants/default_tenant/databases/default_database/collections/${COLLECTION_NAME}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    _collectionId = data.id ?? null;
    return _collectionId;
  } catch {
    return null;
  }
}

// ── Add document to vector store ──────────────────────────────────────────────
export async function addToVectorStore(
  id: string,
  content: string,
  metadata: Record<string, string>
): Promise<boolean> {
  const chromaUp = await isChromaAvailable();
  if (!chromaUp) {
    if (!_chromaUnavailableLogged) {
      _chromaUnavailableLogged = true;
      await logger.warn("vectorStore", "ChromaDB unavailable — skipping vector embeddings until it comes back");
    }
    return false;
  }
  _chromaUnavailableLogged = false;

  try {
    await ensureCollection();
    const collectionId = await getCollectionId();
    if (!collectionId) return false;

    const embedding = await getEmbedding(content);
    if (!embedding.length) {
      await logger.warn("vectorStore", "Empty embedding returned, skipping");
      return false;
    }

    const res = await fetch(
      `${CHROMA_BASE}/api/v2/tenants/default_tenant/databases/default_database/collections/${collectionId}/add`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [id],
          embeddings: [embedding],
          documents: [content],
          metadatas: [metadata],
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );
    return res.ok;
  } catch (err) {
    // Reset cache so next call rechecks
    _chromaAvailable = null;
    _collectionId = null;
    _collectionEnsured = false;
    await logger.error("vectorStore", "Failed to add document", { error: String(err) });
    return false;
  }
}

/**
 * Store a document with a PRE-COMPUTED embedding. Used by the batch embed
 * pipeline in scraper.ts where we call getEmbeddingBatch() once for N chunks
 * and then store each result individually. This avoids double-embedding.
 */
export async function addToVectorStoreDirect(
  id: string,
  content: string,
  metadata: Record<string, string>,
  embedding: number[]
): Promise<boolean> {
  const chromaUp = await isChromaAvailable();
  if (!chromaUp) return false;

  try {
    await ensureCollection();
    const collectionId = await getCollectionId();
    if (!collectionId) return false;

    const res = await fetch(
      `${CHROMA_BASE}/api/v2/tenants/default_tenant/databases/default_database/collections/${collectionId}/add`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [id],
          embeddings: [embedding],
          documents: [content],
          metadatas: [metadata],
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );
    return res.ok;
  } catch (err) {
    _chromaAvailable = null;
    _collectionId = null;
    _collectionEnsured = false;
    return false;
  }
}

// ── Query vector store ────────────────────────────────────────────────────────
export type VectorSearchResult = {
  id: string;
  content: string;
  metadata: Record<string, string>;
  distance: number;
};

export async function queryVectorStore(
  queryText: string,
  topK = 5
): Promise<VectorSearchResult[]> {
  const chromaUp = await isChromaAvailable();

  if (chromaUp) {
    try {
      const collectionId = await getCollectionId();
      if (!collectionId) throw new Error("Collection not found");

      const embedding = await getEmbedding(queryText);
      if (!embedding.length) throw new Error("Empty query embedding");

      const res = await fetch(
        `${CHROMA_BASE}/api/v2/tenants/default_tenant/databases/default_database/collections/${collectionId}/query`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query_embeddings: [embedding],
            n_results: topK,
            include: ["documents", "metadatas", "distances"],
          }),
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (!res.ok) throw new Error(`ChromaDB query error: ${res.status}`);
      const data = (await res.json()) as {
        ids?: string[][];
        documents?: string[][];
        metadatas?: Record<string, string>[][];
        distances?: number[][];
      };

      const ids = data.ids?.[0] ?? [];
      const docs = data.documents?.[0] ?? [];
      const metas = data.metadatas?.[0] ?? [];
      const dists = data.distances?.[0] ?? [];

      return ids.map((id, i) => ({
        id,
        content: docs[i] ?? "",
        metadata: metas[i] ?? {},
        distance: dists[i] ?? 1,
      }));
    } catch (err) {
      await logger.warn("vectorStore", "ChromaDB query failed, falling back to keyword search", {
        error: String(err),
      });
    }
  }

  // Fallback: keyword search in the database
  return keywordFallbackSearch(queryText, topK);
}

async function keywordFallbackSearch(query: string, topK: number): Promise<VectorSearchResult[]> {
  try {
    // Get all recent chunks and do simple keyword matching
    const chunks = await getKnowledgeChunks(200, 0);
    const keywords = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);

    const scored = chunks
      .map((r: any) => {
        const content = (r.content || "").toLowerCase();
        const matchCount = keywords.filter((kw: string) => content.includes(kw)).length;
        return { chunk: r, score: matchCount };
      })
      .filter((s: any) => s.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, topK);

    return scored.map((s: any) => ({
      id: s.chunk.chromaId ?? String(s.chunk.id),
      content: s.chunk.content,
      metadata: {
        sourceUrl: s.chunk.sourceUrl ?? "",
        sourceTitle: s.chunk.sourceTitle ?? "",
        sourceType: s.chunk.sourceType ?? "custom_url",
      },
      distance: 1 - (s.score / Math.max(keywords.length, 1)),
    }));
  } catch {
    return [];
  }
}

// ── Delete from vector store ──────────────────────────────────────────────────
export async function deleteFromVectorStore(id: string): Promise<void> {
  const chromaUp = await isChromaAvailable();
  if (!chromaUp) return;
  try {
    const collectionId = await getCollectionId();
    if (!collectionId) return;
    await fetch(
      `${CHROMA_BASE}/api/v2/tenants/default_tenant/databases/default_database/collections/${collectionId}/delete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
        signal: AbortSignal.timeout(5000),
      }
    );
  } catch {
    // best-effort
  }
}
