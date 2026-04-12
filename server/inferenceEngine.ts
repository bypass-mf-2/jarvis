/**
 * Inference Engine — multi-hop RAG with entity graph traversal.
 *
 * Replaces the old "retrieve 5 chunks and hope for the best" pipeline with
 * a three-phase retrieval that actively follows connections in the knowledge
 * graph to build a richer context for the LLM:
 *
 * Phase 1 — Direct retrieval:
 *   Vector search for the raw user query → top 20 chunks.
 *
 * Phase 2 — Entity expansion:
 *   Extract entities from the query + Phase 1 chunks. For each entity,
 *   traverse the co-occurrence graph 1-2 hops. Pull chunks linked to
 *   the expanded entity set.
 *
 * Phase 3 — Re-rank and synthesize:
 *   Score all candidate chunks by a weighted combination of:
 *     - Vector similarity (from Phase 1)
 *     - Entity relevance (how many query entities appear in the chunk)
 *     - Graph centrality (how connected the chunk's entities are)
 *     - Source quality (domain_scores.quality_score)
 *   Take the top 25 and feed them to the LLM with a structured
 *   synthesis prompt that asks for cross-source comparison, inference
 *   chains, and confidence levels.
 *
 * The result is that a question like "How did Hitler's economic policies
 * relate to the Weimar Republic?" retrieves chunks about:
 *   - Hitler (direct match)
 *   - Economic policies (direct match)
 *   - Weimar Republic (direct match)
 *   - Nazi Party (1-hop from Hitler)
 *   - Hyperinflation (1-hop from Weimar Republic)
 *   - Treaty of Versailles (1-hop from Weimar Republic)
 * ...instead of just the 5 chunks closest to the embedding of the question.
 */

import { queryVectorStore, type VectorSearchResult } from "./vectorStore.js";
import { getChunksByIds } from "./db.js";
import {
  extractEntitiesFromText,
  normalizeEntityName,
  searchEntitiesInGraph,
  getRelatedEntitiesFromGraph,
  getEntityChunkIdsFromGraph,
  getGraphStats,
} from "./entityExtractor.js";
import { logger } from "./logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InferenceChunk {
  id: number;
  chromaId: string;
  content: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceType: string;
  /** Combined relevance score (higher = more relevant). */
  score: number;
  /** How this chunk was found: "vector" | "entity_direct" | "entity_hop" */
  retrievalPath: string;
}

export interface InferenceResult {
  /** Final ranked chunks fed to the LLM. */
  chunks: InferenceChunk[];
  /** Entities extracted from the query + discovered via graph traversal. */
  queryEntities: string[];
  expandedEntities: string[];
  /** Stats for debugging/display. */
  stats: {
    vectorCandidates: number;
    entityCandidates: number;
    totalCandidates: number;
    finalChunks: number;
    graphHopsUsed: number;
    durationMs: number;
  };
}

// ─── Configuration ──────────────────────────────────────────────────────────

const VECTOR_TOP_K = 20;           // Phase 1: how many chunks to retrieve via vector search
const ENTITY_HOP_DEPTH = 2;        // Phase 2: how many hops in the co-occurrence graph
const ENTITY_NEIGHBORS_PER_HOP = 10; // Phase 2: how many related entities per hop
const ENTITY_CHUNKS_PER_ENTITY = 8;  // Phase 2: how many chunks per expanded entity
const FINAL_CHUNK_COUNT = 25;       // Phase 3: how many chunks to send to the LLM

// Score weights for re-ranking (must sum to 1.0)
const W_VECTOR = 0.45;    // vector similarity score
const W_ENTITY = 0.35;    // entity relevance (what fraction of query entities appear)
const W_GRAPH = 0.20;     // graph centrality (are the chunk's entities well-connected?)

// ─── Phase 1: Direct vector retrieval ──────────────────────────────────────

async function directVectorRetrieval(query: string): Promise<Map<string, InferenceChunk>> {
  const results = await queryVectorStore(query, VECTOR_TOP_K);
  const chunks = new Map<string, InferenceChunk>();

  for (const r of results) {
    // Vector distance → similarity score (ChromaDB returns distance, not similarity)
    const similarity = Math.max(0, 1 - (r.distance ?? 1));
    chunks.set(r.id, {
      id: parseInt(r.metadata?.id ?? "0", 10) || 0,
      chromaId: r.id,
      content: r.content,
      sourceUrl: r.metadata?.sourceUrl ?? "",
      sourceTitle: r.metadata?.sourceTitle ?? "",
      sourceType: r.metadata?.sourceType ?? "",
      score: similarity,
      retrievalPath: "vector",
    });
  }

  return chunks;
}

// ─── Phase 2: Entity expansion via knowledge graph ─────────────────────────

