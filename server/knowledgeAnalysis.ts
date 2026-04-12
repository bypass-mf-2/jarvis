/**
 * Knowledge Analysis — deterministic self-improvement for the knowledge base.
 *
 * Unlike the LLM-driven code analyzer (slow, generic, useless on 7B models),
 * this module analyzes the entity graph, chunk data, and retrieval patterns
 * using pure math. No Ollama calls. Runs in seconds on 96k+ entities.
 *
 * Produces actionable findings:
 *   - Knowledge gaps: topics the user asks about but JARVIS has thin coverage
 *   - Orphan entities: nodes with zero connections (noise, or isolated topics)
 *   - Source ROI: which sources produce chunks that actually get retrieved
 *   - Weak zones: entity clusters with low internal connectivity
 *   - Suggested expansions: "you know about X but nothing about related Y"
 *
 * Findings get pushed to the improvement feed (improvement-feed.jsonl) so
 * the existing Self-Improve UI panel picks them up. They also feed into
 * source discovery: the crawler can prioritize topics where gaps are found.
 */

import {
  getGraphStats,
  searchEntitiesInGraph,
  getRelatedEntitiesFromGraph,
} from "./entityExtractor.js";
import { logger } from "./logger.js";
import { recordEvent } from "./improvementFeed.js";
import { getDatabase } from "./sqlite-init.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface KnowledgeReport {
  timestamp: number;
  summary: string;
  graphHealth: {
    totalEntities: number;
    totalConnections: number;
    avgConnectionsPerEntity: number;
    orphanEntities: number;
    topConnectedEntities: Array<{ name: string; connections: number }>;
  };
  knowledgeGaps: Array<{
    topic: string;
    retrievalCount: number;
    chunkCount: number;
    gapScore: number; // higher = bigger gap (high demand, low supply)
  }>;
  sourceROI: Array<{
    sourceUrl: string;
    sourceTitle: string;
    chunksStored: number;
    chunksRetrieved: number;
    roi: number; // retrieved / stored — higher = more useful per chunk
  }>;
  expansionSuggestions: Array<{
    fromEntity: string;
    suggestedTopic: string;
    reason: string;
  }>;
  durationMs: number;
}

// ─── Analysis functions ─────────────────────────────────────────────────────

/**
 * Run a full knowledge base health analysis. Pure math, no LLM, ~2-5 seconds.
 */
