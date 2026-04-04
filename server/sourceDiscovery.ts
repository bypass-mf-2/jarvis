/**
 * Intelligent Source Discovery System
 * 
 * Continuously discovers and evaluates new knowledge sources based on:
 * - User interests (inferred from conversation patterns)
 * - Content quality metrics
 * - Source reliability scores
 * - Topic relevance
 * - Update frequency
 * 
 * Uses LLM to:
 * - Generate search queries for new sources
 * - Evaluate content quality
 * - Categorize and tag sources
 * - Prune low-value sources
 */

import { ollamaChat } from "./ollama";
import {
  addScrapeSource,
  getScrapeSources,
  updateScrapeSourceStatus,
  getKnowledgeChunks,
  getSystemLogs,
} from "./db";
import { logger } from "./logger";

// ── Types ──────────────────────────────────────────────────────────────────────
interface DiscoveredSource {
  url: string;
  name: string;
  type: "rss" | "news" | "custom_url";
  category: string;
  relevanceScore: number;
  qualityScore: number;
  updateFrequency: "daily" | "weekly" | "monthly";
}

interface UserInterest {
  topic: string;
  weight: number; // 0-1, based on query frequency
  keywords: string[];
}

interface SourceQualityMetrics {
  sourceId: number;
  avgChunkLength: number;
  uniqueChunks: number;
  totalScrapes: number;
  errorRate: number;
  lastSuccessfulScrape: Date | null;
  qualityScore: number;
}

// ── Interest Analysis ──────────────────────────────────────────────────────────
async function analyzeUserInterests(): Promise<UserInterest[]> {
  const logs = await getSystemLogs(1000);
  const queries = logs
    .filter((l: any) => l.module === "rag" && l.message?.includes("query"))
    .map((l: any) => {
      const match = l.message.match(/"([^"]+)"/);
      return match ? match[1] : null;
    })
    .filter(Boolean);

  if (queries.length === 0) {
    return getDefaultInterests();
  }

  // Use LLM to extract topics from queries
  const prompt = `Analyze these user queries and extract the main topics of interest. Return as JSON array:

Queries:
${queries.slice(0, 50).join("\n")}

Format: [{ "topic": "topic name", "weight": 0.0-1.0, "keywords": ["keyword1", "keyword2"] }]

Return only the JSON array, ordered by weight (highest first). Maximum 10 topics.`;

  try {
    const response = await ollamaChat([{ role: "user", content: prompt }]);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    
    if (jsonMatch) {
      const interests: UserInterest[] = JSON.parse(jsonMatch[0]);
      return interests.slice(0, 10);
    }
  } catch (err) {
    await logger.warn("sourceDiscovery", `Interest analysis failed: ${String(err)}`);
  }

  return getDefaultInterests();
}

function getDefaultInterests(): UserInterest[] {
  return [
    { topic: "Artificial Intelligence", weight: 0.9, keywords: ["AI", "machine learning", "LLM"] },
    { topic: "Technology", weight: 0.8, keywords: ["tech", "software", "innovation"] },
    { topic: "Science", weight: 0.7, keywords: ["research", "physics", "biology"] },
    { topic: "News", weight: 0.6, keywords: ["world news", "current events"] },
  ];
}

// ── Source Discovery ───────────────────────────────────────────────────────────
async function discoverSources(interests: UserInterest[]): Promise<DiscoveredSource[]> {
  const discovered: DiscoveredSource[] = [];

  for (const interest of interests.slice(0, 3)) {
    const sources = await findSourcesForTopic(interest);
    discovered.push(...sources);
  }

  return discovered;
}

async function findSourcesForTopic(interest: UserInterest): Promise<DiscoveredSource[]> {
  const prompt = `Find 3-5 high-quality RSS feeds or news sources about "${interest.topic}".

Requirements:
- Must be well-known, reliable sources
- Should have RSS feeds or be scrapable
- Focus on: ${interest.keywords.join(", ")}

Return as JSON array:
[{
  "url": "https://example.com/feed.xml",
  "name": "Source Name",
  "type": "rss|news|custom_url",
  "category": "category name",
  "relevanceScore": 0.0-1.0,
  "qualityScore": 0.0-1.0,
  "updateFrequency": "daily|weekly|monthly"
}]

Return only the JSON array. Prioritize sources with RSS feeds.`;

  try {
    const response = await ollamaChat([{ role: "user", content: prompt }]);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    
    if (jsonMatch) {
      const sources: DiscoveredSource[] = JSON.parse(jsonMatch[0]);
      
      // Filter out existing sources
      const existing = await getScrapeSources();
      const existingUrls = new Set(existing.map((s: any) => s.url));
      
      return sources
        .filter(s => !existingUrls.has(s.url))
        .filter(s => s.relevanceScore >= 0.5);
    }
  } catch (err) {
    await logger.warn("sourceDiscovery", `Source discovery failed for ${interest.topic}: ${String(err)}`);
  }

  return [];
}