function extractQueryEntities(query: string): string[] {
  // Use the same fast NER that processes chunks, plus a simple keyword search
  // against the entities table for any known entities in the query.
  const nerEntities = extractEntitiesFromText(query).map((e) => e.normalizedName);

  // Also search the entities table for query terms — catches entities that
  // the NER misses because they're lowercase in the query (e.g., "hitler"
  // without capitalization).
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const dbMatches: string[] = [];
  for (const word of queryWords) {
    const found = searchEntitiesInGraph(word, 3);
    for (const e of found) {
      dbMatches.push(e.normalizedName);
    }
  }

  // Deduplicate
  return Array.from(new Set([...nerEntities, ...dbMatches]));
}

async function entityGraphExpansion(
  queryEntities: string[],
  vectorChunks: Map<string, InferenceChunk>
): Promise<{
  expandedEntities: string[];
  entityChunks: Map<string, InferenceChunk>;
  hopsUsed: number;
}> {
  const entityChunks = new Map<string, InferenceChunk>();
  const allExpandedEntities = new Set(queryEntities);

  // Also extract entities from the vector-retrieved chunks to seed expansion.
  // This catches related entities that weren't in the query but are in the
  // most relevant content — e.g., query is about "Hitler" and the top chunk
  // mentions "Nazi Party", which we then expand to.
  const vectorEntityNames: string[] = [];
  for (const chunk of vectorChunks.values()) {
    const extracted = extractEntitiesFromText(chunk.content);
    for (const e of extracted) {
      vectorEntityNames.push(e.normalizedName);
    }
  }
  // Resolve query entities to names in the in-memory graph
  const visited = new Set<string>();
  const seedNames: string[] = [];
  for (const name of queryEntities) {
    const found = searchEntitiesInGraph(name, 1);
    if (found.length > 0) {
      seedNames.push(found[0].normalizedName);
      visited.add(found[0].normalizedName);
    }
  }

  // Hop through the co-occurrence graph (in-memory — no SQL)
  let currentFrontier = new Set(seedNames);
  let hopsUsed = 0;

  for (let hop = 0; hop < ENTITY_HOP_DEPTH && currentFrontier.size > 0; hop++) {
    const nextFrontier = new Set<string>();
    hopsUsed++;

    for (const entityName of currentFrontier) {
      const related = getRelatedEntitiesFromGraph(entityName, ENTITY_NEIGHBORS_PER_HOP);
      for (const rel of related) {
        allExpandedEntities.add(rel.normalizedName);

        // Only follow strong connections (co-occur in at least 2 chunks)
        if (rel.strength >= 2 && !visited.has(rel.normalizedName)) {
          visited.add(rel.normalizedName);
          nextFrontier.add(rel.normalizedName);
        }

        // Pull chunks for this entity from the in-memory graph
        const chunkIds = getEntityChunkIdsFromGraph(rel.normalizedName, ENTITY_CHUNKS_PER_ENTITY);
        if (chunkIds.length > 0) {
          const rows = getChunksByIds(chunkIds);
          for (const row of rows) {
            const key = row.chromaId ?? String(row.id);
            if (!vectorChunks.has(key) && !entityChunks.has(key)) {
              entityChunks.set(key, {
                id: row.id as number,
                chromaId: key,
                content: row.content as string,
                sourceUrl: (row.sourceUrl ?? "") as string,
                sourceTitle: (row.sourceTitle ?? "") as string,
                sourceType: (row.sourceType ?? "") as string,
                score: 0,
                retrievalPath: hop === 0 ? "entity_direct" : "entity_hop",
              });
            }
          }
        }
      }
    }

    currentFrontier = nextFrontier;
  }

  return {
    expandedEntities: Array.from(allExpandedEntities),
    entityChunks,
    hopsUsed,
  };
}

// ─── Phase 3: Re-rank ──────────────────────────────────────────────────────