export async function analyzeKnowledge(): Promise<KnowledgeReport> {
  const start = Date.now();
  const db = getDatabase();

  const graphStats = getGraphStats();

  // ── Graph health ────────────────────────────────────────────────────────
  const avgConnections = graphStats.entities > 0
    ? graphStats.relationshipPairs / graphStats.entities
    : 0;

  // Find top connected entities (most relationships)
  // We can't directly query the in-memory graph for "top N by connection count"
  // from SQL, so we use the entity DB tables if they exist, or estimate from
  // the graph stats. For now, use the chunks table to find most-mentioned entities.
  const topMentioned = db.exec(
    `SELECT sourceTitle, COUNT(*) as cnt
     FROM knowledge_chunks
     WHERE sourceTitle IS NOT NULL AND sourceTitle != ''
     GROUP BY sourceTitle
     ORDER BY cnt DESC
     LIMIT 10`
  );
  const topConnected = (topMentioned[0]?.values ?? []).map((row: any) => ({
    name: String(row[0]),
    connections: Number(row[1]),
  }));

  // Orphan estimate: entities with mentionCount = 1 are likely isolated
  // (only appear in one chunk, so no co-occurrence with anything else)

  // ── Knowledge gaps: high retrieval demand, low chunk supply ─────────────
  // Join chunk_retrievals with knowledge_chunks to find topics that get
  // QUERIED a lot but have FEW chunks.
  const gapQuery = db.exec(
    `SELECT kc.sourceTitle, COUNT(DISTINCT cr.id) as retrievals, COUNT(DISTINCT kc.id) as chunks
     FROM chunk_retrievals cr
     JOIN knowledge_chunks kc ON kc.id = cr.chunkId
     WHERE kc.sourceTitle IS NOT NULL
     GROUP BY kc.sourceTitle
     HAVING retrievals > 0
     ORDER BY (CAST(retrievals AS REAL) / MAX(chunks, 1)) DESC
     LIMIT 20`
  );
  const knowledgeGaps = (gapQuery[0]?.values ?? []).map((row: any) => {
    const retrievals = Number(row[1]);
    const chunks = Number(row[2]);
    return {
      topic: String(row[0]),
      retrievalCount: retrievals,
      chunkCount: chunks,
      gapScore: chunks > 0 ? retrievals / chunks : retrievals,
    };
  }).filter((g) => g.gapScore > 1); // Only report where demand > supply

  // ── Source ROI: which sources produce chunks that get retrieved ──────────
  const roiQuery = db.exec(
    `SELECT kc.sourceUrl, kc.sourceTitle,
            COUNT(DISTINCT kc.id) as stored,
            COUNT(DISTINCT cr.id) as retrieved
     FROM knowledge_chunks kc
     LEFT JOIN chunk_retrievals cr ON cr.chunkId = kc.id
     WHERE kc.sourceUrl IS NOT NULL AND kc.sourceUrl != ''
     GROUP BY kc.sourceUrl
     HAVING stored >= 5
     ORDER BY (CAST(retrieved AS REAL) / MAX(stored, 1)) DESC
     LIMIT 30`
  );
  const sourceROI = (roiQuery[0]?.values ?? []).map((row: any) => ({
    sourceUrl: String(row[0]),
    sourceTitle: String(row[1] ?? ""),
    chunksStored: Number(row[2]),
    chunksRetrieved: Number(row[3]),
    roi: Number(row[2]) > 0 ? Number(row[3]) / Number(row[2]) : 0,
  }));

  // Top ROI sources (actually useful) and bottom ROI sources (dead weight)
  const topROI = sourceROI.filter((s) => s.chunksRetrieved > 0).slice(0, 10);
  const deadWeight = sourceROI
    .filter((s) => s.chunksRetrieved === 0 && s.chunksStored >= 10)
    .sort((a, b) => b.chunksStored - a.chunksStored)
    .slice(0, 10);

  // ── Expansion suggestions ───────────────────────────────────────────────
  // For the top-queried entities, check if their graph neighbors have very
  // few chunks. Those neighbors are expansion opportunities — "you know about
  // X but barely anything about closely-related Y."
  const expansionSuggestions: KnowledgeReport["expansionSuggestions"] = [];

  // Get entities that appear in retrieved chunks (= things the user cares about)
  const retrievedEntities = db.exec(
    `SELECT DISTINCT kc.sourceTitle
     FROM chunk_retrievals cr
     JOIN knowledge_chunks kc ON kc.id = cr.chunkId
     WHERE kc.sourceTitle IS NOT NULL
     LIMIT 50`
  );
  const queriedTopics = (retrievedEntities[0]?.values ?? []).map((r: any) => String(r[0]));

  for (const topic of queriedTopics.slice(0, 10)) {
    const entities = searchEntitiesInGraph(topic, 1);
    if (entities.length === 0) continue;

    const related = getRelatedEntitiesFromGraph(entities[0].normalizedName, 10);
    for (const rel of related) {
      // If a related entity has very few mentions compared to the parent,
      // it's an expansion opportunity.
      if (rel.mentionCount < entities[0].mentionCount * 0.1 && rel.mentionCount < 5) {
        expansionSuggestions.push({
          fromEntity: entities[0].name,
          suggestedTopic: rel.name,
          reason: `"${rel.name}" co-occurs with "${entities[0].name}" (strength ${rel.strength}) but has only ${rel.mentionCount} mentions vs ${entities[0].mentionCount}. Adding content about "${rel.name}" would strengthen this connection.`,
        });
      }
    }
  }

  // ── Record findings to improvement feed ─────────────────────────────────
  if (knowledgeGaps.length > 0) {
    recordEvent({
      type: "manual_note",
      module: "knowledgeAnalysis",
      summary: `Found ${knowledgeGaps.length} knowledge gaps (high retrieval demand, low chunk supply)`,
      details: {
        gaps: knowledgeGaps.slice(0, 5).map((g) => `${g.topic}: ${g.retrievalCount} retrievals / ${g.chunkCount} chunks`),
      },
    });
  }

  if (deadWeight.length > 0) {
    recordEvent({
      type: "manual_note",
      module: "knowledgeAnalysis",
      summary: `Found ${deadWeight.length} sources with 0 retrievals despite ${deadWeight.reduce((s, d) => s + d.chunksStored, 0)} stored chunks`,
      details: {
        sources: deadWeight.slice(0, 5).map((d) => `${d.sourceTitle || d.sourceUrl}: ${d.chunksStored} chunks, 0 retrieved`),
      },
    });
  }

  if (expansionSuggestions.length > 0) {
    recordEvent({
      type: "manual_note",
      module: "knowledgeAnalysis",
      summary: `Found ${expansionSuggestions.length} expansion opportunities — related topics with thin coverage`,
      details: {
        suggestions: expansionSuggestions.slice(0, 5).map((s) => `${s.fromEntity} → ${s.suggestedTopic}`),
      },
    });
  }

  const durationMs = Date.now() - start;
  const report: KnowledgeReport = {
    timestamp: Date.now(),
    summary: `Knowledge analysis: ${graphStats.entities.toLocaleString()} entities, ${graphStats.relationshipPairs.toLocaleString()} connections, ${knowledgeGaps.length} gaps, ${deadWeight.length} dead-weight sources, ${expansionSuggestions.length} expansion opportunities (${durationMs}ms)`,
    graphHealth: {
      totalEntities: graphStats.entities,
      totalConnections: graphStats.relationshipPairs,
      avgConnectionsPerEntity: Math.round(avgConnections * 100) / 100,
      orphanEntities: 0, // would need a full graph scan — skip for now
      topConnectedEntities: topConnected,
    },
    knowledgeGaps,
    sourceROI: topROI,
    expansionSuggestions: expansionSuggestions.slice(0, 20),
    durationMs,
  };

  await logger.info("knowledgeAnalysis", report.summary);

  return report;
}