// ── Source Quality Evaluation ──────────────────────────────────────────────────
async function evaluateSourceQuality(sourceId: number): Promise<SourceQualityMetrics> {
  const sources = await getScrapeSources();
  const source = sources.find((s: any) => s.id === sourceId);
  
  if (!source) {
    return {
      sourceId,
      avgChunkLength: 0,
      uniqueChunks: 0,
      totalScrapes: 0,
      errorRate: 1.0,
      lastSuccessfulScrape: null,
      qualityScore: 0,
    };
  }

  // Get chunks from this source
  const allChunks = await getKnowledgeChunks(1000);
  const sourceChunks = allChunks.filter((c: any) => c.sourceUrl === source.url);

  const avgChunkLength = sourceChunks.length > 0
    ? sourceChunks.reduce((sum: number, c: any) => sum + c.content.length, 0) / sourceChunks.length
    : 0;

  const totalScrapes = source.totalChunks || 0;
  const errorRate = source.lastStatus === "error" ? 1.0 : 0.0;

  // Quality score formula
  const lengthScore = Math.min(avgChunkLength / 500, 1.0); // Prefer 500+ char chunks
  const volumeScore = Math.min(sourceChunks.length / 50, 1.0); // Prefer 50+ chunks
  const reliabilityScore = 1.0 - errorRate;

  const qualityScore = (lengthScore * 0.3 + volumeScore * 0.4 + reliabilityScore * 0.3);

  return {
    sourceId,
    avgChunkLength,
    uniqueChunks: sourceChunks.length,
    totalScrapes,
    errorRate,
    lastSuccessfulScrape: source.lastScrapedAt ? new Date(source.lastScrapedAt) : null,
    qualityScore,
  };
}

// ── Source Pruning ─────────────────────────────────────────────────────────────
async function pruneLowQualitySources(): Promise<{ pruned: number; kept: number }> {
  const sources = await getScrapeSources();
  const active = sources.filter((s: any) => s.isActive);

  let pruned = 0;
  let kept = 0;

  for (const source of active) {
    const metrics = await evaluateSourceQuality(source.id);

    // Prune if:
    // - Quality score below 0.3
    // - No successful scrapes in last 30 days
    // - Error rate > 0.5
    const daysSinceSuccess = metrics.lastSuccessfulScrape
      ? (Date.now() - metrics.lastSuccessfulScrape.getTime()) / (1000 * 60 * 60 * 24)
      : 999;

    if (
      metrics.qualityScore < 0.3 ||
      daysSinceSuccess > 30 ||
      metrics.errorRate > 0.5
    ) {
      await updateScrapeSourceStatus(source.id, "inactive");
      pruned++;
      
      await logger.info(
        "sourceDiscovery",
        `Pruned low-quality source: ${source.name} (score: ${metrics.qualityScore.toFixed(2)})`
      );
    } else {
      kept++;
    }
  }

  return { pruned, kept };
}