function reRankChunks(
  allChunks: InferenceChunk[],
  queryEntityNames: Set<string>
): InferenceChunk[] {
  for (const chunk of allChunks) {
    // Entity relevance: what fraction of query entities appear in this chunk?
    const chunkEntities = new Set(
      extractEntitiesFromText(chunk.content).map((e) => e.normalizedName)
    );
    const overlap = Array.from(queryEntityNames).filter((e) => chunkEntities.has(e)).length;
    const entityScore = queryEntityNames.size > 0
      ? overlap / queryEntityNames.size
      : 0;

    // Graph centrality: how many distinct entities does this chunk link to?
    // More entities = more "connected" = more likely to be a synthesis node.
    const centralityScore = Math.min(chunkEntities.size / 10, 1.0);

    // Combined score
    if (chunk.retrievalPath === "vector") {
      // Vector chunks already have a similarity score; blend in entity + centrality
      chunk.score = chunk.score * W_VECTOR + entityScore * W_ENTITY + centralityScore * W_GRAPH;
    } else {
      // Entity-retrieved chunks have no vector score; use entity + centrality only
      chunk.score = entityScore * (W_VECTOR + W_ENTITY) + centralityScore * W_GRAPH;
    }
  }

  // Sort descending by score, take top N
  allChunks.sort((a, b) => b.score - a.score);
  return allChunks.slice(0, FINAL_CHUNK_COUNT);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Run the full multi-hop inference pipeline. Returns ranked chunks ready
 * to be injected into the LLM system prompt.
 */
export async function multiHopRetrieval(query: string): Promise<InferenceResult> {
  const start = Date.now();

  // Check if the entity graph exists. If not, fall back to simple vector
  // retrieval — the backfill hasn't run yet.
  const graphStats = getGraphStats();
  if (graphStats.entities === 0) {
    const vectorChunks = await directVectorRetrieval(query);
    return {
      chunks: Array.from(vectorChunks.values()).slice(0, FINAL_CHUNK_COUNT),
      queryEntities: [],
      expandedEntities: [],
      stats: {
        vectorCandidates: vectorChunks.size,
        entityCandidates: 0,
        totalCandidates: vectorChunks.size,
        finalChunks: Math.min(vectorChunks.size, FINAL_CHUNK_COUNT),
        graphHopsUsed: 0,
        durationMs: Date.now() - start,
      },
    };
  }

  // Phase 1: Direct vector retrieval
  const vectorChunks = await directVectorRetrieval(query);

  // Phase 2: Entity expansion
  const queryEntities = extractQueryEntities(query);
  const { expandedEntities, entityChunks, hopsUsed } = await entityGraphExpansion(
    queryEntities,
    vectorChunks
  );

  // Merge all candidates
  const allChunks = new Map<string, InferenceChunk>();
  for (const [k, v] of vectorChunks) allChunks.set(k, v);
  for (const [k, v] of entityChunks) {
    if (!allChunks.has(k)) allChunks.set(k, v);
  }

  // Phase 3: Re-rank
  const queryEntitySet = new Set(queryEntities);
  const ranked = reRankChunks(Array.from(allChunks.values()), queryEntitySet);

  const durationMs = Date.now() - start;

  await logger.info(
    "inference",
    `Multi-hop retrieval: ${queryEntities.length} query entities → ${expandedEntities.length} expanded → ${allChunks.size} candidates → ${ranked.length} final chunks (${durationMs}ms, ${hopsUsed} hops)`
  );

  return {
    chunks: ranked,
    queryEntities,
    expandedEntities,
    stats: {
      vectorCandidates: vectorChunks.size,
      entityCandidates: entityChunks.size,
      totalCandidates: allChunks.size,
      finalChunks: ranked.length,
      graphHopsUsed: hopsUsed,
      durationMs,
    },
  };
}

/**
 * Build a synthesis-oriented system prompt section from inference results.
 * This replaces the old "=== KNOWLEDGE BASE CONTEXT ===" block with a
 * richer format that tells the LLM:
 *   - Where each piece of evidence came from (source + type)
 *   - How it was found (vector match vs entity graph hop)
 *   - What entities connect the pieces
 *   - Explicit instructions to cross-reference, note contradictions,
 *     draw inferences, and flag uncertainty.
 */
export function buildInferenceContext(result: InferenceResult): string {
  if (result.chunks.length === 0) return "";

  const chunkBlocks = result.chunks.map((c, i) => {
    const source = c.sourceTitle || c.sourceUrl || "Unknown";
    const via = c.retrievalPath === "vector"
      ? "direct match"
      : c.retrievalPath === "entity_direct"
      ? "entity link"
      : "graph hop";
    return `[${i + 1}] Source: ${source} (${c.sourceType}) | Found via: ${via} | Relevance: ${(c.score * 100).toFixed(0)}%\n${c.content}`;
  });

  const entityList = result.expandedEntities.length > 0
    ? `\nEntities discovered: ${result.expandedEntities.slice(0, 30).join(", ")}`
    : "";

  return `=== KNOWLEDGE BASE CONTEXT (${result.chunks.length} chunks from ${result.stats.totalCandidates} candidates) ===
Retrieved via multi-hop inference: ${result.stats.vectorCandidates} by vector similarity + ${result.stats.entityCandidates} by entity graph traversal (${result.stats.graphHopsUsed} hops).${entityList}

${chunkBlocks.join("\n\n---\n\n")}

=== INFERENCE INSTRUCTIONS ===
The chunks above come from multiple independent sources and were retrieved through different paths (direct semantic match, entity links, and graph hops connecting related concepts).

When answering:
1. CROSS-REFERENCE: compare what different sources say about the same topic. Note where they agree and disagree.
2. CHAIN REASONING: if chunk A says "X implies Y" and chunk B says "Y implies Z", connect them into "X implies Z" — make the inference explicit.
3. FILL GAPS: if the chunks provide partial information from different angles, synthesize a unified picture.
4. FLAG UNCERTAINTY: if sources contradict each other or evidence is thin, say so. Don't pretend certainty.
5. CITE SOURCES: reference chunks by their [N] number when making specific claims.
=== END CONTEXT ===`;
}