// ── Smart Source Recommendation ────────────────────────────────────────────────
async function recommendSourceAdjustments(): Promise<{
  toAdd: DiscoveredSource[];
  toRemove: number[];
  toPrioritize: number[];
}> {
  const interests = await analyzeUserInterests();
  const currentSources = await getScrapeSources();
  const activeSources = currentSources.filter((s: any) => s.isActive);

  // Find gaps in coverage
  const coveredTopics = new Set(activeSources.map((s: any) => s.type));
  const uncoveredInterests = interests.filter(
    (i) => !Array.from(coveredTopics).some(topic => 
      topic.toLowerCase().includes(i.topic.toLowerCase())
    )
  );

  // Discover new sources for uncovered interests
  const toAdd = await discoverSources(uncoveredInterests);

  // Evaluate existing sources
  const sourceMetrics = await Promise.all(
    activeSources.map(async (s: any) => ({
      id: s.id,
      metrics: await evaluateSourceQuality(s.id),
    }))
  );

  // Low-quality sources to remove
  const toRemove = sourceMetrics
    .filter(sm => sm.metrics.qualityScore < 0.3)
    .map(sm => sm.id);

  // High-quality sources to prioritize
  const toPrioritize = sourceMetrics
    .filter(sm => sm.metrics.qualityScore > 0.7)
    .sort((a, b) => b.metrics.qualityScore - a.metrics.qualityScore)
    .slice(0, 5)
    .map(sm => sm.id);

  return { toAdd, toRemove, toPrioritize };
}

// ── Content Deduplication ──────────────────────────────────────────────────────
async function deduplicateKnowledge(): Promise<{ removed: number }> {
  const chunks = await getKnowledgeChunks(5000);
  
  // Group by similar content using simple hash
  const contentHashes = new Map<string, number[]>();
  
  for (const chunk of chunks) {
    const hash = simpleHash(chunk.content);
    const existing = contentHashes.get(hash) || [];
    existing.push(chunk.id);
    contentHashes.set(hash, existing);
  }
  
  let removed = 0;
  
  // Remove duplicates (keep the oldest/first one)
  for (const [hash, ids] of contentHashes.entries()) {
    if (ids.length > 1) {
      // Would need a deleteKnowledgeChunk function in db.ts
      await logger.info("sourceDiscovery", `Found ${ids.length} duplicate chunks: ${hash}`);
      removed += ids.length - 1;
    }
  }
  
  return { removed };
}

function simpleHash(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

// ── Main Discovery Cycle ───────────────────────────────────────────────────────
export async function runSourceDiscovery(): Promise<{
  discovered: number;
  added: number;
  pruned: number;
}> {
  await logger.info("sourceDiscovery", "Starting source discovery cycle");

  try {
    // Step 1: Analyze user interests
    const interests = await analyzeUserInterests();
    await logger.info("sourceDiscovery", `Identified ${interests.length} user interests`);

    // Step 2: Get recommendations
    const recommendations = await recommendSourceAdjustments();
    await logger.info(
      "sourceDiscovery",
      `Found ${recommendations.toAdd.length} new sources, ${recommendations.toRemove.length} to prune`
    );

    // Step 3: Add high-quality new sources (auto-approve if score > 0.7)
    let added = 0;
    for (const source of recommendations.toAdd.slice(0, 5)) {
      if (source.qualityScore >= 0.7) {
        await addScrapeSource({
          url: source.url,
          name: source.name,
          type: source.type,
          isActive: true,
        });
        added++;
        
        await logger.info("sourceDiscovery", `Added new source: ${source.name} (score: ${source.qualityScore})`);
      }
    }

    // Step 4: Prune low-quality sources
    const pruneResult = await pruneLowQualitySources();

    // Step 5: Deduplicate knowledge
    await deduplicateKnowledge();

    return {
      discovered: recommendations.toAdd.length,
      added,
      pruned: pruneResult.pruned,
    };
  } catch (err) {
    await logger.error("sourceDiscovery", `Discovery cycle failed: ${String(err)}`);
    return { discovered: 0, added: 0, pruned: 0 };
  }
}

// ── Scheduler ──────────────────────────────────────────────────────────────────
let discoveryInterval: ReturnType<typeof setInterval> | null = null;

export function startSourceDiscoveryScheduler(intervalMs = 24 * 60 * 60 * 1000): void {
  if (discoveryInterval) return;
  
  logger.info("sourceDiscovery", `Source discovery scheduler started (every ${intervalMs / 3600000}h)`);
  
  // Initial discovery after 5 minutes
  setTimeout(() => runSourceDiscovery(), 5 * 60 * 1000);
  
  discoveryInterval = setInterval(() => runSourceDiscovery(), intervalMs);
}

export function stopSourceDiscoveryScheduler(): void {
  if (discoveryInterval) {
    clearInterval(discoveryInterval);
    discoveryInterval = null;
    logger.info("sourceDiscovery", "Source discovery scheduler stopped");
  }
}
